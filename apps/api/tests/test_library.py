"""Personal library tests: progress, continue-watching, favorites, watchlist."""

import pytest_asyncio
from fakeredis.aioredis import FakeRedis
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.core import ratelimit
from app.db.base import Base
from app.db.session import get_db
from app.main import app
from tests.session_helpers import select_default

ME = "/api/v1/me"


@pytest_asyncio.fixture
async def client(tmp_path, monkeypatch):
    db_path = tmp_path / "lib.db"
    engine = create_async_engine(f"sqlite+aiosqlite:///{db_path}")
    factory = async_sessionmaker(engine, expire_on_commit=False)

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    async def override_get_db():
        async with factory() as session:
            yield session

    monkeypatch.setattr(
        ratelimit, "get_redis_client", lambda _c=FakeRedis(decode_responses=True): _c
    )
    app.dependency_overrides[get_db] = override_get_db
    try:
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as ac:
            yield ac
    finally:
        app.dependency_overrides.clear()
        await engine.dispose()


async def _auth_headers(client) -> dict:
    await client.post(
        "/api/v1/auth/register",
        json={
            "email": "lib@gmov.dev",
            "username": "libuser",
            "password": "password123",
        },
    )
    r = await client.post(
        "/api/v1/auth/login",
        data={"username": "libuser", "password": "password123"},
    )
    token = r.json()["access_token"]
    token = await select_default(client, token)
    return {"Authorization": f"Bearer {token}"}


def _progress(movie="mao", episode="tap-1", position=100, duration=1400):
    return {
        "movie_slug": movie,
        "movie_name": "Mao",
        "poster_url": "https://example.com/p.jpg",
        "episode_slug": episode,
        "episode_name": "Tap 1",
        "server_name": "Vietsub #1",
        "position_seconds": position,
        "duration_seconds": duration,
    }


async def test_progress_upsert_get_delete(client):
    h = await _auth_headers(client)

    r = await client.put(f"{ME}/progress", headers=h, json=_progress())
    assert r.status_code == 200, r.text
    assert r.json()["position_seconds"] == 100

    # upsert same episode updates position
    r = await client.put(f"{ME}/progress", headers=h, json=_progress(position=250))
    assert r.status_code == 200
    assert r.json()["position_seconds"] == 250

    # player resume point
    r = await client.get(f"{ME}/progress/mao", headers=h)
    assert r.status_code == 200
    assert r.json()["episode_slug"] == "tap-1"

    r = await client.delete(f"{ME}/progress/mao", headers=h)
    assert r.status_code == 200

    r = await client.get(f"{ME}/progress/mao", headers=h)
    assert r.status_code == 404
    assert r.json()["code"] == "PROGRESS_NOT_FOUND"


async def test_progress_rejects_position_over_duration(client):
    h = await _auth_headers(client)
    r = await client.put(
        f"{ME}/progress", headers=h, json=_progress(position=1500, duration=1400)
    )
    assert r.status_code == 422
    assert r.json()["code"] == "VALIDATION_ERROR"


async def test_continue_watching_latest_per_movie(client):
    h = await _auth_headers(client)
    await client.put(f"{ME}/progress", headers=h, json=_progress("mao", "tap-1"))
    await client.put(f"{ME}/progress", headers=h, json=_progress("mao", "tap-2"))
    await client.put(f"{ME}/progress", headers=h, json=_progress("ve-dep", "tap-full"))

    r = await client.get(f"{ME}/continue-watching", headers=h)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["total_items"] == 2
    assert [i["movie_slug"] for i in body["items"]] == ["ve-dep", "mao"]
    assert body["items"][1]["episode_slug"] == "tap-2"  # latest episode of mao


async def test_favorites_flow(client):
    h = await _auth_headers(client)
    fav = {"movie_slug": "mao", "movie_name": "Mao"}

    r = await client.post(f"{ME}/favorites", headers=h, json=fav)
    assert r.status_code == 201, r.text

    r = await client.get(f"{ME}/favorites/mao/status", headers=h)
    assert r.json() == {"is_favorite": True}

    r = await client.get(f"{ME}/favorites", headers=h)
    assert r.status_code == 200
    assert r.json()["total_items"] == 1

    # duplicate add is idempotent
    r = await client.post(f"{ME}/favorites", headers=h, json=fav)
    assert r.status_code == 200
    r = await client.get(f"{ME}/favorites", headers=h)
    assert r.json()["total_items"] == 1

    r = await client.delete(f"{ME}/favorites/mao", headers=h)
    assert r.status_code == 200
    r = await client.get(f"{ME}/favorites/mao/status", headers=h)
    assert r.json() == {"is_favorite": False}


async def test_progress_rate_limited(client):
    h = await _auth_headers(client)
    statuses = set()
    for _ in range(21):
        r = await client.put(f"{ME}/progress", headers=h, json=_progress())
        statuses.add(r.status_code)
    assert 200 in statuses
    assert 429 in statuses
    # last response shape check
    assert r.json()["code"] == "RATE_LIMITED"


async def test_me_requires_auth(client):
    r = await client.get(f"{ME}/continue-watching")
    assert r.status_code == 401
    r = await client.put(f"{ME}/progress", json=_progress())
    assert r.status_code == 401


async def test_watched_episodes_flow(client):
    h = await _auth_headers(client)

    r = await client.get(f"{ME}/watched/mao", headers=h)
    assert r.status_code == 200
    assert r.json() == {"episode_slugs": []}

    # 95% watched counts
    await client.put(
        f"{ME}/progress", headers=h, json=_progress("mao", "tap-1", 950, 1000)
    )
    # 50% does not
    await client.put(
        f"{ME}/progress", headers=h, json=_progress("mao", "tap-2", 500, 1000)
    )
    r = await client.get(f"{ME}/watched/mao", headers=h)
    assert r.json() == {"episode_slugs": ["tap-1"]}

    # explicit marker (embed player without time access)
    r = await client.post(
        f"{ME}/watched",
        headers=h,
        json={
            "movie_slug": "mao",
            "movie_name": "Mao",
            "episode_slug": "tap-3",
            "episode_name": "Tap 3",
        },
    )
    assert r.status_code == 200
    r = await client.get(f"{ME}/watched/mao", headers=h)
    assert sorted(r.json()["episode_slugs"]) == ["tap-1", "tap-3"]


async def test_watchlist_flow(client):
    h = await _auth_headers(client)
    item = {"movie_slug": "mao", "movie_name": "Mao"}

    r = await client.post(f"{ME}/watchlist", headers=h, json=item)
    assert r.status_code == 201, r.text

    r = await client.get(f"{ME}/watchlist/mao/status", headers=h)
    assert r.json() == {"is_saved": True}

    r = await client.get(f"{ME}/watchlist", headers=h)
    assert r.status_code == 200
    assert r.json()["total_items"] == 1

    # duplicate add is idempotent
    r = await client.post(f"{ME}/watchlist", headers=h, json=item)
    assert r.status_code == 200
    r = await client.get(f"{ME}/watchlist", headers=h)
    assert r.json()["total_items"] == 1

    r = await client.delete(f"{ME}/watchlist/mao", headers=h)
    assert r.status_code == 200
    r = await client.get(f"{ME}/watchlist/mao/status", headers=h)
    assert r.json() == {"is_saved": False}


async def test_progress_upsert_stores_episode_position(client):
    h = await _auth_headers(client)
    body = {**_progress(), "episode_index": 2, "total_episodes": 12}

    r = await client.put(f"{ME}/progress", headers=h, json=body)
    assert r.status_code == 200, r.text
    assert r.json()["episode_index"] == 2
    assert r.json()["total_episodes"] == 12

    r = await client.get(f"{ME}/progress/mao", headers=h)
    assert r.json()["episode_index"] == 2
    assert r.json()["total_episodes"] == 12


async def test_progress_rejects_index_over_total(client):
    h = await _auth_headers(client)
    body = {**_progress(), "episode_index": 13, "total_episodes": 12}

    r = await client.put(f"{ME}/progress", headers=h, json=body)
    assert r.status_code == 422
    assert r.json()["code"] == "VALIDATION_ERROR"


async def test_watched_marker_stores_episode_position(client):
    h = await _auth_headers(client)

    r = await client.post(
        f"{ME}/watched",
        headers=h,
        json={
            "movie_slug": "mao",
            "movie_name": "Mao",
            "episode_slug": "tap-3",
            "episode_name": "3",
            "episode_index": 3,
            "total_episodes": 12,
        },
    )
    assert r.status_code == 200, r.text

    r = await client.get(f"{ME}/progress/mao", headers=h)
    assert r.json()["episode_slug"] == "tap-3"
    assert r.json()["episode_index"] == 3
    assert r.json()["total_episodes"] == 12


async def test_watched_marker_rejects_index_over_total(client):
    h = await _auth_headers(client)

    r = await client.post(
        f"{ME}/watched",
        headers=h,
        json={
            "movie_slug": "mao",
            "movie_name": "Mao",
            "episode_slug": "tap-3",
            "episode_name": "3",
            "episode_index": 13,
            "total_episodes": 12,
        },
    )
    assert r.status_code == 422
    assert r.json()["code"] == "VALIDATION_ERROR"


async def test_progress_upsert_removes_from_watchlist(client):
    h = await _auth_headers(client)
    r = await client.post(
        f"{ME}/watchlist",
        headers=h,
        json={"movie_slug": "mao", "movie_name": "Mao"},
    )
    assert r.status_code == 201, r.text

    r = await client.put(f"{ME}/progress", headers=h, json=_progress())
    assert r.status_code == 200, r.text

    r = await client.get(f"{ME}/watchlist/mao/status", headers=h)
    assert r.json() == {"is_saved": False}
