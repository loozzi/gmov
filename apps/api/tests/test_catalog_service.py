"""Catalog snapshot service + CLI dispatch tests (respx + SQLite)."""

from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

import httpx
import pytest
import pytest_asyncio
import respx
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app import cli
from app.core.config import settings
from app.db.base import Base
from app.db.models.catalog_item import CatalogItem
from app.db.models.user import User
from app.services import catalog_service, nguonc

BASE = settings.nguonc_base_url


@pytest_asyncio.fixture
async def db_env(tmp_path):
    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path}/catalog.db")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    factory = async_sessionmaker(engine, expire_on_commit=False)
    yield SimpleNamespace(factory=factory, engine=engine)
    await engine.dispose()


@pytest.fixture(autouse=True)
def _no_retry_backoff(monkeypatch):
    monkeypatch.setattr(nguonc, "BACKOFF_SECONDS", (0.0, 0.0))


def _aware(value: datetime) -> datetime:
    return value if value.tzinfo else value.replace(tzinfo=UTC)


def card(slug: str, *, year: str | None = None, **extra) -> dict:
    pretty = slug.replace("-", " ").title()
    data = {
        "name": pretty,
        "slug": slug,
        "original_name": pretty,
        "thumb_url": f"/public/images/{slug}.jpg",
        "poster_url": f"/public/images/{slug}1.jpg",
        "description": f"{slug} desc",
        "total_episodes": 12,
        "current_episode": "Hoàn tất (12/12)",
        "time": "24 phút/tập",
        "quality": "HD",
        "language": "Vietsub",
        "director": None,
        "casts": None,
        "year": year,
    }
    data.update(extra)
    return data


def payload(items: list[dict]) -> dict:
    return {
        "status": "success",
        "paginate": {"current_page": 1, "total_page": 1, "total_items": len(items)},
        "items": items,
    }


def mock_listing(path: str, items: list[dict] | None = None, status: int = 200):
    if status == 200:
        response = httpx.Response(200, json=payload(items or []))
    else:
        response = httpx.Response(status, json={})
    return respx.get(f"{BASE}{path}", params={"page": 1}).mock(return_value=response)


@respx.mock
async def test_refresh_upserts_and_derives_listing_metadata(db_env):
    mock_listing("/films/the-loai/hanh-dong", [card("action-one")])
    mock_listing("/films/quoc-gia/han-quoc", [card("k-drama-one")])
    mock_listing("/films/nam-phat-hanh/2026", [card("undated")])

    async with db_env.factory() as db:
        stats = await catalog_service.refresh(
            db, kinds=["hanh-dong", "han-quoc", "2026"]
        )
        assert stats.listings_ok == 3
        assert stats.listings_failed == 0
        assert stats.items_upserted == 3

        items = {item.slug: item for item in await catalog_service.list_items(db)}
        assert set(items) == {"action-one", "k-drama-one", "undated"}
        assert items["action-one"].genres == ["hanh-dong"]
        assert items["action-one"].country is None
        assert items["action-one"].source == "genre:hanh-dong"
        assert items["k-drama-one"].country == "han-quoc"
        assert items["k-drama-one"].genres == []
        assert items["k-drama-one"].source == "country:han-quoc"
        assert items["undated"].year == 2026
        assert items["undated"].source == "year:2026"


@respx.mock
async def test_refresh_dedupes_by_slug_and_unions_genres(db_env):
    mock_listing("/films/the-loai/hanh-dong", [card("shared")])
    mock_listing("/films/the-loai/phim-hai", [card("shared")])
    mock_listing("/films/quoc-gia/han-quoc", [card("shared", year="1999")])

    async with db_env.factory() as db:
        stats = await catalog_service.refresh(
            db, kinds=["hanh-dong", "phim-hai", "han-quoc"]
        )
        assert stats.items_upserted == 1
        assert stats.listings_ok == 3
        assert await catalog_service.count(db) == 1
        item = (await catalog_service.by_slugs(db, ["shared"]))[0]
        assert item.genres == ["hanh-dong", "phim-hai"]
        assert item.country == "han-quoc"
        assert item.year == 1999
        assert item.source == "genre:hanh-dong"

        await db.execute(
            update(CatalogItem)
            .where(CatalogItem.slug == "shared")
            .values(fetched_at=datetime.now(UTC) - timedelta(days=5))
        )
        await db.commit()

        second = await catalog_service.refresh(
            db, kinds=["hanh-dong", "phim-hai", "han-quoc"]
        )
        assert second.items_upserted == 1
        assert await catalog_service.count(db) == 1
        refreshed = (await catalog_service.by_slugs(db, ["shared"]))[0]
        assert _aware(refreshed.fetched_at) > datetime.now(UTC) - timedelta(minutes=1)


@respx.mock
async def test_refresh_keeps_old_genres_when_listing_fails(db_env):
    ok = httpx.Response(200, json=payload([card("shared")]))
    dead = httpx.Response(500, json={})
    respx.get(f"{BASE}/films/the-loai/hanh-dong", params={"page": 1}).mock(
        side_effect=[ok, dead, dead, dead]
    )
    mock_listing("/films/the-loai/phim-hai", [card("shared")])

    async with db_env.factory() as db:
        await catalog_service.refresh(db, kinds=["hanh-dong", "phim-hai"])
        before = (await catalog_service.by_slugs(db, ["shared"]))[0]
        assert before.genres == ["hanh-dong", "phim-hai"]

        stats = await catalog_service.refresh(db, kinds=["hanh-dong", "phim-hai"])
        assert stats.listings_failed == 1
        assert stats.listings_ok == 1

        after = (await catalog_service.by_slugs(db, ["shared"]))[0]
        assert after.genres == ["hanh-dong", "phim-hai"]


@respx.mock
async def test_one_dead_listing_does_not_stop_refresh(db_env):
    mock_listing("/films/the-loai/hanh-dong", status=500)
    mock_listing("/films/the-loai/phim-hai", [card("survivor")])
    mock_listing("/films/quoc-gia/han-quoc", [card("also-survivor")])

    async with db_env.factory() as db:
        stats = await catalog_service.refresh(
            db, kinds=["hanh-dong", "phim-hai", "han-quoc"]
        )
        assert stats.listings_failed == 1
        assert stats.listings_ok == 2
        assert stats.items_upserted == 2
        slugs = [item.slug for item in await catalog_service.list_items(db)]
        assert slugs == ["also-survivor", "survivor"]


@respx.mock
async def test_is_stale_true_when_empty_false_after_refresh(db_env):
    mock_listing("/films/the-loai/hanh-dong", [card("fresh")])

    async with db_env.factory() as db:
        assert await catalog_service.is_stale(db, 24) is True
        await catalog_service.refresh(db, kinds=["hanh-dong"])
        assert await catalog_service.is_stale(db, 24) is False


@respx.mock
async def test_is_stale_true_when_snapshot_older_than_ttl(db_env):
    mock_listing("/films/the-loai/hanh-dong", [card("old")])

    async with db_env.factory() as db:
        await catalog_service.refresh(db, kinds=["hanh-dong"])
        await db.execute(
            update(CatalogItem).values(
                fetched_at=datetime.now(UTC) - timedelta(hours=25)
            )
        )
        await db.commit()
        assert await catalog_service.is_stale(db, 24) is True


@respx.mock
async def test_by_slugs_follows_input_order_and_skips_unknown(db_env):
    mock_listing("/films/the-loai/hanh-dong", [card("a"), card("b"), card("c")])

    async with db_env.factory() as db:
        await catalog_service.refresh(db, kinds=["hanh-dong"])
        items = await catalog_service.by_slugs(db, ["c", "missing", "a"])
        assert [item.slug for item in items] == ["c", "a"]
        assert await catalog_service.by_slugs(db, []) == []


def test_default_kinds_exclude_adult_genre():
    jobs = catalog_service._jobs(catalog_service._default_kinds(), 1)
    keys = {key for _kind, key, _page in jobs}
    assert "phim-18" not in keys
    assert "hanh-dong" in keys


@respx.mock
async def test_adult_genre_is_still_crawlable_when_explicit(db_env):
    mock_listing("/films/the-loai/phim-18", [card("adult")])

    async with db_env.factory() as db:
        stats = await catalog_service.refresh(db, kinds=["phim-18"])
        assert stats.listings_ok == 1
        item = (await catalog_service.by_slugs(db, ["adult"]))[0]
        assert item.genres == ["phim-18"]


class _FakeSession:
    async def __aenter__(self):
        return SimpleNamespace()

    async def __aexit__(self, *exc):
        return False


class _FakeEngine:
    async def dispose(self) -> None:
        return None


async def test_cli_refresh_catalog_dispatches(monkeypatch, capsys):
    called = {}

    async def fake_refresh(db, *, kinds=None, pages=1):
        called["pages"] = pages
        return catalog_service.RefreshStats(
            listings_ok=2, listings_failed=0, items_upserted=7
        )

    monkeypatch.setattr(catalog_service, "refresh", fake_refresh)
    monkeypatch.setattr(cli, "session_factory", lambda: _FakeSession())
    monkeypatch.setattr(cli, "engine", _FakeEngine())

    code = await cli.main(["refresh-catalog", "--pages", "2"])
    assert code == 0
    assert called["pages"] == 2
    out = capsys.readouterr().out
    assert "7" in out


async def test_cli_refresh_catalog_passes_explicit_kinds(monkeypatch):
    called = {}

    async def fake_refresh(db, *, kinds=None, pages=1):
        called["kinds"] = kinds
        return catalog_service.RefreshStats()

    monkeypatch.setattr(catalog_service, "refresh", fake_refresh)
    monkeypatch.setattr(cli, "session_factory", lambda: _FakeSession())
    monkeypatch.setattr(cli, "engine", _FakeEngine())

    code = await cli.main(["refresh-catalog", "--kinds", "phim-18,hanh-dong"])
    assert code == 0
    assert called["kinds"] == ["phim-18", "hanh-dong"]


async def test_cli_set_role_still_dispatches(db_env, monkeypatch):
    async with db_env.factory() as db:
        db.add(
            User(
                email="cli@gmov.dev",
                username="cli",
                hashed_password="x",
                display_name="cli",
            )
        )
        await db.commit()

    monkeypatch.setattr(cli, "session_factory", db_env.factory)
    monkeypatch.setattr(cli, "engine", _FakeEngine())

    code = await cli.main(["set-role", "cli", "admin"])
    assert code == 0

    async with db_env.factory() as db:
        user = (
            await db.execute(select(User).where(User.username == "cli"))
        ).scalar_one()
    assert user.role.value == "admin"


def _detail(slug: str, genres: list[str], countries: list[str]) -> dict:
    return {
        "status": "success",
        "movie": {
            **card(slug, year="2021"),
            "id": "42",
            "category": {
                "1": {
                    "group": {"name": "Thể loại"},
                    "list": [{"name": g} for g in genres],
                },
                "2": {
                    "group": {"name": "Quốc gia"},
                    "list": [{"name": c} for c in countries],
                },
            },
        },
    }


@respx.mock
async def test_ensure_metadata_backfills_missing_slugs(db_env):
    async with db_env.factory() as db:
        db.add(
            CatalogItem(
                slug="known",
                name="Known",
                poster_url="",
                thumb_url="",
                genres=["hanh-dong"],
                fetched_at=datetime.now(UTC),
                source="genre:hanh-dong",
            )
        )
        await db.commit()

    respx.get(f"{BASE}/film/lost").mock(
        return_value=httpx.Response(
            200, json=_detail("lost", ["Hành Động", "Không Có"], ["Hàn Quốc"])
        )
    )

    async with db_env.factory() as db:
        rows = await catalog_service.ensure_metadata(
            db, ["known", "lost", "unavailable"]
        )

    by_slug = {row.slug: row for row in rows}
    assert set(by_slug) == {"known", "lost"}
    assert by_slug["lost"].genres == ["hanh-dong"]
    assert by_slug["lost"].country == "han-quoc"
    assert by_slug["lost"].year == 2021
    assert by_slug["lost"].source == "backfill"

    async with db_env.factory() as db:
        assert await catalog_service.count(db) == 2
