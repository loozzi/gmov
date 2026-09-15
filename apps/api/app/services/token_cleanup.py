"""Periodic purge of stale refresh tokens (expired, or revoked > 30 days).

Runs inside the API via APScheduler every 6 hours. With multiple uvicorn
workers each process has a scheduler, but a Redis lock guarantees only one
of them actually purges per tick.
"""

import logging
import uuid
from datetime import UTC, datetime, timedelta

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.interval import IntervalTrigger
from sqlalchemy import and_, delete, or_
from sqlalchemy.ext.asyncio import async_sessionmaker

from app.db.models.refresh_token import RefreshToken
from app.db.session import get_redis_client, session_factory

logger = logging.getLogger("gmov.token_cleanup")

PURGE_INTERVAL_HOURS = 6
REVOKED_GRACE_DAYS = 30
LOCK_KEY = "lock:token-cleanup"
LOCK_TTL_SECONDS = 3600


async def purge_expired_refresh_tokens(
    db_factory: async_sessionmaker | None = None,
) -> int:
    """Delete expired rows and long-revoked rows. Returns rows deleted."""
    factory = db_factory or session_factory
    now = datetime.now(UTC)
    cutoff = now - timedelta(days=REVOKED_GRACE_DAYS)
    stmt = delete(RefreshToken).where(
        or_(
            RefreshToken.expires_at <= now,
            and_(
                RefreshToken.revoked_at.is_not(None),
                RefreshToken.revoked_at < cutoff,
            ),
        )
    )
    async with factory() as db:
        result = await db.execute(stmt)
        await db.commit()
        count = result.rowcount or 0
    logger.info("purged %d stale refresh_tokens", count)
    return count


async def run_with_lock() -> int:
    try:
        acquired = await get_redis_client().set(
            LOCK_KEY, str(uuid.uuid4()), nx=True, ex=LOCK_TTL_SECONDS
        )
    except Exception as exc:
        logger.warning("cleanup skipped (redis unavailable): %s", exc)
        return 0
    if not acquired:
        logger.info("cleanup skipped (another worker holds the lock)")
        return 0
    return await purge_expired_refresh_tokens()


def start_scheduler() -> AsyncIOScheduler:
    scheduler = AsyncIOScheduler()
    scheduler.add_job(
        run_with_lock,
        IntervalTrigger(hours=PURGE_INTERVAL_HOURS),
        # First run shortly after boot so fresh deploys don't wait 6h.
        next_run_time=datetime.now(UTC) + timedelta(minutes=1),
        max_instances=1,
        coalesce=True,
    )
    scheduler.start()
    logger.info(
        "token cleanup scheduled every %dh (revoked grace %dd)",
        PURGE_INTERVAL_HOURS,
        REVOKED_GRACE_DAYS,
    )
    return scheduler
