"""Live upstream tests (need network). Run: pytest -m integration."""

import pytest
from fakeredis.aioredis import FakeRedis
from httpx import ASGITransport, AsyncClient

from app.main import app
from app.services import cache, nguonc

pytestmark = pytest.mark.integration


@pytest.fixture(autouse=True)
async def _fresh_upstream_client():
    """The upstream client is a module singleton bound to the loop that created
    it. pytest-asyncio gives every test its own loop, so the second test would
    otherwise reuse a client whose loop is already closed. Close it per test."""
    yield
    await nguonc.aclose_client()


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


async def test_live_related_shape(client):
    """Related is computed from live listings, so a genre film must come back
    with a ranked, self-excluded list and the public card shape."""
    listing = await client.get("/api/v1/movies/genre/hanh-dong?page=1")
    assert listing.status_code == 200, listing.text
    slug = listing.json()["items"][0]["slug"]

    r = await client.get(f"/api/v1/movies/{slug}/related?limit=6")
    assert r.status_code == 200, r.text
    items = r.json()["items"]

    assert 1 <= len(items) <= 6, "a film in a genre list should have candidates"
    assert slug not in [item["slug"] for item in items]
    for item in items:
        assert "director" not in item
        assert "casts" not in item
