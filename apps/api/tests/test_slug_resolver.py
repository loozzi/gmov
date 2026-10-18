"""Upstream slug renames: /movies/{slug}/resolve + profile data migration."""

import httpx
import pytest
import respx
from fakeredis.aioredis import FakeRedis

from app.core.config import settings
from app.services import cache
from tests.session_helpers import select_default

BASE = settings.nguonc_base_url
ME = "/api/v1/me"
POSTER = "https://img.nguonc.com/images/img-6469.png"

NOT_FOUND = {"status": "error", "message": "Movie doesn't exist"}


def _card(slug: str, name: str, poster: str) -> dict:
    return {"name": name, "slug": slug, "thumb_url": poster, "poster_url": poster}


def _search(*items: dict) -> dict:
    return {
        "status": "success",
        "paginate": {"current_page": 1, "total_page": 1},
        "items": list(items),
    }


@pytest.fixture(autouse=True)
def _redis(monkeypatch):
    client = FakeRedis(decode_responses=True)
    monkeypatch.setattr("app.services.slug_resolver.get_redis_client", lambda: client)
    monkeypatch.setattr("app.services.cache.get_redis_client", lambda: client)
    return client


async def _auth(client) -> dict:
    await client.post(
        "/api/v1/auth/register",
        json={"email": "s@gmov.dev", "username": "suser", "password": "password123"},
    )
    r = await client.post(
        "/api/v1/auth/login", data={"username": "suser", "password": "password123"}
    )
    token = await select_default(client, r.json()["access_token"])
    return {"Authorization": f"Bearer {token}"}


async def _watch(client, h, slug: str, episode: str) -> None:
    r = await client.put(
        f"{ME}/progress",
        headers=h,
        json={
            "movie_slug": slug,
            "movie_name": "Bác Sĩ X (Phần 1)",
            "poster_url": POSTER,
            "episode_slug": episode,
            "episode_name": episode,
            "position_seconds": 10,
            "duration_seconds": 100,
        },
    )
    assert r.status_code == 200, r.text


@respx.mock
async def test_resolve_follows_rename_and_migrates_progress(client):
    h = await _auth(client)
    await _watch(client, h, "bac-si-x-phan-1", "tap-1")
    await _watch(client, h, "bac-si-x-phan-1", "tap-2")
    await _watch(client, h, "bac-si-x", "tap-2")  # already watched under new slug

    respx.get(f"{BASE}/film/bac-si-x-phan-1").mock(
        return_value=httpx.Response(404, json=NOT_FOUND)
    )
    search = respx.get(f"{BASE}/films/search").mock(
        return_value=httpx.Response(
            200,
            json=_search(
                _card("bac-si-x-phim-dien-anh", "Bác Sĩ X: Phim Điện Ảnh", "o.png"),
                _card("bac-si-x", "Bác Sĩ X", POSTER),
            ),
        )
    )

    r = await client.get("/api/v1/movies/bac-si-x-phan-1/resolve")
    assert r.status_code == 200, r.text
    assert r.json() == {"slug": "bac-si-x"}
    assert search.calls.last.request.url.params["keyword"] == "bác sĩ x"

    r = await client.get(f"{ME}/progress/bac-si-x-phan-1", headers=h)
    assert r.status_code == 404
    assert (await client.get(f"{ME}/progress/bac-si-x", headers=h)).status_code == 200
    r = await client.get(f"{ME}/continue-watching", headers=h)
    assert r.status_code == 200, r.text
    assert [p["movie_slug"] for p in r.json()["items"]] == ["bac-si-x"]

    # cached: no second upstream search
    r = await client.get("/api/v1/movies/bac-si-x-phan-1/resolve")
    assert r.json() == {"slug": "bac-si-x"}
    assert search.call_count == 1


@respx.mock
async def test_resolve_live_slug_returns_itself(client):
    respx.get(f"{BASE}/film/mao").mock(
        return_value=httpx.Response(
            200, json={"status": "success", "movie": {"slug": "mao", "name": "Mao"}}
        )
    )
    r = await client.get("/api/v1/movies/mao/resolve")
    assert r.json() == {"slug": "mao"}


@respx.mock
async def test_resolve_unknown_slug_404_without_search(client):
    respx.get(f"{BASE}/film/gone").mock(
        return_value=httpx.Response(404, json=NOT_FOUND)
    )
    search = respx.get(f"{BASE}/films/search")
    r = await client.get("/api/v1/movies/gone/resolve")
    assert r.status_code == 404
    assert r.json()["code"] == "MOVIE_NOT_FOUND"
    assert search.call_count == 0


@respx.mock
async def test_detail_404_not_masked_by_stale(client, _redis):
    key = cache.cache_key("detail:old", {})
    await _redis.set(f"{key}:stale", '{"slug": "old", "name": "Old"}')
    respx.get(f"{BASE}/film/old").mock(
        return_value=httpx.Response(404, json=NOT_FOUND)
    )
    r = await client.get("/api/v1/movies/old")
    assert r.status_code == 404


@respx.mock
async def test_miss_never_overwrites_concurrent_alias(client, _redis, monkeypatch):
    """A request racing the migrating one finds no hints; it must not
    replace the alias with a cached miss."""
    from app.services import slug_resolver

    async def _hints(_db, _slug):
        # simulates: the other request resolved + migrated meanwhile
        await _redis.set("slug_alias:old", "new", ex=60)
        return set(), set()

    respx.get(f"{BASE}/film/old").mock(
        return_value=httpx.Response(404, json=NOT_FOUND)
    )
    monkeypatch.setattr(slug_resolver, "_hints", _hints)
    r = await client.get("/api/v1/movies/old/resolve")
    assert r.status_code == 404
    assert await _redis.get("slug_alias:old") == "new"
    r = await client.get("/api/v1/movies/old/resolve")
    assert r.json() == {"slug": "new"}
