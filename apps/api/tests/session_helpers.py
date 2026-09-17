"""Shared auth helpers for API tests.

`POST /auth/login` authenticates the account only: no profile is selected until
`POST /me/profiles/{id}/switch` (which also clears the profile's PIN when it has
one). Tests that touch profile-scoped data must therefore select a profile
explicitly — exactly like the web app's chooser does.
"""

import uuid

from httpx import AsyncClient

PASSWORD = "password123"


def bearer(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def login_tokens(
    client: AsyncClient, username: str, password: str = PASSWORD
) -> dict:
    r = await client.post(
        "/api/v1/auth/login",
        data={"username": username, "password": password},
    )
    assert r.status_code == 200, r.text
    return r.json()


async def select_profile(
    client: AsyncClient, token: str, profile_id: str | uuid.UUID
) -> str:
    """Point an unselected session at `profile_id`; returns the bound token."""
    r = await client.post(
        f"/api/v1/me/profiles/{profile_id}/switch",
        headers=bearer(token),
        json={},
    )
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


async def select_default(client: AsyncClient, token: str) -> str:
    """Select the account's default profile (the usual test fixture)."""
    r = await client.get("/api/v1/me/profiles", headers=bearer(token))
    assert r.status_code == 200, r.text
    default = next(p for p in r.json()["items"] if p["is_default"])
    return await select_profile(client, token, default["id"])
