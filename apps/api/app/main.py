"""gmov API application factory."""

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text

from app.api.v1 import api_router
from app.core.config import settings
from app.core.exceptions import register_exception_handlers
from app.db.session import close_connections, engine, get_redis_client
from app.services.nguonc import aclose_client as aclose_nguonc_client
from app.services.token_cleanup import start_scheduler

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
)


@asynccontextmanager
async def lifespan(_: FastAPI):
    scheduler = start_scheduler()
    yield
    scheduler.shutdown(wait=False)
    await aclose_nguonc_client()
    await close_connections()


def create_app() -> FastAPI:
    app = FastAPI(title="gmov API", version="0.1.0", lifespan=lifespan)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    register_exception_handlers(app)
    app.include_router(api_router)
    return app


app = create_app()


async def _check_database() -> str:
    try:
        async with engine.connect() as conn:
            await conn.execute(text("SELECT 1"))
        return "up"
    except Exception:
        return "down"


async def _check_redis() -> str:
    try:
        await get_redis_client().ping()
        return "up"
    except Exception:
        return "down"


@app.get("/health", tags=["health"])
async def health() -> dict[str, str]:
    database = await _check_database()
    redis_status = await _check_redis()
    overall = "ok" if database == "up" and redis_status == "up" else "degraded"
    return {"status": overall, "database": database, "redis": redis_status}


@app.get("/api/health", tags=["health"])
async def api_health() -> dict[str, str]:
    return await health()
