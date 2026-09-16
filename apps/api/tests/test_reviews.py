"""Reviews tests: star ratings + comments (TDD RED)."""

import pytest_asyncio
from fakeredis.aioredis import FakeRedis
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.core import ratelimit
from app.db.base import Base
from app.db.session import get_db
from app.main import app

ME = "/api/v1/me"


@pytest_asyncio.fixture
async def client(tmp_path, monkeypatch):
    db_path = tmp_path / "reviews.db"
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


async def _register_login(client, email: str, username: str) -> dict:
    await client.post(
        "/api/v1/auth/register",
        json={
            "email": email,
            "username": username,
            "password": "password123",
        },
    )
    r = await client.post(
        "/api/v1/auth/login",
        data={"username": username, "password": "password123"},
    )
    assert r.status_code == 200, r.text
    token = r.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


async def test_rating_upsert_and_update(client):
    h = await _register_login(client, "r1@gmov.dev", "ruser1")

    r = await client.put(
        f"{ME}/ratings", headers=h, json={"movie_slug": "mao", "stars": 4}
    )
    assert r.status_code == 200, r.text
    assert r.json() == {"movie_slug": "mao", "stars": 4}

    # second PUT wins (upsert)
    r = await client.put(
        f"{ME}/ratings", headers=h, json={"movie_slug": "mao", "stars": 5}
    )
    assert r.status_code == 200, r.text
    assert r.json() == {"movie_slug": "mao", "stars": 5}

    r = await client.get(f"{ME}/ratings/mao/status", headers=h)
    assert r.status_code == 200
    assert r.json() == {"stars": 5}


async def test_rating_invalid_stars(client):
    h = await _register_login(client, "r2@gmov.dev", "ruser2")
    for bad in (0, 6):
        r = await client.put(
            f"{ME}/ratings", headers=h, json={"movie_slug": "mao", "stars": bad}
        )
        assert r.status_code == 422, r.text
        assert r.json()["code"] == "VALIDATION_ERROR"


async def test_rating_status_null_then_value(client):
    h = await _register_login(client, "r3@gmov.dev", "ruser3")

    r = await client.get(f"{ME}/ratings/mao/status", headers=h)
    assert r.status_code == 200, r.text
    assert r.json() == {"stars": None}

    await client.put(
        f"{ME}/ratings", headers=h, json={"movie_slug": "mao", "stars": 3}
    )
    r = await client.get(f"{ME}/ratings/mao/status", headers=h)
    assert r.json() == {"stars": 3}


async def test_rating_summary_average_math_public(client):
    h1 = await _register_login(client, "ra@gmov.dev", "rauser")
    h2 = await _register_login(client, "rb@gmov.dev", "rbuser")

    await client.put(
        f"{ME}/ratings", headers=h1, json={"movie_slug": "mao", "stars": 4}
    )
    await client.put(
        f"{ME}/ratings", headers=h2, json={"movie_slug": "mao", "stars": 5}
    )

    # PUBLIC without auth
    r = await client.get("/api/v1/movies/mao/rating")
    assert r.status_code == 200, r.text
    assert r.json() == {"average": 4.5, "count": 2}


async def test_rating_summary_empty_movie(client):
    r = await client.get("/api/v1/movies/nothing-here/rating")
    assert r.status_code == 200, r.text
    assert r.json() == {"average": None, "count": 0}


async def test_rating_delete_idempotent(client):
    h = await _register_login(client, "r4@gmov.dev", "ruser4")
    await client.put(
        f"{ME}/ratings", headers=h, json={"movie_slug": "mao", "stars": 4}
    )
    r = await client.delete(f"{ME}/ratings/mao", headers=h)
    assert r.status_code == 200, r.text
    assert r.json() == {"ok": True}

    r = await client.get(f"{ME}/ratings/mao/status", headers=h)
    assert r.json() == {"stars": None}

    # idempotent second delete
    r = await client.delete(f"{ME}/ratings/mao", headers=h)
    assert r.status_code == 200
    assert r.json() == {"ok": True}


async def test_rating_requires_auth(client):
    r = await client.put(
        f"{ME}/ratings", json={"movie_slug": "mao", "stars": 5}
    )
    assert r.status_code == 401
    r = await client.get(f"{ME}/ratings/mao/status")
    assert r.status_code == 401


async def test_comment_create_list_reply(client):
    h = await _register_login(client, "c1@gmov.dev", "cuser1")

    r = await client.post(
        f"{ME}/comments",
        headers=h,
        json={"movie_slug": "mao", "body": "Great movie"},
    )
    assert r.status_code == 201, r.text
    top = r.json()
    assert top["movie_slug"] == "mao"
    assert top["body"] == "Great movie"
    assert top["user"]["username"] == "cuser1"
    assert "id" in top and "created_at" in top
    top_id = top["id"]

    # reply
    r = await client.post(
        f"{ME}/comments",
        headers=h,
        json={"movie_slug": "mao", "body": "I agree", "parent_id": top_id},
    )
    assert r.status_code == 201, r.text

    r = await client.get("/api/v1/comments", params={"movie_slug": "mao"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["total_items"] == 1
    item = body["items"][0]
    assert item["body"] == "Great movie"
    assert item["reply_count"] == 1
    assert len(item["replies"]) == 1
    assert item["replies"][0]["body"] == "I agree"


async def test_comment_reply_to_reply_rejected(client):
    h = await _register_login(client, "c2@gmov.dev", "cuser2")
    r = await client.post(
        f"{ME}/comments",
        headers=h,
        json={"movie_slug": "mao", "body": "top"},
    )
    top_id = r.json()["id"]
    r = await client.post(
        f"{ME}/comments",
        headers=h,
        json={"movie_slug": "mao", "body": "reply", "parent_id": top_id},
    )
    assert r.status_code == 201, r.text
    reply_id = r.json()["id"]

    r = await client.post(
        f"{ME}/comments",
        headers=h,
        json={"movie_slug": "mao", "body": "nested", "parent_id": reply_id},
    )
    assert r.status_code == 422, r.text


async def test_comment_reply_other_movie_rejected(client):
    h = await _register_login(client, "c3@gmov.dev", "cuser3")
    r = await client.post(
        f"{ME}/comments",
        headers=h,
        json={"movie_slug": "movie-a", "body": "top-a"},
    )
    assert r.status_code == 201, r.text
    top_id = r.json()["id"]

    r = await client.post(
        f"{ME}/comments",
        headers=h,
        json={"movie_slug": "movie-b", "body": "bad reply", "parent_id": top_id},
    )
    assert r.status_code == 422, r.text


async def test_comment_delete_cascades_replies(client):
    h = await _register_login(client, "c4@gmov.dev", "cuser4")
    r = await client.post(
        f"{ME}/comments",
        headers=h,
        json={"movie_slug": "mao", "body": "top"},
    )
    top_id = r.json()["id"]
    await client.post(
        f"{ME}/comments",
        headers=h,
        json={"movie_slug": "mao", "body": "child", "parent_id": top_id},
    )

    r = await client.delete(f"{ME}/comments/{top_id}", headers=h)
    assert r.status_code == 200, r.text
    assert r.json() == {"ok": True}

    r = await client.get("/api/v1/comments", params={"movie_slug": "mao"})
    assert r.json()["total_items"] == 0


async def test_comment_delete_other_user_404(client):
    h1 = await _register_login(client, "c5a@gmov.dev", "cuser5a")
    h2 = await _register_login(client, "c5b@gmov.dev", "cuser5b")

    r = await client.post(
        f"{ME}/comments", headers=h1, json={"movie_slug": "mao", "body": "mine"}
    )
    cid = r.json()["id"]

    r = await client.delete(f"{ME}/comments/{cid}", headers=h2)
    assert r.status_code == 404, r.text
    assert r.json()["code"] == "COMMENT_NOT_FOUND"


async def test_comment_list_public_without_auth(client):
    h = await _register_login(client, "c6@gmov.dev", "cuser6")
    await client.post(
        f"{ME}/comments", headers=h, json={"movie_slug": "mao", "body": "hello"}
    )
    r = await client.get("/api/v1/comments", params={"movie_slug": "mao"})
    assert r.status_code == 200, r.text
    assert r.json()["total_items"] == 1


async def test_comment_list_missing_slug_422(client):
    r = await client.get("/api/v1/comments")
    assert r.status_code == 422, r.text
    r = await client.get("/api/v1/comments", params={"movie_slug": ""})
    assert r.status_code == 422, r.text


async def test_comment_requires_auth(client):
    r = await client.post(
        "/api/v1/me/comments", json={"movie_slug": "mao", "body": "hi"}
    )
    assert r.status_code == 401
