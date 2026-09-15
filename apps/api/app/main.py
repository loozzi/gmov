"""Phase 0 bootstrap FastAPI app.

Later phases add: settings (pydantic-settings), async DB engine,
Redis cache, nguonc upstream client, auth (JWT), routers.
"""

from fastapi import FastAPI

app = FastAPI(title="gmov API", version="0.1.0")


@app.get("/health", tags=["health"])
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/health", tags=["health"])
async def api_health() -> dict[str, str]:
    return {"status": "ok"}
