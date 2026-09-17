"""Per-profile taste preferences + behaviour weights (TDD)."""

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
from app.db.models.rating import Rating
from app.db.models.watch_progress import WatchProgress
from app.db.session import get_db
from app.main import app
from app.services import preference_service
from tests.conftest import make_access_token

ME = "/api/v1/me"

EMPTY = {
    "genres": {},
    "countries": {},
    "onboarding_completed_at": None,
    "skipped": False,
}


@dataclass
class Env:
    client: AsyncClient
    factory: async_sessionmaker


@pytest_asyncio.fixture
async def client_env(tmp_path, monkeypatch):
    db_path = tmp_path / "preferences.db"
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
    headers = {"Authorization": f"Bearer {r.json()['access_token']}"}
    return headers, user_id


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
    ratings: tuple[tuple[str, int], ...] = (),
    progress: tuple[tuple[str, int, int], ...] = (),
) -> None:
    async with env.factory() as session:
        for slug in favorites:
            session.add(
                Favorite(profile_id=profile_id, movie_slug=slug, movie_name=slug)
            )
        for slug, stars in ratings:
            session.add(
                Rating(profile_id=profile_id, movie_slug=slug, stars=stars)
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


async def _weights(env: Env, profile_id: uuid.UUID):
    async with env.factory() as session:
        return await preference_service.behavior_weights(session, profile_id)


async def test_get_empty_and_put_overwrites(client_env):
    headers, _ = await _register_login(client_env, "pref1@gmov.dev", "pref1")

    r = await client_env.client.get(f"{ME}/preferences", headers=headers)
    assert r.status_code == 200, r.text
    assert r.json() == EMPTY

    r = await client_env.client.put(
        f"{ME}/preferences",
        headers=headers,
        json={"genres": {"hanh-dong": 2.0}, "countries": {"han-quoc": 2.0}},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["genres"] == {"hanh-dong": 2.0}
    assert body["countries"] == {"han-quoc": 2.0}
    assert body["onboarding_completed_at"] is not None
    assert body["skipped"] is False

    r = await client_env.client.put(
        f"{ME}/preferences",
        headers=headers,
        json={"genres": {"kinh-di": 2.0}, "countries": {}},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["genres"] == {"kinh-di": 2.0}
    assert body["countries"] == {}
    assert body["onboarding_completed_at"] is not None


async def test_skipped_is_persisted(client_env):
    headers, _ = await _register_login(client_env, "pref2@gmov.dev", "pref2")

    r = await client_env.client.put(
        f"{ME}/preferences",
        headers=headers,
        json={"genres": {}, "countries": {}, "skipped": True},
    )
    assert r.status_code == 200, r.text
    assert r.json()["skipped"] is True

    r = await client_env.client.get(f"{ME}/preferences", headers=headers)
    assert r.json()["skipped"] is True
    assert r.json()["onboarding_completed_at"] is not None


async def test_poster_like_adds_weight_and_caps(client_env):
    headers, _ = await _register_login(client_env, "pref3@gmov.dev", "pref3")
    await _seed_catalog(
        client_env,
        [
            {"slug": "phim-a", "genres": ["hanh-dong", "kinh-di"]},
            {"slug": "phim-b", "genres": ["hanh-dong"]},
        ],
    )

    r = await client_env.client.post(
        f"{ME}/preferences/posters",
        headers=headers,
        json={"liked": ["phim-a"]},
    )
    assert r.status_code == 200, r.text
    assert r.json()["genres"] == {"hanh-dong": 0.5, "kinh-di": 0.5}

    r = await client_env.client.post(
        f"{ME}/preferences/posters",
        headers=headers,
        json={"liked": ["phim-a"] * 6 + ["phim-b"]},
    )
    assert r.status_code == 200, r.text
    genres = r.json()["genres"]
    assert genres["hanh-dong"] == 3.0
    assert genres["kinh-di"] == 3.0

    r = await client_env.client.get(f"{ME}/preferences", headers=headers)
    assert r.json()["onboarding_completed_at"] is None


async def test_unknown_poster_slug_is_ignored(client_env):
    headers, _ = await _register_login(client_env, "pref4@gmov.dev", "pref4")

    r = await client_env.client.post(
        f"{ME}/preferences/posters",
        headers=headers,
        json={"liked": ["khong-ton-tai"], "skipped": ["cung-khong"]},
    )
    assert r.status_code == 200, r.text
    assert r.json()["genres"] == {}

    r = await client_env.client.get(f"{ME}/preferences", headers=headers)
    assert r.json() == EMPTY


async def test_delete_removes_row(client_env):
    headers, _ = await _register_login(client_env, "pref5@gmov.dev", "pref5")
    await client_env.client.put(
        f"{ME}/preferences",
        headers=headers,
        json={"genres": {"hanh-dong": 2.0}, "countries": {}, "skipped": True},
    )

    r = await client_env.client.delete(f"{ME}/preferences", headers=headers)
    assert r.status_code == 204, r.text

    r = await client_env.client.get(f"{ME}/preferences", headers=headers)
    assert r.json() == EMPTY


async def test_reset_keeps_behaviour_weights(client_env):
    headers, _ = await _register_login(client_env, "pref6@gmov.dev", "pref6")
    pid = await _profile_id(client_env, headers)
    await _seed_catalog(
        client_env, [{"slug": "phim-x", "genres": ["hanh-dong"]}]
    )
    await _seed_signals(
        client_env, pid, favorites=("phim-x",), ratings=(("phim-x", 9),)
    )

    before = await _weights(client_env, pid)
    assert before[0] == {"hanh-dong": 2.5}

    await client_env.client.put(
        f"{ME}/preferences",
        headers=headers,
        json={"genres": {"kinh-di": 2.0}, "countries": {}},
    )
    r = await client_env.client.delete(f"{ME}/preferences", headers=headers)
    assert r.status_code == 204, r.text

    after = await _weights(client_env, pid)
    assert after == before


async def test_behavior_rules_skip_missing_catalog_films(client_env):
    headers, _ = await _register_login(client_env, "pref8@gmov.dev", "pref8")
    pid = await _profile_id(client_env, headers)
    await _seed_catalog(
        client_env,
        [
            {"slug": "fav", "genres": ["hanh-dong"]},
            {"slug": "loved", "genres": ["kinh-di"]},
            {"slug": "hated", "genres": ["tinh-cam"]},
            {"slug": "finished", "genres": ["hoat-hinh"]},
            {"slug": "partial", "genres": ["phieu-luu"]},
        ],
    )
    await _seed_signals(
        client_env,
        pid,
        favorites=("fav", "missing"),
        ratings=(("loved", 9), ("hated", 3)),
        progress=(("finished", 90, 100), ("partial", 50, 100)),
    )

    weights, seen = await _weights(client_env, pid)
    assert weights == {
        "hanh-dong": 1.0,
        "kinh-di": 1.5,
        "tinh-cam": -1.5,
        "hoat-hinh": 0.5,
    }
    assert seen == {"fav", "missing", "finished"}


async def test_preferences_are_isolated_per_profile(client_env):
    headers, user_id = await _register_login(client_env, "pref7@gmov.dev", "pref7")
    await client_env.client.put(
        f"{ME}/preferences",
        headers=headers,
        json={"genres": {"hanh-dong": 2.0}, "countries": {}},
    )

    created = await client_env.client.post(
        f"{ME}/profiles",
        headers=headers,
        json={"name": "Kid", "avatar": "cat"},
    )
    assert created.status_code == 201, created.text
    token = make_access_token(user_id, uuid.UUID(created.json()["id"]))
    kid = {"Authorization": f"Bearer {token}"}

    r = await client_env.client.get(f"{ME}/preferences", headers=kid)
    assert r.json() == EMPTY

    r = await client_env.client.put(
        f"{ME}/preferences",
        headers=kid,
        json={"genres": {"kinh-di": 2.0}, "countries": {}},
    )
    assert r.status_code == 200, r.text
    assert r.json()["genres"] == {"kinh-di": 2.0}

    r = await client_env.client.get(f"{ME}/preferences", headers=headers)
    assert r.json()["genres"] == {"hanh-dong": 2.0}
