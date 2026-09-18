"""Taste profile, excluded genres, and recommendation feedback (TDD)."""

import uuid
from dataclasses import dataclass
from datetime import UTC, datetime

import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.core import ratelimit
from app.db.base import Base
from app.db.models.catalog_item import CatalogItem
from app.db.models.favorite import Favorite
from app.db.models.watch_progress import WatchProgress
from app.db.models.watchlist import Watchlist
from app.db.session import get_db
from app.main import app
from tests.conftest import make_access_token
from tests.session_helpers import select_default

ME = "/api/v1/me"
RECS = f"{ME}/recommendations"
TASTE = f"{ME}/taste"
FEEDBACK = f"{ME}/recommendations/feedback"


@dataclass
class Env:
    client: AsyncClient
    factory: async_sessionmaker


@pytest_asyncio.fixture
async def client_env(tmp_path, monkeypatch):
    db_path = tmp_path / "taste.db"
    engine = create_async_engine(f"sqlite+aiosqlite:///{db_path}")
    factory = async_sessionmaker(engine, expire_on_commit=False)

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    async def override_get_db():
        async with factory() as session:
            yield session

    async def _noop(*_args, **_kwargs):
        return None

    monkeypatch.setattr(ratelimit, "check_register_allowed", _noop)
    monkeypatch.setattr(ratelimit, "check_login_allowed", _noop)
    app.dependency_overrides[get_db] = override_get_db
    try:
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as ac:
            yield Env(client=ac, factory=factory)
    finally:
        app.dependency_overrides.clear()
        await engine.dispose()


async def _register_login(
    env: Env, email: str, username: str
) -> tuple[dict, uuid.UUID]:
    r = await env.client.post(
        "/api/v1/auth/register",
        json={"email": email, "username": username, "password": "password123"},
    )
    assert r.status_code == 201, r.text
    user_id = uuid.UUID(r.json()["id"])
    r = await env.client.post(
        "/api/v1/auth/login",
        data={"username": username, "password": "password123"},
    )
    assert r.status_code == 200, r.text
    token = await select_default(env.client, r.json()["access_token"])
    return {"Authorization": f"Bearer {token}"}, user_id


async def _profile_id(env: Env, headers: dict) -> uuid.UUID:
    r = await env.client.get(f"{ME}/profile", headers=headers)
    assert r.status_code == 200, r.text
    return uuid.UUID(r.json()["id"])


async def _seed_catalog(env: Env, items: list[dict]) -> None:
    async with env.factory() as session:
        for item in items:
            session.add(
                CatalogItem(
                    slug=item["slug"],
                    name=item.get("name", item["slug"]),
                    genres=item.get("genres", []),
                    country=item.get("country"),
                    poster_url="",
                    thumb_url="",
                    fetched_at=datetime.now(UTC),
                    source="genre:test",
                )
            )
        await session.commit()


async def _seed_signals(
    env: Env,
    profile_id: uuid.UUID,
    *,
    favorites: tuple[str, ...] = (),
    watchlist: tuple[str, ...] = (),
    progress: tuple[tuple[str, int, int], ...] = (),
) -> None:
    async with env.factory() as session:
        for slug in favorites:
            session.add(
                Favorite(profile_id=profile_id, movie_slug=slug, movie_name=slug)
            )
        for slug in watchlist:
            session.add(
                Watchlist(profile_id=profile_id, movie_slug=slug, movie_name=slug)
            )
        for slug, position, duration in progress:
            session.add(
                WatchProgress(
                    profile_id=profile_id,
                    movie_slug=slug,
                    movie_name=slug,
                    episode_slug="tap-1",
                    episode_name="Tap 1",
                    position_seconds=position,
                    duration_seconds=duration,
                    updated_at=datetime.now(UTC),
                )
            )
        await session.commit()


async def test_has_signals_flips_after_a_favorite(client_env):
    headers, _ = await _register_login(client_env, "taste1@gmov.dev", "taste1")
    pid = await _profile_id(client_env, headers)

    r = await client_env.client.get(f"{ME}/preferences", headers=headers)
    assert r.json()["has_signals"] is False

    await _seed_signals(client_env, pid, favorites=("phim-a",))

    r = await client_env.client.get(f"{ME}/preferences", headers=headers)
    assert r.json()["has_signals"] is True


async def test_taste_sources_breakdown(client_env):
    headers, _ = await _register_login(client_env, "taste2@gmov.dev", "taste2")
    pid = await _profile_id(client_env, headers)
    await _seed_catalog(
        client_env,
        [
            {"slug": "fav", "genres": ["hanh-dong"]},
            {"slug": "book", "genres": ["hanh-dong", "kinh-di"]},
            {"slug": "done", "genres": ["hoat-hinh"]},
            {"slug": "half", "genres": ["co-trang"]},
        ],
    )
    await client_env.client.put(
        f"{ME}/preferences",
        headers=headers,
        json={"genres": {"hanh-dong": 2.0}, "countries": {"han-quoc": 1.0}},
    )
    await _seed_signals(
        client_env,
        pid,
        favorites=("fav",),
        watchlist=("book",),
        progress=(("done", 90, 100), ("half", 50, 100)),
    )

    body = (await client_env.client.get(TASTE, headers=headers)).json()
    assert body["has_signals"] is True
    assert body["genre_weights"]["hanh-dong"] == 3.0
    assert body["genre_weights"]["kinh-di"] == 0.3
    assert body["genre_weights"]["hoat-hinh"] == 0.5
    assert body["genre_weights"]["co-trang"] == 0.2
    assert body["country_weights"] == {"han-quoc": 1.0}
    assert body["sources"]["hanh-dong"] == {
        "explicit": 2.0,
        "favorite": 1.0,
        "watchlist": 0.3,
    }
    assert body["sources"]["kinh-di"] == {"watchlist": 0.3}
    assert body["sources"]["co-trang"] == {"in_progress": 0.2}
    assert body["feedback"] == []


async def test_excluded_genres_drops_weight_and_caps(client_env):
    headers, _ = await _register_login(client_env, "taste3@gmov.dev", "taste3")
    pid = await _profile_id(client_env, headers)
    await _seed_catalog(client_env, [{"slug": "fav", "genres": ["hanh-dong"]}])
    await _seed_signals(client_env, pid, favorites=("fav",))

    r = await client_env.client.put(
        f"{ME}/preferences",
        headers=headers,
        json={
            "genres": {"hanh-dong": 2.0},
            "countries": {},
            "excluded_genres": ["hanh-dong"],
        },
    )
    assert r.status_code == 200, r.text
    assert r.json()["excluded_genres"] == ["hanh-dong"]

    body = (await client_env.client.get(TASTE, headers=headers)).json()
    assert "hanh-dong" not in body["genre_weights"]
    assert "hanh-dong" not in body["sources"]


async def test_feedback_upsert_toggle_and_undo(client_env):
    headers, _ = await _register_login(client_env, "taste4@gmov.dev", "taste4")
    await _seed_catalog(client_env, [{"slug": "phim-a", "genres": ["hanh-dong"]}])

    r = await client_env.client.post(
        FEEDBACK,
        headers=headers,
        json={"movie_slug": "phim-a", "kind": "not_interested"},
    )
    assert r.status_code == 200, r.text
    assert r.json() == {"movie_slug": "phim-a", "kind": "not_interested"}

    r = await client_env.client.post(
        FEEDBACK, headers=headers, json={"movie_slug": "phim-a", "kind": "interested"}
    )
    assert r.status_code == 200, r.text
    assert r.json()["kind"] == "interested"

    body = (await client_env.client.get(TASTE, headers=headers)).json()
    assert len(body["feedback"]) == 1
    assert body["feedback"][0]["movie"]["slug"] == "phim-a"
    assert body["feedback"][0]["kind"] == "interested"

    r = await client_env.client.delete(f"{FEEDBACK}/phim-a", headers=headers)
    assert r.status_code == 200, r.text
    assert r.json() == {"ok": True}

    body = (await client_env.client.get(TASTE, headers=headers)).json()
    assert body["feedback"] == []
    assert body["has_signals"] is False


async def test_signals_only_profile_gets_personal_recommendations(client_env):
    headers, _ = await _register_login(client_env, "taste5@gmov.dev", "taste5")
    pid = await _profile_id(client_env, headers)
    await _seed_catalog(
        client_env,
        [
            {"slug": "fav", "genres": ["hanh-dong"]},
            {"slug": "candidate", "genres": ["hanh-dong"]},
            {"slug": "other", "genres": ["kinh-di"]},
        ],
    )
    await _seed_signals(client_env, pid, favorites=("fav",))

    body = (await client_env.client.get(RECS, headers=headers)).json()
    assert body["source"] == "personal"
    slugs = [item["movie"]["slug"] for item in body["items"]]
    assert slugs == ["candidate", "other"]
    assert body["items"][0]["reason"] == "Vì bạn yêu thích phim Hành Động"


async def test_not_interested_penalises_genre_and_hides(client_env):
    headers, _ = await _register_login(client_env, "taste6@gmov.dev", "taste6")
    pid = await _profile_id(client_env, headers)
    await _seed_catalog(
        client_env,
        [
            {"slug": "seed", "genres": ["hanh-dong"]},
            {"slug": "candidate", "genres": ["hanh-dong"]},
            {"slug": "other", "genres": ["kinh-di"]},
        ],
    )
    await _seed_signals(client_env, pid, favorites=("seed",))

    before = (await client_env.client.get(RECS, headers=headers)).json()
    assert [item["movie"]["slug"] for item in before["items"]] == [
        "candidate",
        "other",
    ]

    r = await client_env.client.post(
        FEEDBACK,
        headers=headers,
        json={"movie_slug": "candidate", "kind": "not_interested"},
    )
    assert r.status_code == 200, r.text

    taste = (await client_env.client.get(TASTE, headers=headers)).json()
    assert taste["genre_weights"]["hanh-dong"] == -1.0

    after = (await client_env.client.get(RECS, headers=headers)).json()
    assert [item["movie"]["slug"] for item in after["items"]] == ["other"]

    await client_env.client.post(
        FEEDBACK, headers=headers, json={"movie_slug": "other", "kind": "interested"}
    )
    taste = (await client_env.client.get(TASTE, headers=headers)).json()
    assert taste["genre_weights"]["kinh-di"] == 1.0


async def test_new_signal_busts_recommendation_cache(client_env):
    headers, _ = await _register_login(client_env, "taste7@gmov.dev", "taste7")
    pid = await _profile_id(client_env, headers)
    await _seed_catalog(
        client_env,
        [
            {"slug": "seed", "genres": ["hanh-dong"]},
            {"slug": "candidate", "genres": ["hanh-dong"]},
        ],
    )

    first = (await client_env.client.get(RECS, headers=headers)).json()
    assert first["source"] != "personal"

    await _seed_signals(client_env, pid, favorites=("seed",))

    second = (await client_env.client.get(RECS, headers=headers)).json()
    assert second["source"] == "personal"
    slugs = [item["movie"]["slug"] for item in second["items"]]
    assert slugs == ["candidate"]


async def test_feedback_is_isolated_per_profile(client_env):
    headers, user_id = await _register_login(client_env, "taste8@gmov.dev", "taste8")
    kid = await client_env.client.post(
        f"{ME}/profiles",
        headers=headers,
        json={"name": "Kid", "avatar": "cat"},
    )
    kid_id = uuid.UUID(kid.json()["id"])
    kid_headers = {"Authorization": f"Bearer {make_access_token(user_id, kid_id)}"}
    await _seed_catalog(client_env, [{"slug": "phim-a", "genres": ["hanh-dong"]}])

    await client_env.client.post(
        FEEDBACK, headers=headers, json={"movie_slug": "phim-a", "kind": "interested"}
    )
    body = (await client_env.client.get(TASTE, headers=kid_headers)).json()
    assert body["feedback"] == []

    r = await client_env.client.delete(f"{FEEDBACK}/phim-a", headers=kid_headers)
    assert r.status_code == 200, r.text

    body = (await client_env.client.get(TASTE, headers=headers)).json()
    assert len(body["feedback"]) == 1
