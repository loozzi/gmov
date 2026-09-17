"""Recommendation engine + `GET /me/recommendations` (TDD)."""

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
from app.services import cache as cache_service
from tests.conftest import make_access_token

ME = "/api/v1/me"
RECS = f"{ME}/recommendations"


@dataclass
class Env:
    client: AsyncClient
    factory: async_sessionmaker


@pytest_asyncio.fixture
async def client_env(tmp_path, monkeypatch):
    db_path = tmp_path / "recommendations.db"
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


async def _create_profile(env: Env, headers: dict, name: str) -> uuid.UUID:
    r = await env.client.post(
        f"{ME}/profiles", headers=headers, json={"name": name, "avatar": "cat"}
    )
    assert r.status_code == 201, r.text
    return uuid.UUID(r.json()["id"])


async def _set_prefs(
    env: Env,
    headers: dict,
    genres: dict[str, float],
    countries: dict[str, float] | None = None,
    *,
    skipped: bool = False,
) -> None:
    r = await env.client.put(
        f"{ME}/preferences",
        headers=headers,
        json={
            "genres": genres,
            "countries": countries or {},
            "skipped": skipped,
        },
    )
    assert r.status_code == 200, r.text


async def _seed_catalog(env: Env, items: list[dict]) -> None:
    async with env.factory() as session:
        for item in items:
            session.add(
                CatalogItem(
                    slug=item["slug"],
                    name=item.get("name", item["slug"]),
                    year=item.get("year"),
                    genres=item.get("genres", []),
                    country=item.get("country"),
                    casts=item.get("casts"),
                    director=item.get("director"),
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


async def test_personal_ranking_prefers_multi_genre_match(client_env):
    headers, _ = await _register_login(client_env, "rec1@gmov.dev", "rec1")
    await _set_prefs(client_env, headers, {"hanh-dong": 2.0, "kinh-di": 1.0})
    await _seed_catalog(
        client_env,
        [
            {"slug": "combo", "genres": ["hanh-dong", "kinh-di"]},
            {"slug": "action", "genres": ["hanh-dong"]},
            {"slug": "horror", "genres": ["kinh-di"]},
        ],
    )

    r = await client_env.client.get(RECS, headers=headers)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["source"] == "personal"
    slugs = [item["movie"]["slug"] for item in body["items"]]
    assert slugs == ["combo", "action", "horror"]
    reasons = {item["movie"]["slug"]: item["reason"] for item in body["items"]}
    assert reasons["combo"] == "Vì bạn thích Hành Động"
    assert reasons["action"] == "Vì bạn thích Hành Động"
    assert reasons["horror"] == "Vì bạn thích Kinh Dị"


async def test_excludes_favorites_and_finished_but_keeps_in_progress(client_env):
    headers, _ = await _register_login(client_env, "rec2@gmov.dev", "rec2")
    pid = await _profile_id(client_env, headers)
    await _set_prefs(client_env, headers, {"hanh-dong": 2.0})
    await _seed_catalog(
        client_env,
        [
            {"slug": "fav", "genres": ["hanh-dong"]},
            {"slug": "done", "genres": ["hanh-dong"]},
            {"slug": "partial", "genres": ["hanh-dong"]},
        ],
    )
    await _seed_signals(
        client_env,
        pid,
        favorites=("fav",),
        progress=(("done", 90, 100), ("partial", 50, 100)),
    )

    r = await client_env.client.get(RECS, headers=headers)
    slugs = [item["movie"]["slug"] for item in r.json()["items"]]
    assert "fav" not in slugs
    assert "done" not in slugs
    assert slugs == ["partial"]


async def test_people_overlap_boosts_score(client_env):
    headers, _ = await _register_login(client_env, "rec3@gmov.dev", "rec3")
    pid = await _profile_id(client_env, headers)
    await _set_prefs(client_env, headers, {"hanh-dong": 1.0, "kinh-di": 1.0})
    await _seed_catalog(
        client_env,
        [
            {"slug": "seed-fav", "genres": [], "director": "Đạo diễn B"},
            {"slug": "seed-rated", "genres": [], "casts": "Diễn viên A"},
            {"slug": "cand-cast", "genres": ["hanh-dong"], "casts": "Diễn viên A"},
            {
                "slug": "cand-dir",
                "genres": ["kinh-di"],
                "director": "Đạo diễn B",
            },
            {
                "slug": "stranger",
                "genres": ["hanh-dong", "kinh-di"],
                "casts": "Diễn viên C",
            },
        ],
    )
    await _seed_signals(
        client_env,
        pid,
        favorites=("seed-fav",),
        ratings=(("seed-rated", 5),),
    )

    r = await client_env.client.get(RECS, headers=headers)
    slugs = [item["movie"]["slug"] for item in r.json()["items"]]
    assert slugs == ["cand-cast", "cand-dir", "stranger", "seed-rated"]
    assert slugs.index("cand-cast") < slugs.index("stranger")
    assert "seed-fav" not in slugs


async def test_internal_average_is_proportional(client_env):
    headers, _ = await _register_login(client_env, "rec10@gmov.dev", "rec10")
    pid = await _profile_id(client_env, headers)
    p2 = await _create_profile(client_env, headers, "P2")
    p3 = await _create_profile(client_env, headers, "P3")
    await _set_prefs(client_env, headers, {"hanh-dong": 1.0})
    await _seed_catalog(
        client_env,
        [
            {"slug": "zzz-high", "genres": ["hanh-dong"]},
            {"slug": "aaa-low", "genres": ["hanh-dong"]},
        ],
    )
    for profile in (pid, p2, p3):
        await _seed_signals(
            client_env,
            profile,
            ratings=(("zzz-high", 5), ("aaa-low", 3)),
        )

    r = await client_env.client.get(RECS, headers=headers)
    slugs = [item["movie"]["slug"] for item in r.json()["items"]]
    assert slugs == ["zzz-high", "aaa-low"]


async def test_not_onboarded_returns_popular(client_env):
    headers, _ = await _register_login(client_env, "rec4@gmov.dev", "rec4")
    pid = await _profile_id(client_env, headers)
    p2 = await _create_profile(client_env, headers, "P2")
    p3 = await _create_profile(client_env, headers, "P3")
    await _seed_catalog(
        client_env,
        [
            {"slug": "popular", "genres": ["hanh-dong"], "year": 2015},
            {"slug": "unrated", "genres": ["kinh-di"], "year": 2024},
        ],
    )
    await _seed_signals(client_env, pid, ratings=(("popular", 5),))
    await _seed_signals(client_env, p2, ratings=(("popular", 5),))
    await _seed_signals(client_env, p3, ratings=(("popular", 5),))

    r = await client_env.client.get(RECS, headers=headers)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["source"] == "popular"
    slugs = [item["movie"]["slug"] for item in body["items"]]
    assert slugs[0] == "popular"
    assert set(slugs) == {"popular", "unrated"}
    assert all(item["reason"] is None for item in body["items"])


async def test_no_qualifying_ratings_returns_newest(client_env):
    headers, _ = await _register_login(client_env, "rec5@gmov.dev", "rec5")
    pid = await _profile_id(client_env, headers)
    p2 = await _create_profile(client_env, headers, "P2")
    await _seed_catalog(
        client_env,
        [
            {"slug": "old", "year": 2019},
            {"slug": "new", "year": 2026},
            {"slug": "undated", "year": None},
        ],
    )
    await _seed_signals(client_env, pid, ratings=(("old", 5),))
    await _seed_signals(client_env, p2, ratings=(("old", 5),))

    r = await client_env.client.get(RECS, headers=headers)
    body = r.json()
    assert body["source"] == "newest"
    slugs = [item["movie"]["slug"] for item in body["items"]]
    assert slugs == ["new", "old", "undated"]
    assert all(item["reason"] is None for item in body["items"])


async def test_skipped_onboarding_returns_fallback(client_env):
    headers, _ = await _register_login(client_env, "rec6@gmov.dev", "rec6")
    await _set_prefs(client_env, headers, {}, skipped=True)
    await _seed_catalog(client_env, [{"slug": "base", "genres": ["hanh-dong"]}])

    r = await client_env.client.get(RECS, headers=headers)
    body = r.json()
    assert body["source"] == "newest"
    assert [item["movie"]["slug"] for item in body["items"]] == ["base"]
    assert body["items"][0]["reason"] is None


async def test_cache_hit_ignores_db_changes(client_env):
    headers, _ = await _register_login(client_env, "rec7@gmov.dev", "rec7")
    await _set_prefs(client_env, headers, {"hanh-dong": 2.0})
    await _seed_catalog(client_env, [{"slug": "base", "genres": ["hanh-dong"]}])

    first = (await client_env.client.get(RECS, headers=headers)).json()
    await _seed_catalog(
        client_env, [{"slug": "intruder", "genres": ["hanh-dong"]}]
    )
    second = (await client_env.client.get(RECS, headers=headers)).json()

    assert second == first
    assert "intruder" not in [item["movie"]["slug"] for item in second["items"]]


async def test_reset_preferences_busts_cache(client_env):
    headers, _ = await _register_login(client_env, "rec8@gmov.dev", "rec8")
    await _set_prefs(client_env, headers, {"hanh-dong": 2.0})
    await _seed_catalog(client_env, [{"slug": "base", "genres": ["hanh-dong"]}])

    first = (await client_env.client.get(RECS, headers=headers)).json()
    assert first["source"] == "personal"

    r = await client_env.client.delete(f"{ME}/preferences", headers=headers)
    assert r.status_code == 204, r.text

    second = (await client_env.client.get(RECS, headers=headers)).json()
    assert second["source"] == "newest"
    assert [item["movie"]["slug"] for item in second["items"]] == ["base"]


async def test_limit_clamped_to_range(client_env):
    headers, _ = await _register_login(client_env, "rec9@gmov.dev", "rec9")
    await _set_prefs(client_env, headers, {"hanh-dong": 2.0})
    await _seed_catalog(
        client_env,
        [
            {"slug": "a", "genres": ["hanh-dong"]},
            {"slug": "b", "genres": ["hanh-dong"]},
            {"slug": "c", "genres": ["hanh-dong"]},
        ],
    )

    r = await client_env.client.get(f"{RECS}?limit=1", headers=headers)
    assert len(r.json()["items"]) == 1

    r = await client_env.client.get(f"{RECS}?limit=100", headers=headers)
    assert len(r.json()["items"]) == 3


async def test_negative_only_match_has_no_reason(client_env):
    headers, _ = await _register_login(client_env, "rec11@gmov.dev", "rec11")
    pid = await _profile_id(client_env, headers)
    await _set_prefs(client_env, headers, {})
    await _seed_catalog(
        client_env,
        [
            {"slug": "rated-bad", "genres": ["kinh-di"]},
            {"slug": "candidate", "genres": ["kinh-di"]},
        ],
    )
    await _seed_signals(client_env, pid, ratings=(("rated-bad", 1),))

    r = await client_env.client.get(RECS, headers=headers)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["source"] == "personal"
    by_slug = {item["movie"]["slug"]: item for item in body["items"]}
    assert by_slug["candidate"]["reason"] is None


async def test_recommendations_are_isolated_per_profile(client_env):
    headers, user_id = await _register_login(client_env, "rec12@gmov.dev", "rec12")
    pid_b = await _create_profile(client_env, headers, "B")
    b_headers = {
        "Authorization": f"Bearer {make_access_token(user_id, pid_b)}"
    }
    await _set_prefs(client_env, headers, {"hanh-dong": 2.0})
    await _set_prefs(client_env, b_headers, {"kinh-di": 2.0})
    await _seed_catalog(
        client_env,
        [
            {"slug": "a-first", "genres": ["hanh-dong"]},
            {
                "slug": "a-second",
                "genres": ["hanh-dong"],
                "casts": "Shared Actor",
            },
            {
                "slug": "b-seed",
                "genres": ["kinh-di"],
                "casts": "Shared Actor",
            },
            {"slug": "b-cand", "genres": ["kinh-di"], "casts": "Shared Actor"},
        ],
    )

    baseline_a = (await client_env.client.get(RECS, headers=headers)).json()
    assert [item["movie"]["slug"] for item in baseline_a["items"]] == [
        "a-first",
        "a-second",
        "b-cand",
        "b-seed",
    ]

    await cache_service.invalidate("")
    await _seed_signals(
        client_env, pid_b, favorites=("b-seed",), ratings=(("b-seed", 5),)
    )

    after_a = (await client_env.client.get(RECS, headers=headers)).json()
    assert after_a == baseline_a

    b_resp = (await client_env.client.get(RECS, headers=b_headers)).json()
    assert b_resp != after_a
