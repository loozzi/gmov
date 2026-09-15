"""Pytest fixtures: isolated sqlite DB + ASGI test client per test."""

import pytest
import pytest_asyncio
from fakeredis.aioredis import FakeRedis
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.db.base import Base
from app.db.session import get_db
from app.main import app


@pytest.fixture(autouse=True)
def _isolated_redis(monkeypatch):
    """Every test gets a fresh FakeRedis in ALL namespaces.

    Without this, tests either hit a real redis on localhost (when the
    compose stack happens to be up) — leaking throttle counters between
    tests — or share the global client across event loops.
    """
    client = FakeRedis(decode_responses=True)
    monkeypatch.setattr("app.db.session.get_redis_client", lambda: client)
    monkeypatch.setattr("app.core.ratelimit.get_redis_client", lambda: client)
    monkeypatch.setattr("app.services.cache.get_redis_client", lambda: client)
    return client


@pytest_asyncio.fixture
async def client(tmp_path):
    db_path = tmp_path / "test.db"
    engine = create_async_engine(f"sqlite+aiosqlite:///{db_path}")
    factory = async_sessionmaker(engine, expire_on_commit=False)

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    async def override_get_db():
        async with factory() as session:
            yield session

    app.dependency_overrides[get_db] = override_get_db
    try:
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as ac:
            yield ac
    finally:
        app.dependency_overrides.clear()
        await engine.dispose()


@pytest.fixture
def user_payload():
    return {
        "email": "test@gmov.dev",
        "username": "testuser",
        "password": "password123",
    }
