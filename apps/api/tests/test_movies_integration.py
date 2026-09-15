"""Live upstream tests (need network). Run: pytest -m integration."""

import pytest
from fakeredis.aioredis import FakeRedis
from httpx import ASGITransport, AsyncClient

from app.main import app
from app.services import cache

pytestmark = pytest.mark.integration


@pytest.fixture
async def client(monkeypatch):
    monkeypatch.setattr(
        cache, "get_redis_client", lambda: FakeRedis(decode_responses=True)
    )
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as ac:
        yield ac


async def test_live_latest_and_detail_shape(client):
    r = await client.get("/api/v1/movies/latest?page=1")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["total_items"] > 0
    assert body["items"], "expected at least one movie"

    slug = body["items"][0]["slug"]
    r = await client.get(f"/api/v1/movies/{slug}")
    assert r.status_code == 200, r.text
    detail = r.json()
    assert detail["slug"] == slug
    assert isinstance(detail["servers"], list)
