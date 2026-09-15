"""Purge job tests: expired + long-revoked rows go, the rest stay."""

from datetime import UTC, datetime, timedelta

import pytest_asyncio
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.db.base import Base
from app.db.models.refresh_token import RefreshToken
from app.db.models.user import User
from app.services.token_cleanup import purge_expired_refresh_tokens


@pytest_asyncio.fixture
async def factory(tmp_path):
    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path}/cleanup.db")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    f = async_sessionmaker(engine, expire_on_commit=False)
    yield f
    await engine.dispose()


async def test_purge_deletes_only_stale_rows(factory):
    now = datetime.now(UTC)
    async with factory() as db:
        user = User(
            email="clean@gmov.dev",
            username="cleaner",
            hashed_password="x",
            display_name="cleaner",
        )
        db.add(user)
        await db.flush()
        cases = [
            # (jti, expires_at, revoked_at, should_be_deleted)
            ("expired", now - timedelta(days=1), None, True),
            ("revoked-old", now + timedelta(days=1), now - timedelta(days=31), True),
            ("revoked-recent", now + timedelta(days=1), now - timedelta(days=2), False),
            ("valid", now + timedelta(days=29), None, False),
        ]
        for jti, exp, rev, _ in cases:
            db.add(
                RefreshToken(
                    user_id=user.id, jti=jti, expires_at=exp, revoked_at=rev
                )
            )
        await db.commit()

    deleted = await purge_expired_refresh_tokens(db_factory=factory)
    assert deleted == 2

    async with factory() as db:
        remaining = sorted(
            (await db.execute(select(RefreshToken.jti))).scalars().all()
        )
    assert remaining == ["revoked-recent", "valid"]
