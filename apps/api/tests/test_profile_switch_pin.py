"""Switch profiles, PIN locks and profile deletion (TDD)."""

import uuid
from dataclasses import dataclass

import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import event, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.core import ratelimit, security
from app.db.base import Base
from app.db.models.favorite import Favorite
from app.db.models.profile import Profile
from app.db.session import get_db
from app.main import app
from app.services import profile_service

AUTH = "/api/v1/auth"
ME = "/api/v1/me"
PASSWORD = "password123"


@dataclass
class Env:
    client: AsyncClient
    factory: async_sessionmaker


@pytest_asyncio.fixture
async def client_env(tmp_path, monkeypatch):
    db_path = tmp_path / "switch_pin.db"
    engine = create_async_engine(f"sqlite+aiosqlite:///{db_path}")
    factory = async_sessionmaker(engine, expire_on_commit=False)

    @event.listens_for(engine.sync_engine, "connect")
    def _fk_pragma(dbapi_conn, _record):
        dbapi_conn.cursor().execute("PRAGMA foreign_keys=ON")

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


def _bearer(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def _register_login(env: Env, email: str, username: str) -> dict:
    r = await env.client.post(
        f"{AUTH}/register",
        json={"email": email, "username": username, "password": PASSWORD},
    )
    assert r.status_code == 201, r.text
    r = await env.client.post(
        f"{AUTH}/login", data={"username": username, "password": PASSWORD}
    )
    assert r.status_code == 200, r.text
    return r.json()


async def _create(env: Env, headers: dict, name: str, avatar: str = "cat") -> dict:
    r = await env.client.post(
        f"{ME}/profiles", headers=headers, json={"name": name, "avatar": avatar}
    )
    assert r.status_code == 201, r.text
    return r.json()


async def _set_pin(
    env: Env,
    headers: dict,
    profile_id: str,
    password: str = PASSWORD,
    pin: str | None = "1234",
):
    return await env.client.put(
        f"{ME}/profiles/{profile_id}/pin",
        headers=headers,
        json={"password": password, "pin": pin},
    )


async def _switch(env: Env, headers: dict, profile_id: str, pin: str | None = None):
    body = {} if pin is None else {"pin": pin}
    return await env.client.post(
        f"{ME}/profiles/{profile_id}/switch", headers=headers, json=body
    )


async def _delete(env: Env, headers: dict, profile_id: str, pin: str | None = None):
    body = {} if pin is None else {"pin": pin}
    return await env.client.request(
        "DELETE", f"{ME}/profiles/{profile_id}", headers=headers, json=body
    )


async def _profile_row(env: Env, profile_id: str) -> Profile | None:
    async with env.factory() as db:
        return await db.get(Profile, uuid.UUID(profile_id))


async def test_switch_changes_active_profile(client_env):
    tokens = await _register_login(client_env, "sw1@gmov.dev", "sw1")
    headers = _bearer(tokens["access_token"])
    second = await _create(client_env, headers, "Kid")

    r = await _switch(client_env, headers, second["id"])
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["profile"]["id"] == second["id"]
    assert body["access_token"]
    payload = security.decode_token(body["access_token"])
    assert payload["pid"] == second["id"]
    assert payload["sid"] == security.decode_token(tokens["access_token"])["sid"]

    current = await client_env.client.get(
        f"{ME}/profile", headers=_bearer(body["access_token"])
    )
    assert current.status_code == 200, current.text
    assert current.json()["id"] == second["id"]


async def test_switch_requires_pin_when_locked(client_env):
    tokens = await _register_login(client_env, "sw2@gmov.dev", "sw2")
    headers = _bearer(tokens["access_token"])
    second = await _create(client_env, headers, "Locked")
    assert (await _set_pin(client_env, headers, second["id"])).status_code == 200

    missing = await _switch(client_env, headers, second["id"])
    assert missing.status_code == 403, missing.text
    assert missing.json()["code"] == "PIN_REQUIRED"

    wrong = await _switch(client_env, headers, second["id"], pin="0000")
    assert wrong.status_code == 401, wrong.text
    assert wrong.json()["code"] == "INVALID_PIN"

    right = await _switch(client_env, headers, second["id"], pin="1234")
    assert right.status_code == 200, right.text
    assert right.json()["profile"]["id"] == second["id"]


async def test_switch_foreign_profile_is_404(client_env):
    owner = await _register_login(client_env, "sw3@gmov.dev", "sw3")
    owner_headers = _bearer(owner["access_token"])
    victim = await _create(client_env, owner_headers, "Victim")

    intruder = await _register_login(client_env, "sw4@gmov.dev", "sw4")
    r = await _switch(
        client_env, _bearer(intruder["access_token"]), victim["id"]
    )
    assert r.status_code == 404, r.text
    assert r.json()["code"] == "PROFILE_NOT_FOUND"


async def test_pin_attempts_are_rate_limited(client_env, monkeypatch):
    monkeypatch.setattr(profile_service, "PIN_MAX_ATTEMPTS", 2)
    tokens = await _register_login(client_env, "rl1@gmov.dev", "rl1")
    headers = _bearer(tokens["access_token"])
    locked = await _create(client_env, headers, "Locked")
    assert (await _set_pin(client_env, headers, locked["id"])).status_code == 200

    for _ in range(2):
        r = await _switch(client_env, headers, locked["id"], pin="0000")
        assert r.status_code == 401, r.text

    blocked = await _switch(client_env, headers, locked["id"], pin="0000")
    assert blocked.status_code == 429, blocked.text
    assert blocked.json()["code"] == "RATE_LIMITED"
    assert "Retry-After" in blocked.headers

    # Same (profile, IP) counter is shared with delete.
    deleted = await _delete(client_env, headers, locked["id"], pin="0000")
    assert deleted.status_code == 429, deleted.text
    assert deleted.json()["code"] == "RATE_LIMITED"


async def test_set_pin_needs_account_password(client_env):
    tokens = await _register_login(client_env, "pin1@gmov.dev", "pin1")
    headers = _bearer(tokens["access_token"])
    profile = await _create(client_env, headers, "Kid")

    wrong = await _set_pin(client_env, headers, profile["id"], password="nope")
    assert wrong.status_code == 400, wrong.text
    assert wrong.json()["code"] == "INVALID_PASSWORD"

    set_ok = await _set_pin(client_env, headers, profile["id"], pin="1234")
    assert set_ok.status_code == 200, set_ok.text
    assert set_ok.json()["has_pin"] is True

    clear = await _set_pin(client_env, headers, profile["id"], pin=None)
    assert clear.status_code == 200, clear.text
    assert clear.json()["has_pin"] is False

    invalid = await _set_pin(client_env, headers, profile["id"], pin="12")
    assert invalid.status_code == 422, invalid.text


async def test_delete_default_profile_is_rejected(client_env):
    tokens = await _register_login(client_env, "del1@gmov.dev", "del1")
    headers = _bearer(tokens["access_token"])
    current = await client_env.client.get(f"{ME}/profile", headers=headers)

    r = await _delete(client_env, headers, current.json()["id"])
    assert r.status_code == 409, r.text
    assert r.json()["code"] == "DEFAULT_PROFILE"


async def test_delete_locked_profile_requires_its_pin(client_env):
    tokens = await _register_login(client_env, "del2@gmov.dev", "del2")
    headers = _bearer(tokens["access_token"])
    locked = await _create(client_env, headers, "Locked")
    assert (await _set_pin(client_env, headers, locked["id"])).status_code == 200

    async with client_env.factory() as db:
        db.add(
            Favorite(
                profile_id=uuid.UUID(locked["id"]),
                movie_slug="mao",
                movie_name="Mao",
            )
        )
        await db.commit()

    missing = await _delete(client_env, headers, locked["id"])
    assert missing.status_code == 403, missing.text
    assert missing.json()["code"] == "PIN_REQUIRED"

    wrong = await _delete(client_env, headers, locked["id"], pin="0000")
    assert wrong.status_code == 401, wrong.text
    assert wrong.json()["code"] == "INVALID_PIN"

    ok = await _delete(client_env, headers, locked["id"], pin="1234")
    assert ok.status_code == 200, ok.text
    assert ok.json() == {"access_token": None, "profile": None}

    assert await _profile_row(client_env, locked["id"]) is None
    async with client_env.factory() as db:
        rows = (
            await db.execute(
                select(Favorite).where(
                    Favorite.profile_id == uuid.UUID(locked["id"])
                )
            )
        ).scalars().all()
    assert list(rows) == []


async def test_delete_active_profile_returns_new_token_for_default(client_env):
    tokens = await _register_login(client_env, "del3@gmov.dev", "del3")
    headers = _bearer(tokens["access_token"])
    default_id = (
        await client_env.client.get(f"{ME}/profile", headers=headers)
    ).json()["id"]
    second = await _create(client_env, headers, "Kid")

    switched = await _switch(client_env, headers, second["id"])
    assert switched.status_code == 200, switched.text
    active_headers = _bearer(switched.json()["access_token"])

    r = await _delete(client_env, active_headers, second["id"])
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["profile"]["id"] == default_id
    assert body["profile"]["is_default"] is True
    assert body["access_token"]

    current = await client_env.client.get(
        f"{ME}/profile", headers=_bearer(body["access_token"])
    )
    assert current.status_code == 200, current.text
    assert current.json()["id"] == default_id


async def test_pin_hash_is_not_plaintext(client_env):
    tokens = await _register_login(client_env, "hash1@gmov.dev", "hash1")
    headers = _bearer(tokens["access_token"])
    profile = await _create(client_env, headers, "Kid")
    assert (await _set_pin(client_env, headers, profile["id"])).status_code == 200

    row = await _profile_row(client_env, profile["id"])
    assert row is not None
    assert row.pin_hash != "1234"
    assert security.verify_password("1234", row.pin_hash)
