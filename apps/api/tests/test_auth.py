"""Auth flow tests: register -> login -> /me -> refresh -> logout."""

import uuid
from pathlib import Path

import pytest
import pytest_asyncio
from fakeredis.aioredis import FakeRedis

from app.core import ratelimit

AUTH = "/api/v1/auth"
ME = "/api/v1/users/me"
APP_DIR = Path(__file__).resolve().parents[1]


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

    # duplicate delivery of the just-rotated token (double boot, two tabs):
    # inside the grace window it re-issues instead of 401
    r = await client.post(
        f"{AUTH}/refresh", json={"refresh_token": tokens["refresh_token"]}
    )
    assert r.status_code == 200, r.text
    graced = r.json()
    assert graced["refresh_token"] not in (
        tokens["refresh_token"],
        rotated["refresh_token"],
    )

    # logout DESTROYS the session: replay is rejected immediately (no grace)
    r = await client.post(
        f"{AUTH}/logout", json={"refresh_token": graced["refresh_token"]}
    )
    assert r.status_code == 200
    r = await client.post(
        f"{AUTH}/refresh", json={"refresh_token": graced["refresh_token"]}
    )
    assert r.status_code == 401
    assert r.json()["code"] == "INVALID_REFRESH_TOKEN"


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


async def test_refresh_atomic_when_issue_fails(
    client, user_payload, _fake_redis, monkeypatch
):
    """If issuing the new pair explodes, the old token must stay usable."""
    from httpx import ASGITransport, AsyncClient

    import app.services.auth_service as svc
    from app.main import app

    await _register(client, user_payload)
    r = await _login(client, user_payload["username"], user_payload["password"])
    old_refresh = r.json()["refresh_token"]

    def _boom(user_id):
        raise RuntimeError("simulated signer outage")

    monkeypatch.setattr(svc.security, "create_refresh_token", _boom)
    # raise_app_exceptions=False so we see the real 500 response.
    transport = ASGITransport(app=app, raise_app_exceptions=False)
    async with AsyncClient(transport=transport, base_url="http://test") as raw:
        r = await raw.post(f"{AUTH}/refresh", json={"refresh_token": old_refresh})
    assert r.status_code == 500
    assert r.json()["code"] == "INTERNAL_ERROR"
    monkeypatch.undo()

    # Old token was NOT revoked: rotation can proceed, user stays logged in.
    r = await client.post(f"{AUTH}/refresh", json={"refresh_token": old_refresh})
    assert r.status_code == 200, r.text
    assert r.json()["refresh_token"] != old_refresh



@pytest_asyncio.fixture
async def sqlite_factory(tmp_path):
    from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

    from app.db.base import Base

    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path}/grace.db")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    factory = async_sessionmaker(engine, expire_on_commit=False)
    yield factory
    await engine.dispose()


async def test_refresh_grace_and_stale_paths(sqlite_factory):
    """Recently-revoked -> re-issue; long-revoked/unknown -> hard 401."""
    from datetime import UTC, datetime, timedelta

    from app.core import security
    from app.core.exceptions import AppException
    from app.db.models.refresh_token import RefreshToken
    from app.schemas.auth import RegisterIn
    from app.services import auth_service, user_service

    async with sqlite_factory() as db:
        user = await user_service.create(
            db,
            RegisterIn(
                email="grace@gmov.dev",
                username="graceuser",
                password="password123",
            ),
        )
        # Plain UUID: later rollbacks expire ORM state, this stays usable.
        user_id = user.id
        now = datetime.now(UTC)

        async def _row(offset_revoked=None):
            token, jti = security.create_refresh_token(user_id)
            db.add(
                RefreshToken(
                    user_id=user_id,
                    jti=jti,
                    expires_at=now + timedelta(days=30),
                    revoked_at=(now + offset_revoked if offset_revoked else None),
                )
            )
            await db.commit()
            return token

        # 1. duplicate delivery 5s after rotation -> re-issued (200 path)
        pair = await auth_service.refresh(db, await _row(timedelta(seconds=-5)))
        assert pair.access_token

        # 2. revoked an hour ago -> hard 401
        with pytest.raises(AppException) as exc:
            await auth_service.refresh(db, await _row(timedelta(hours=-1)))
        assert exc.value.status_code == 401

        # 3. valid signature, unknown jti -> hard 401
        foreign, _ = security.create_refresh_token(user_id)
        with pytest.raises(AppException):
            await auth_service.refresh(db, foreign)


async def test_refresh_reuse_after_grace_revokes_whole_family(sqlite_factory):
    """Theft detected: the stale token AND every sibling in its family die."""
    import uuid as uuid_mod
    from datetime import UTC, datetime, timedelta

    from sqlalchemy import select

    from app.core import security
    from app.core.exceptions import AppException
    from app.db.models.refresh_token import RefreshToken
    from app.schemas.auth import RegisterIn
    from app.services import auth_service, user_service

    async with sqlite_factory() as db:
        user = await user_service.create(
            db,
            RegisterIn(
                email="reuse@gmov.dev",
                username="reuseuser",
                password="password123",
            ),
        )
        user_id = user.id
        family_id = uuid_mod.uuid4()
        now = datetime.now(UTC)

        async def _row(revoked_offset=None):
            token, jti = security.create_refresh_token(user_id)
            db.add(
                RefreshToken(
                    user_id=user_id,
                    jti=jti,
                    family_id=family_id,
                    expires_at=now + timedelta(days=30),
                    revoked_at=(now + revoked_offset if revoked_offset else None),
                )
            )
            await db.commit()
            return token

        stale = await _row(timedelta(hours=-1))
        sibling = await _row()

        with pytest.raises(AppException) as exc:
            await auth_service.refresh(db, stale)
        assert exc.value.status_code == 401
        assert exc.value.code == "INVALID_REFRESH_TOKEN"

        with pytest.raises(AppException) as exc:
            await auth_service.refresh(db, sibling)
        assert exc.value.status_code == 401
        assert exc.value.code == "INVALID_REFRESH_TOKEN"

        rows = (
            await db.execute(
                select(RefreshToken).where(RefreshToken.family_id == family_id)
            )
        ).scalars().all()
        assert len(rows) == 2
        assert all(member.revoked_at is not None for member in rows)
        assert all(member.compromised for member in rows)


async def test_refresh_reuse_does_not_affect_other_family(sqlite_factory):
    import uuid as uuid_mod
    from datetime import UTC, datetime, timedelta

    from app.core import security
    from app.core.exceptions import AppException
    from app.db.models.refresh_token import RefreshToken
    from app.schemas.auth import RegisterIn
    from app.services import auth_service, user_service

    async with sqlite_factory() as db:
        user = await user_service.create(
            db,
            RegisterIn(
                email="families@gmov.dev",
                username="familyuser",
                password="password123",
            ),
        )
        user_id = user.id
        now = datetime.now(UTC)

        async def _row(family_id, revoked_offset=None):
            token, jti = security.create_refresh_token(user_id)
            db.add(
                RefreshToken(
                    user_id=user_id,
                    jti=jti,
                    family_id=family_id,
                    expires_at=now + timedelta(days=30),
                    revoked_at=(now + revoked_offset if revoked_offset else None),
                )
            )
            await db.commit()
            return token

        stolen_family = uuid_mod.uuid4()
        other_family = uuid_mod.uuid4()
        stale = await _row(stolen_family, timedelta(hours=-1))
        await _row(stolen_family)
        other = await _row(other_family)

        with pytest.raises(AppException):
            await auth_service.refresh(db, stale)

        pair = await auth_service.refresh(db, other)
        assert pair.access_token


async def test_login_lockout_is_per_username(client, _fake_redis):
    first = {
        "email": "lockme@gmov.dev",
        "username": "lockme",
        "password": "password123",
    }
    second = {
        "email": "otherlock@gmov.dev",
        "username": "otherlock",
        "password": "password123",
    }
    await _register(client, first)
    await _register(client, second)
    for _ in range(5):
        r = await _login(client, first["username"], "wrongpassword")
        assert r.status_code == 401
    r = await _login(client, first["username"], "wrongpassword")
    assert r.status_code == 429

    r = await _login(client, second["username"], "wrongpassword")
    assert r.status_code == 401
    r = await _login(client, second["username"], second["password"])
    assert r.status_code == 200, r.text


def test_refresh_family_migration_backfills_from_id(tmp_path, monkeypatch):
    from alembic import command
    from alembic.config import Config
    from sqlalchemy import create_engine, text

    from app.core.config import settings

    db_path = tmp_path / "family.db"
    monkeypatch.setattr(settings, "database_url", f"sqlite+aiosqlite:///{db_path}")
    cfg = Config(str(APP_DIR / "alembic.ini"))
    cfg.set_main_option("script_location", str(APP_DIR / "app" / "alembic"))

    command.upgrade(cfg, "b7c1d9e2f3a4")
    engine = create_engine(f"sqlite:///{db_path}")
    try:
        with engine.begin() as conn:
            user_id = uuid.uuid4()
            token_id = uuid.uuid4()
            conn.execute(
                text(
                    "INSERT INTO users (id, email, username, hashed_password,"
                    " display_name, is_active, role, created_at, updated_at)"
                    " VALUES (:id, 'mig@gmov.dev', 'miguser', 'x', 'x', 1,"
                    " 'user', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"
                ),
                {"id": str(user_id)},
            )
            conn.execute(
                text(
                    "INSERT INTO refresh_tokens (id, user_id, jti, expires_at,"
                    " created_at) VALUES (:id, :uid, 'jti-family',"
                    " CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"
                ),
                {"id": str(token_id), "uid": str(user_id)},
            )
    finally:
        engine.dispose()

    command.upgrade(cfg, "head")
    engine = create_engine(f"sqlite:///{db_path}")
    try:
        with engine.begin() as conn:
            row = conn.execute(
                text("SELECT id, family_id, compromised FROM refresh_tokens")
            ).one()
    finally:
        engine.dispose()
    assert row.family_id == row.id
    assert row.compromised in (0, False)
