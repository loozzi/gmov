"""Profile CRUD endpoints (TDD)."""

from dataclasses import dataclass

import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.core import ratelimit
from app.db.base import Base
from app.db.session import get_db
from app.main import app
from tests.session_helpers import select_default

ME = "/api/v1/me"


@dataclass
class Env:
    client: AsyncClient
    factory: async_sessionmaker


@pytest_asyncio.fixture
async def client_env(tmp_path, monkeypatch):
    db_path = tmp_path / "profiles.db"
    engine = create_async_engine(f"sqlite+aiosqlite:///{db_path}")
    factory = async_sessionmaker(engine, expire_on_commit=False)

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


async def _register_login(env: Env, email: str, username: str) -> dict:
    r = await env.client.post(
        "/api/v1/auth/register",
        json={"email": email, "username": username, "password": "password123"},
    )
    assert r.status_code == 201, r.text
    r = await env.client.post(
        "/api/v1/auth/login",
        data={"username": username, "password": "password123"},
    )
    assert r.status_code == 200, r.text
    token = await select_default(env.client, r.json()["access_token"])
    return {"Authorization": f"Bearer {token}"}


async def _create(env: Env, headers: dict, name: str, avatar: str):
    return await env.client.post(
        f"{ME}/profiles",
        headers=headers,
        json={"name": name, "avatar": avatar},
    )


async def test_create_list_and_patch_profiles(client_env):
    headers = await _register_login(client_env, "prof1@gmov.dev", "prof1")

    assert (await _create(client_env, headers, "Minh", "rocket")).status_code == 201
    created = await _create(client_env, headers, "Lan", "cat")
    assert created.status_code == 201, created.text
    lan = created.json()
    assert lan["name"] == "Lan"
    assert lan["avatar"] == "cat"
    assert lan["has_pin"] is False
    assert lan["is_default"] is False

    current = await client_env.client.get(f"{ME}/profile", headers=headers)
    assert current.status_code == 200, current.text
    current_id = current.json()["id"]

    listing = await client_env.client.get(f"{ME}/profiles", headers=headers)
    assert listing.status_code == 200, listing.text
    body = listing.json()
    assert body["max"] == 5
    names = {item["name"] for item in body["items"]}
    assert {"Mặc định", "Minh", "Lan"} <= names
    assert sum(item["is_current"] for item in body["items"]) == 1
    assert [i["id"] for i in body["items"] if i["is_current"]] == [current_id]

    patched = await client_env.client.patch(
        f"{ME}/profiles/{lan['id']}",
        headers=headers,
        json={"name": "Bin", "avatar": "panda"},
    )
    assert patched.status_code == 200, patched.text
    assert patched.json()["name"] == "Bin"
    assert patched.json()["avatar"] == "panda"


async def test_max_five_profiles(client_env):
    headers = await _register_login(client_env, "prof2@gmov.dev", "prof2")

    for index in range(4):
        r = await _create(client_env, headers, f"P{index}", "star")
        assert r.status_code == 201, r.text

    r = await _create(client_env, headers, "P4", "star")
    assert r.status_code == 409, r.text
    assert r.json()["code"] == "PROFILE_LIMIT_REACHED"


async def test_duplicate_name_is_rejected_case_insensitively(client_env):
    headers = await _register_login(client_env, "prof3@gmov.dev", "prof3")
    assert (await _create(client_env, headers, "Minh", "dino")).status_code == 201

    r = await _create(client_env, headers, "minh", "alien")
    assert r.status_code == 409, r.text
    assert r.json()["code"] == "PROFILE_NAME_TAKEN"


async def test_avatar_must_be_in_allowlist(client_env):
    headers = await _register_login(client_env, "prof4@gmov.dev", "prof4")

    r = await _create(client_env, headers, "Hacker", "hack")
    assert r.status_code == 422, r.text


async def test_cannot_read_other_users_profile(client_env):
    owner = await _register_login(client_env, "ownera@gmov.dev", "ownera")
    victim_id = (await _create(client_env, owner, "Ripper", "pirate")).json()["id"]
    intruder = await _register_login(client_env, "ownb@gmov.dev", "ownb")

    r = await client_env.client.patch(
        f"{ME}/profiles/{victim_id}",
        headers=intruder,
        json={"name": "Stolen"},
    )
    assert r.status_code == 404, r.text
    assert r.json()["code"] == "PROFILE_NOT_FOUND"


async def test_register_creates_default_profile(client_env):
    headers = await _register_login(client_env, "prof5@gmov.dev", "prof5")

    r = await client_env.client.get(f"{ME}/profile", headers=headers)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["is_default"] is True
    assert body["name"] == "Mặc định"
    assert body["position"] == 0
    assert body["has_pin"] is False
