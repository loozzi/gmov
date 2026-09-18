"""Postgres-only: a racing rotation must not survive the family revocation.

#22: the row-level family lock only locks members that already exist, so under
READ COMMITTED a concurrent rotation on a live sibling could INSERT a new member
after the theft branch took its snapshot — leaving a usable token in a
compromised family. SQLite cannot show this (it serialises writers process-wide),
so the test needs Postgres:

    TEST_DATABASE_URL=postgresql+asyncpg://gmov:gmov_dev_password@localhost:5432/gmov \\
        uv run pytest tests/test_auth_concurrency_integration.py -q -m integration

It touches only rows it creates (a throwaway user and that user's family) and
deletes them again. The interleaving is forced with a monkeypatched family lock,
so the race is deterministic; without the advisory lock the final assertion is
what fails.
"""

import asyncio
import os
import uuid
from datetime import UTC, datetime, timedelta

import jwt
import pytest
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.core import security
from app.core.config import settings
from app.core.exceptions import AppException
from app.db.base import Base
from app.db.models.refresh_token import RefreshToken
from app.db.models.user import User
from app.services import auth_service

TEST_DATABASE_URL = os.environ.get("TEST_DATABASE_URL")

pytestmark = [
    pytest.mark.integration,
    pytest.mark.skipif(
        not TEST_DATABASE_URL,
        reason="set TEST_DATABASE_URL to a Postgres DSN to run this race test",
    ),
]


def _refresh_token(user_id: uuid.UUID, jti: str) -> str:
    """Sign a refresh token for an already-persisted row (jti must match)."""
    now = datetime.now(UTC)
    return jwt.encode(
        {
            "sub": str(user_id),
            "type": security.REFRESH_TOKEN_TYPE,
            "jti": jti,
            "iat": now,
            "exp": now + timedelta(days=1),
        },
        settings.jwt_secret,
        algorithm=settings.jwt_algorithm,
    )


async def test_racing_rotation_cannot_survive_family_revocation(monkeypatch):
    engine = create_async_engine(TEST_DATABASE_URL)
    factory = async_sessionmaker(engine, expire_on_commit=False)
    user_id = uuid.uuid4()
    family_id = uuid.uuid4()
    try:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)

        # A throwaway account plus one family holding a live member and a stale
        # one; replaying the stale member is the theft branch.
        async with factory() as db:
            db.add(
                User(
                    id=user_id,
                    email=f"race-{user_id.hex[:8]}@gmov.dev",
                    username=f"race_{user_id.hex[:8]}",
                    hashed_password="x",
                    display_name="Race test",
                    is_active=True,
                )
            )
            await db.flush()
            _, stale = auth_service._build_pair(user_id, family_id, None)
            _, live = auth_service._build_pair(user_id, family_id, None)
            stale.revoked_at = datetime.now(UTC) - timedelta(hours=2)
            db.add_all([stale, live])
            await db.commit()
            stale_token = _refresh_token(user_id, stale.jti)
            live_token = _refresh_token(user_id, live.jti)

        # Pause the valid rotation while it holds the family locks, so the theft
        # replay has to wait and (pre-fix) keeps the snapshot it took earlier.
        rotation_locked = asyncio.Event()
        release_rotation = asyncio.Event()
        original_lock = auth_service._lock_family  # noqa: SLF001 - race harness

        async def paused_lock(db, fid):
            members = await original_lock(db, fid)
            if not rotation_locked.is_set():
                rotation_locked.set()
                await release_rotation.wait()
            return members

        monkeypatch.setattr(auth_service, "_lock_family", paused_lock)

        async def rotate():
            async with factory() as db:
                return await auth_service.refresh(db, live_token)

        async def replay():
            async with factory() as db:
                return await auth_service.refresh(db, stale_token)

        rotation = asyncio.create_task(rotate())
        await asyncio.wait_for(rotation_locked.wait(), timeout=10)
        theft = asyncio.create_task(replay())
        await asyncio.sleep(0.5)  # let the replay reach the lock
        release_rotation.set()
        await asyncio.wait_for(rotation, timeout=10)
        with pytest.raises(AppException) as excinfo:
            await asyncio.wait_for(theft, timeout=10)
        assert excinfo.value.code == "INVALID_REFRESH_TOKEN"

        # The invariant: a compromised family may not keep a usable member,
        # including the one the racing rotation just inserted.
        async with factory() as db:
            live_members = (
                await db.execute(
                    select(func.count())
                    .select_from(RefreshToken)
                    .where(
                        RefreshToken.family_id == family_id,
                        RefreshToken.revoked_at.is_(None),
                    )
                )
            ).scalar_one()
        assert live_members == 0
    finally:
        async with factory() as db:
            await db.execute(
                delete(RefreshToken).where(RefreshToken.user_id == user_id)
            )
            await db.execute(delete(User).where(User.id == user_id))
            await db.commit()
        await engine.dispose()
