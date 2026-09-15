"""Auth flow tests: register -> login -> /me -> refresh -> logout."""

import pytest
from fakeredis.aioredis import FakeRedis

from app.core import ratelimit

AUTH = "/api/v1/auth"
ME = "/api/v1/users/me"


@pytest.fixture
def _fake_redis(monkeypatch):
    client = FakeRedis(decode_responses=True)
    monkeypatch.setattr(ratelimit, "get_redis_client", lambda _c=client: _c)
    return client


async def _register(client, payload):
    return await client.post(f"{AUTH}/register", json=payload)


async def _login(client, username, password):
    return await client.post(
        f"{AUTH}/login", data={"username": username, "password": password}
    )


async def test_full_auth_flow(client, user_payload):
    # register
    r = await _register(client, user_payload)
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["email"] == user_payload["email"]
    assert body["username"] == user_payload["username"]
    assert "hashed_password" not in body

    # login (OAuth2 form, username field)
    r = await _login(client, user_payload["username"], user_payload["password"])
    assert r.status_code == 200, r.text
    tokens = r.json()
    assert tokens["token_type"] == "bearer"

    # /me with access token
    headers = {"Authorization": f"Bearer {tokens['access_token']}"}
    r = await client.get(ME, headers=headers)
    assert r.status_code == 200, r.text
    assert r.json()["email"] == user_payload["email"]

    # PATCH /me
    r = await client.patch(
        ME, headers=headers, json={"display_name": "Test User"}
    )
    assert r.status_code == 200, r.text
    assert r.json()["display_name"] == "Test User"

    # refresh rotates: new pair issued
    r = await client.post(
        f"{AUTH}/refresh", json={"refresh_token": tokens["refresh_token"]}
    )
    assert r.status_code == 200, r.text
    rotated = r.json()

    # old refresh token is now revoked
    r = await client.post(
        f"{AUTH}/refresh", json={"refresh_token": tokens["refresh_token"]}
    )
    assert r.status_code == 401
    assert r.json()["code"] == "INVALID_REFRESH_TOKEN"

    # logout revokes the rotated refresh token
    r = await client.post(
        f"{AUTH}/logout", json={"refresh_token": rotated["refresh_token"]}
    )
    assert r.status_code == 200

    # logged-out refresh token is rejected
    r = await client.post(
        f"{AUTH}/refresh", json={"refresh_token": rotated["refresh_token"]}
    )
    assert r.status_code == 401


async def test_login_with_email(client, user_payload):
    await _register(client, user_payload)
    r = await _login(client, user_payload["email"], user_payload["password"])
    assert r.status_code == 200, r.text


async def test_register_validation_and_conflicts(client, user_payload):
    # password too short
    bad = {**user_payload, "password": "short"}
    r = await _register(client, bad)
    assert r.status_code == 422
    assert r.json()["code"] == "VALIDATION_ERROR"

    # ok first time
    r = await _register(client, user_payload)
    assert r.status_code == 201, r.text

    # duplicate email
    dup_email = {**user_payload, "username": "othername"}
    r = await _register(client, dup_email)
    assert r.status_code == 409
    assert r.json()["code"] == "EMAIL_TAKEN"

    # duplicate username
    dup_user = {**user_payload, "email": "other@gmov.dev"}
    r = await _register(client, dup_user)
    assert r.status_code == 409
    assert r.json()["code"] == "USERNAME_TAKEN"


async def test_login_wrong_password(client, user_payload):
    await _register(client, user_payload)
    r = await _login(client, user_payload["username"], "wrongpassword")
    assert r.status_code == 401
    assert r.json()["code"] == "INVALID_CREDENTIALS"


async def test_me_requires_token(client):
    r = await client.get(ME)
    assert r.status_code == 401
    assert r.json()["code"] == "UNAUTHORIZED"


async def test_login_rate_limited_after_5_failures(
    client, user_payload, _fake_redis
):
    await _register(client, user_payload)
    for _ in range(5):
        r = await _login(client, user_payload["username"], "wrongpassword")
        assert r.status_code == 401
    r = await _login(client, user_payload["username"], "wrongpassword")
    assert r.status_code == 429
    assert r.json()["code"] == "RATE_LIMITED"


async def test_login_success_resets_failures(client, user_payload, _fake_redis):
    await _register(client, user_payload)
    for _ in range(4):
        await _login(client, user_payload["username"], "wrongpassword")
    r = await _login(client, user_payload["username"], user_payload["password"])
    assert r.status_code == 200
    # counter cleared: 5 more failures allowed before lockout again
    for _ in range(5):
        r = await _login(client, user_payload["username"], "wrongpassword")
        assert r.status_code == 401
    r = await _login(client, user_payload["username"], "wrongpassword")
    assert r.status_code == 429


def _reg_payload(i: int):
    return {
        "email": f"throttle{i}@gmov.dev",
        "username": f"throttleuser{i}",
        "password": "password123",
    }


async def test_register_throttled_after_3_per_hour(client, _fake_redis):
    for i in range(3):
        r = await _register(client, _reg_payload(i))
        assert r.status_code == 201, r.text
    r = await _register(client, _reg_payload(3))
    assert r.status_code == 429
    assert r.json()["code"] == "RATE_LIMITED"
    assert "retry-after" in r.headers
    r = await _register(client, _reg_payload(4))
    assert r.status_code == 429


async def test_register_honeypot_rejected(client, _fake_redis):
    payload = {**_reg_payload(9), "website": "http://spam.example"}
    r = await _register(client, payload)
    assert r.status_code == 400
    assert r.json()["code"] == "BOT_DETECTED"
