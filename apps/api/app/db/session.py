"""Async engine, session factory, and FastAPI dependencies wiring."""

from collections.abc import AsyncIterator

import redis.asyncio as redis
from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from app.core.config import settings

engine = create_async_engine(settings.database_url, pool_pre_ping=True)
session_factory = async_sessionmaker(
    engine, class_=AsyncSession, expire_on_commit=False
)

_redis_client: redis.Redis | None = None


def get_redis_client() -> redis.Redis:
    global _redis_client
    if _redis_client is None:
        _redis_client = redis.from_url(settings.redis_url, decode_responses=True)
    return _redis_client


async def get_db() -> AsyncIterator[AsyncSession]:
    async with session_factory() as session:
        yield session


async def close_connections() -> None:
    global _redis_client
    await engine.dispose()
    if _redis_client is not None:
        await _redis_client.aclose()
        _redis_client = None
