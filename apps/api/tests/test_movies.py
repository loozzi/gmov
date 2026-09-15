"""Movie catalog tests with mocked upstream (respx) + fake redis."""

import httpx
import pytest
import respx
from fakeredis.aioredis import FakeRedis
from httpx import ASGITransport, AsyncClient

from app.core.config import settings
from app.main import app
from app.services import cache, nguonc

BASE = settings.nguonc_base_url

LIST_PAYLOAD = {
    "status": "success",
    "paginate": {
        "current_page": 1,
        "total_page": 100,
        "total_items": 1000,
        "items_per_page": 10,
    },
    "items": [
        {
            "name": "Mao",
            "slug": "mao",
            "original_name": "Mao",
            "thumb_url": "https://phim.nguonc.com/public/images/Post/2/mao.jpg",
            "poster_url": "https://phim.nguonc.com/public/images/Post/2/mao1.jpg",
            "description": "Test desc",
            "total_episodes": 24,
            "current_episode": "Hoàn tất (24/24)",
            "time": "23 phút/tập",
            "quality": "HD",
            "language": "Vietsub",
            "director": "Satou Teruo",
            "casts": None,
            "year": "2026",
        }
    ],
}

DETAIL_PAYLOAD = {
    "status": "success",
    "movie": {
        "id": "e7fbb55818def36977ba4a90d82958af",
        "name": "Mao",
        "slug": "mao",
        "original_name": "Mao",
        "thumb_url": "https://phim.nguonc.com/public/images/Post/2/mao.jpg",
        "poster_url": "https://phim.nguonc.com/public/images/Post/2/mao1.jpg",
        "description": "Test desc",
        "total_episodes": 24,
        "current_episode": "Hoàn tất (24/24)",
        "time": "23 phút/tập",
        "quality": "HD",
        "language": "Vietsub",
        "director": "Satou Teruo",
        "casts": None,
        "category": {
            "1": {
                "group": {"id": "g1", "name": "Định dạng"},
                "list": [{"id": "f1", "name": "Phim bộ"}],
            },
            "2": {
                "group": {"id": "g2", "name": "Thể loại"},
                "list": [{"id": "t1", "name": "Hoạt Hình"}],
            },
            "3": {
                "group": {"id": "g3", "name": "Năm"},
                "list": [{"id": "y1", "name": "2026"}],
            },
            "4": {
                "group": {"id": "g4", "name": "Quốc gia"},
                "list": [{"id": "c1", "name": "Nhật Bản"}],
            },
        },
        "episodes": [
            {
                "server_name": "Vietsub #1",
                "items": [
                    {
                        "name": "1",
                        "slug": "tap-1",
                        "embed": "https://embed12.streamc.xyz/embed.php?hash=abc",
                    }
                ],
            }
        ],
    },
}

CARD_KEYS = {
    "slug", "name", "original_name", "thumb_url", "poster_url", "description",
    "year", "quality", "language", "current_episode", "total_episodes", "time",
}


@pytest.fixture
def fake_redis(monkeypatch):
    client = FakeRedis(decode_responses=True)
    monkeypatch.setattr(cache, "get_redis_client", lambda: client)
    return client


@pytest.fixture
async def client():
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as ac:
        yield ac


@respx.mock
async def test_latest_normalizes_and_caches(client, fake_redis):
    route = respx.get(f"{BASE}/films/phim-moi-cap-nhat").mock(
        return_value=httpx.Response(200, json=LIST_PAYLOAD)
    )
    r = await client.get("/api/v1/movies/latest?page=1")
    assert r.status_code == 200, r.text
    assert r.headers["X-Cache"] == "MISS"
    body = r.json()
    assert body["current_page"] == 1
    assert body["total_items"] == 1000
    assert set(body["items"][0].keys()) <= CARD_KEYS  # no raw leak
    assert body["items"][0]["slug"] == "mao"

    r2 = await client.get("/api/v1/movies/latest?page=1")
    assert r2.headers["X-Cache"] == "HIT"
    assert r2.json() == body
    assert route.call_count == 1


@respx.mock
async def test_detail_servers_and_episodes(client, fake_redis):
    respx.get(f"{BASE}/film/mao").mock(
        return_value=httpx.Response(200, json=DETAIL_PAYLOAD)
    )
    r = await client.get("/api/v1/movies/mao")
    assert r.status_code == 200, r.text
    assert r.headers["X-Cache"] == "MISS"
    body = r.json()
    assert body["genres"] == ["Hoạt Hình"]
    assert body["countries"] == ["Nhật Bản"]
    assert body["servers"][0]["name"] == "Vietsub #1"
    ep = body["servers"][0]["episodes"][0]
    assert ep["slug"] == "tap-1"
    assert ep["embed_url"].startswith("https://embed")
    assert ep["m3u8_url"] is None


@respx.mock
async def test_stale_served_when_upstream_fails(client, fake_redis):
    respx.get(f"{BASE}/films/phim-moi-cap-nhat").mock(
        return_value=httpx.Response(200, json=LIST_PAYLOAD)
    )
    r = await client.get("/api/v1/movies/latest?page=1")
    assert r.headers["X-Cache"] == "MISS"

    # expire only the fresh key, keep the :stale copy; upstream now fails
    async for key in fake_redis.scan_iter(match="nguonc:latest:*"):
        if not key.endswith(":stale"):
            await fake_redis.delete(key)
    respx.get(f"{BASE}/films/phim-moi-cap-nhat").mock(
        return_value=httpx.Response(500, json={})
    )
    r = await client.get("/api/v1/movies/latest?page=1")
    assert r.status_code == 200
    assert r.headers["X-Cache"] == "STALE"
    assert r.json()["items"][0]["slug"] == "mao"


@respx.mock
async def test_upstream_down_without_cache_is_502(client, fake_redis):
    respx.get(f"{BASE}/films/phim-moi-cap-nhat").mock(
        return_value=httpx.Response(500, json={})
    )
    r = await client.get("/api/v1/movies/latest?page=2")
    assert r.status_code == 502
    assert r.json()["code"] == "UPSTREAM_ERROR"


@respx.mock
async def test_search_and_validation(client, fake_redis):
    respx.get(f"{BASE}/films/search").mock(
        return_value=httpx.Response(200, json=LIST_PAYLOAD)
    )
    r = await client.get("/api/v1/movies/search?keyword=mao")
    assert r.status_code == 200
    assert r.headers["X-Cache"] == "MISS"

    r = await client.get("/api/v1/movies/list/hoat-hinh")
    assert r.status_code == 404
    assert r.json()["code"] == "INVALID_LIST_TYPE"

    r = await client.get("/api/v1/movies/year/1800")
    assert r.status_code == 400
    assert r.json()["code"] == "INVALID_YEAR"


@respx.mock
async def test_invalidate_clears_cache(client, fake_redis):
    route = respx.get(f"{BASE}/films/phim-moi-cap-nhat").mock(
        return_value=httpx.Response(200, json=LIST_PAYLOAD)
    )
    await client.get("/api/v1/movies/latest?page=1")
    assert await cache.invalidate() > 0
    r = await client.get("/api/v1/movies/latest?page=1")
    assert r.headers["X-Cache"] == "MISS"
    assert route.call_count == 2


async def test_relative_image_becomes_absolute():
    card = nguonc.to_card(
        {"slug": "x", "name": "X", "thumb_url": "/public/images/x.jpg"}
    )
    assert card.thumb_url == "https://phim.nguonc.com/public/images/x.jpg"
