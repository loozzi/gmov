"""Per-profile isolation of viewing data (favorites/watchlist/progress/ratings)."""

from httpx import AsyncClient

from tests.conftest import make_access_token
from tests.session_helpers import select_default

AUTH = "/api/v1/auth"
ME = "/api/v1/me"


def _bearer(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def _register_login(
    client: AsyncClient, email: str, username: str
) -> tuple[dict[str, str], str]:
    r = await client.post(
        f"{AUTH}/register",
        json={"email": email, "username": username, "password": "password123"},
    )
    assert r.status_code == 201, r.text
    user_id = r.json()["id"]
    r = await client.post(
        f"{AUTH}/login",
        data={"username": username, "password": "password123"},
    )
    assert r.status_code == 200, r.text
    token = await select_default(client, r.json()["access_token"])
    return _bearer(token), user_id


async def _current_profile_id(client: AsyncClient, headers: dict) -> str:
    r = await client.get(f"{ME}/profile", headers=headers)
    assert r.status_code == 200, r.text
    return r.json()["id"]


async def _create_profile(
    client: AsyncClient, headers: dict, name: str
) -> str:
    r = await client.post(
        f"{ME}/profiles", headers=headers, json={"name": name, "avatar": "cat"}
    )
    assert r.status_code == 201, r.text
    return r.json()["id"]


def _progress(movie: str = "mao") -> dict:
    return {
        "movie_slug": movie,
        "movie_name": "Mao",
        "episode_slug": "tap-1",
        "episode_name": "Tap 1",
        "position_seconds": 100,
        "duration_seconds": 1400,
    }


async def test_favorites_are_isolated_per_profile(client):
    h1, user_id = await _register_login(client, "iso-fav@gmov.dev", "isofav")
    await client.post(
        f"{ME}/favorites",
        headers=h1,
        json={"movie_slug": "mao", "movie_name": "Mao"},
    )
    second = await _create_profile(client, h1, "Kid")
    h2 = _bearer(make_access_token(user_id, second))

    r = await client.get(f"{ME}/favorites", headers=h2)
    assert r.json()["total_items"] == 0
    r = await client.get(f"{ME}/favorites/mao/status", headers=h2)
    assert r.json() == {"is_favorite": False}

    await client.post(
        f"{ME}/favorites",
        headers=h2,
        json={"movie_slug": "ve-dep", "movie_name": "Ve dep"},
    )
    r = await client.get(f"{ME}/favorites", headers=h1)
    assert [i["movie_slug"] for i in r.json()["items"]] == ["mao"]

    await client.delete(f"{ME}/favorites/mao", headers=h2)
    r = await client.get(f"{ME}/favorites/mao/status", headers=h1)
    assert r.json() == {"is_favorite": True}


async def test_watchlist_and_progress_and_rating_are_isolated(client):
    h1, user_id = await _register_login(client, "iso-all@gmov.dev", "isoall")
    second = await _create_profile(client, h1, "Kid")
    h2 = _bearer(make_access_token(user_id, second))

    await client.post(
        f"{ME}/watchlist",
        headers=h1,
        json={"movie_slug": "mao", "movie_name": "Mao"},
    )
    await client.put(f"{ME}/progress", headers=h1, json=_progress())
    await client.put(
        f"{ME}/ratings", headers=h1, json={"movie_slug": "mao", "stars": 5}
    )

    r = await client.get(f"{ME}/watchlist", headers=h2)
    assert r.json()["total_items"] == 0
    r = await client.get(f"{ME}/progress/mao", headers=h2)
    assert r.status_code == 404
    r = await client.get(f"{ME}/ratings/mao/status", headers=h2)
    assert r.json() == {"stars": None}

    await client.put(
        f"{ME}/ratings", headers=h2, json={"movie_slug": "mao", "stars": 2}
    )
    r = await client.get(f"{ME}/ratings/mao/status", headers=h1)
    assert r.json() == {"stars": 5}
    r = await client.get(f"{ME}/watchlist/mao/status", headers=h2)
    assert r.json() == {"is_saved": False}


async def test_guest_progress_merge_lands_in_active_profile(client):
    h1, _ = await _register_login(client, "iso-guest@gmov.dev", "isoguest")
    first = await _current_profile_id(client, h1)
    second = await _create_profile(client, h1, "Kid")
    r = await client.post(
        f"{ME}/profiles/{second}/switch", headers=h1, json={}
    )
    assert r.status_code == 200, r.text
    h2 = _bearer(r.json()["access_token"])

    r = await client.put(
        f"{ME}/progress", headers=h2, json=_progress("guest-movie")
    )
    assert r.status_code == 200, r.text

    r = await client.get(f"{ME}/progress/guest-movie", headers=h2)
    assert r.status_code == 200, r.text
    # The old token (and its profile) no longer matches the session, so it is
    # not a way to look at the first profile: switch back to it instead.
    r = await client.get(f"{ME}/progress/guest-movie", headers=h1)
    assert r.status_code == 403, r.text
    assert r.json()["code"] == "PROFILE_REQUIRED"
    back = await client.post(
        f"{ME}/profiles/{first}/switch", headers=h2, json={}
    )
    assert back.status_code == 200, back.text
    h1b = _bearer(back.json()["access_token"])
    r = await client.get(f"{ME}/progress/guest-movie", headers=h1b)
    assert r.status_code == 404, r.text


async def test_other_profile_of_same_user_is_invisible_until_switch(client):
    h1, _ = await _register_login(client, "iso-switch@gmov.dev", "isoswitch")
    first = await _current_profile_id(client, h1)
    await client.post(
        f"{ME}/watchlist",
        headers=h1,
        json={"movie_slug": "mao", "movie_name": "Mao"},
    )
    second = await _create_profile(client, h1, "Kid")

    r = await client.post(
        f"{ME}/profiles/{second}/switch", headers=h1, json={}
    )
    assert r.status_code == 200, r.text
    h2 = _bearer(r.json()["access_token"])
    r = await client.get(f"{ME}/watchlist", headers=h2)
    assert r.json()["total_items"] == 0

    r = await client.post(
        f"{ME}/profiles/{first}/switch", headers=h2, json={}
    )
    assert r.status_code == 200, r.text
    h1b = _bearer(r.json()["access_token"])
    r = await client.get(f"{ME}/watchlist", headers=h1b)
    assert [i["movie_slug"] for i in r.json()["items"]] == ["mao"]
