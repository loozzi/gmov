"""Session-profile claims (sid/pid) carried through the API (TDD)."""

import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

import jwt
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.core import ratelimit, security
from app.core.config import settings
from app.db.base import Base
from app.db.models.profile import Profile
from app.db.models.refresh_token import RefreshToken
from app.db.models.user import User
from app.db.session import get_db
from app.main import app

AUTH = "/api/v1/auth"
ME = "/api/v1/me"


@dataclass
class Env:
    client: AsyncClient
    factory: async_sessionmaker


@pytest_asyncio.fixture
async def client_env(tmp_path, monkeypatch):
    db_path = tmp_path / "profile_session.db"
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


async def _register_login(
    env: Env, email: str, username: str
) -> dict[str, str]:
    r = await env.client.post(
        f"{AUTH}/register",
        json={"email": email, "username": username, "password": "password123"},
    )
    assert r.status_code == 201, r.text
    r = await env.client.post(
        f"{AUTH}/login",
        data={"username": username, "password": "password123"},
    )
    assert r.status_code == 200, r.text
    return r.json()


def _bearer(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _hand_signed(
    user_id: uuid.UUID,
    *,
    pid: uuid.UUID | str | None = None,
    sid: str | None = None,
) -> dict[str, str]:
    now = datetime.now(UTC)
    payload: dict[str, str | datetime] = {
        "sub": str(user_id),
        "type": security.ACCESS_TOKEN_TYPE,
        "jti": str(uuid.uuid4()),
        "iat": now,
        "exp": now + timedelta(minutes=5),
    }
    if sid is not None:
        payload["sid"] = sid
    if pid is not None:
        payload["pid"] = str(pid)
    token = jwt.encode(
        payload, settings.jwt_secret, algorithm=settings.jwt_algorithm
    )
    return _bearer(token)


async def _user(env: Env, username: str) -> User:
    async with env.factory() as db:
        return (
            await db.execute(select(User).where(User.username == username))
        ).scalar_one()


async def _default_profile_id(env: Env, username: str) -> uuid.UUID:
    async with env.factory() as db:
        user = (
            await db.execute(select(User).where(User.username == username))
        ).scalar_one()
        profile = (
            await db.execute(
                select(Profile).where(
                    Profile.user_id == user.id,
                    Profile.is_default.is_(True),
                )
            )
        ).scalar_one()
        return profile.id


async def _add_profile(env: Env, access_token: str, name: str) -> uuid.UUID:
    r = await env.client.post(
        f"{ME}/profiles",
        headers=_bearer(access_token),
        json={"name": name, "avatar": "cat"},
    )
    assert r.status_code == 201, r.text
    return uuid.UUID(r.json()["id"])


async def _set_session_profile(
    env: Env, refresh_token: str, profile_id: uuid.UUID
) -> None:
    jti = security.decode_token(refresh_token)["jti"]
    async with env.factory() as db:
        row = (
            await db.execute(
                select(RefreshToken).where(RefreshToken.jti == jti)
            )
        ).scalar_one()
        row.profile_id = profile_id
        await db.commit()


async def test_login_token_carries_sid_without_pid(client_env):
    """Login authenticates the account only: no profile is selected yet, so a
    PIN-locked default profile cannot be read before its PIN is entered."""
    tokens = await _register_login(client_env, "sid1@gmov.dev", "sid1")
    access = security.decode_token(tokens["access_token"])
    refresh = security.decode_token(tokens["refresh_token"])

    assert access["sid"] == refresh["jti"]
    assert "pid" not in access

    r = await client_env.client.get(
        f"{ME}/profile", headers=_bearer(tokens["access_token"])
    )
    assert r.status_code == 403
    assert r.json()["code"] == "PROFILE_REQUIRED"


async def test_switch_binds_the_picked_profile(client_env):
    tokens = await _register_login(client_env, "pick1@gmov.dev", "pick1")
    default_id = await _default_profile_id(client_env, "pick1")

    r = await client_env.client.post(
        f"{ME}/profiles/{default_id}/switch",
        headers=_bearer(tokens["access_token"]),
        json={},
    )
    assert r.status_code == 200, r.text
    bound = r.json()["access_token"]
    assert security.decode_token(bound)["pid"] == str(default_id)

    r = await client_env.client.get(f"{ME}/profile", headers=_bearer(bound))
    assert r.status_code == 200, r.text
    assert r.json()["id"] == str(default_id)


async def test_missing_pid_is_profile_required(client_env):
    await _register_login(client_env, "old1@gmov.dev", "old1")
    user = await _user(client_env, "old1")
    headers = _hand_signed(user.id)

    r = await client_env.client.get(f"{ME}/profile", headers=headers)
    assert r.status_code == 403
    assert r.json()["code"] == "PROFILE_REQUIRED"

    # The chooser must stay reachable for the session to pick a profile.
    listing = await client_env.client.get(f"{ME}/profiles", headers=headers)
    assert listing.status_code == 200, listing.text
    assert all(not item["is_current"] for item in listing.json()["items"])


async def test_foreign_pid_is_404(client_env):
    await _register_login(client_env, "own1@gmov.dev", "own1")
    await _register_login(client_env, "other1@gmov.dev", "other1")
    user = await _user(client_env, "own1")
    other_pid = await _default_profile_id(client_env, "other1")

    r = await client_env.client.get(
        f"{ME}/profile", headers=_hand_signed(user.id, pid=other_pid)
    )
    assert r.status_code == 404
    assert r.json()["code"] == "PROFILE_NOT_FOUND"


async def test_malformed_pid_is_404(client_env):
    await _register_login(client_env, "bad1@gmov.dev", "bad1")
    user = await _user(client_env, "bad1")

    r = await client_env.client.get(
        f"{ME}/profile", headers=_hand_signed(user.id, pid="not-a-uuid")
    )
    assert r.status_code == 404
    assert r.json()["code"] == "PROFILE_NOT_FOUND"


async def test_deleted_pid_resets_session_to_unselected(client_env):
    tokens = await _register_login(client_env, "heal1@gmov.dev", "heal1")
    second_id = await _add_profile(client_env, tokens["access_token"], "Child")
    user = await _user(client_env, "heal1")
    sid = security.decode_token(tokens["refresh_token"])["jti"]
    async with client_env.factory() as db:
        profile = await db.get(Profile, second_id)
        await db.delete(profile)
        await db.commit()
    headers = _hand_signed(user.id, pid=second_id, sid=sid)

    # The dead claim must not fall back to the (possibly PIN-locked) default.
    for path in ("/profile", "/favorites"):
        r = await client_env.client.get(f"{ME}{path}", headers=headers)
        assert r.status_code == 403, f"{path}: {r.text}"
        assert r.json()["code"] == "PROFILE_REQUIRED"

    listing = await client_env.client.get(f"{ME}/profiles", headers=headers)
    assert listing.status_code == 200, listing.text

    async with client_env.factory() as db:
        row = (
            await db.execute(
                select(RefreshToken).where(RefreshToken.jti == sid)
            )
        ).scalar_one()
        assert row.profile_id is None


async def test_stale_pid_keeps_a_newer_selection(client_env):
    """Tabs share one refresh session. A tab still holding the pid of a deleted
    profile must not clear the selection another tab just made."""
    tokens = await _register_login(client_env, "race1@gmov.dev", "race1")
    kept = await _add_profile(client_env, tokens["access_token"], "Kept")
    gone = await _add_profile(client_env, tokens["access_token"], "Gone")
    user = await _user(client_env, "race1")
    sid = security.decode_token(tokens["refresh_token"])["jti"]

    # Another tab switched this session to `kept`...
    await _set_session_profile(client_env, tokens["refresh_token"], kept)
    # ...while this tab still presents a token for `gone`, since deleted.
    async with client_env.factory() as db:
        await db.delete(await db.get(Profile, gone))
        await db.commit()

    r = await client_env.client.get(
        f"{ME}/profile", headers=_hand_signed(user.id, pid=gone, sid=sid)
    )
    assert r.status_code == 403
    assert r.json()["code"] == "PROFILE_REQUIRED"

    async with client_env.factory() as db:
        row = (
            await db.execute(
                select(RefreshToken).where(RefreshToken.jti == sid)
            )
        ).scalar_one()
        assert row.profile_id == kept


async def test_banned_user_still_401_even_with_valid_pid(client_env):
    await _register_login(client_env, "ban1@gmov.dev", "ban1")
    user = await _user(client_env, "ban1")
    pid = await _default_profile_id(client_env, "ban1")
    async with client_env.factory() as db:
        row = await db.get(User, user.id)
        row.banned_at = datetime.now(UTC)
        await db.commit()

    r = await client_env.client.get(
        f"{ME}/profile", headers=_hand_signed(user.id, pid=pid)
    )
    assert r.status_code == 401
    assert r.json()["code"] == "ACCOUNT_BANNED"


async def test_refresh_keeps_active_profile(client_env):
    tokens = await _register_login(client_env, "rot1@gmov.dev", "rot1")
    second_id = await _add_profile(client_env, tokens["access_token"], "Kid")
    await _set_session_profile(client_env, tokens["refresh_token"], second_id)

    r = await client_env.client.post(
        f"{AUTH}/refresh", json={"refresh_token": tokens["refresh_token"]}
    )
    assert r.status_code == 200, r.text
    access = security.decode_token(r.json()["access_token"])
    assert access["pid"] == str(second_id)


async def test_unselected_session_stays_unselected_after_refresh(client_env):
    tokens = await _register_login(client_env, "fresh1@gmov.dev", "fresh1")

    r = await client_env.client.post(
        f"{AUTH}/refresh", json={"refresh_token": tokens["refresh_token"]}
    )
    assert r.status_code == 200, r.text
    access = security.decode_token(r.json()["access_token"])
    assert "pid" not in access


async def test_profile_deleted_clears_selection_after_refresh(client_env):
    tokens = await _register_login(client_env, "gone1@gmov.dev", "gone1")
    second_id = await _add_profile(client_env, tokens["access_token"], "Child")
    await _set_session_profile(client_env, tokens["refresh_token"], second_id)
    async with client_env.factory() as db:
        profile = await db.get(Profile, second_id)
        await db.delete(profile)
        await db.commit()

    r = await client_env.client.post(
        f"{AUTH}/refresh", json={"refresh_token": tokens["refresh_token"]}
    )
    assert r.status_code == 200, r.text
    access = security.decode_token(r.json()["access_token"])
    assert "pid" not in access
