"""Redis cache for upstream responses with stale-on-error fallback."""

import hashlib
import json
from collections.abc import Awaitable, Callable
from typing import TypeVar

from pydantic import BaseModel
from redis.exceptions import RedisError

from app.core.exceptions import AppException
from app.db.session import get_redis_client

LIST_TTL = 600  # 10 minutes
DETAIL_TTL = 1800  # 30 minutes
SEARCH_TTL = 300  # 5 minutes
STALE_TTL = 86400  # keep a stale copy for 24h as fallback

T = TypeVar("T", bound=BaseModel)


def cache_key(endpoint: str, params: dict) -> str:
    digest = hashlib.sha256(
        json.dumps(params, sort_keys=True, ensure_ascii=False).encode()
    ).hexdigest()[:16]
    return f"nguonc:{endpoint}:{digest}"


async def _safe_get(key: str) -> str | None:
    try:
        return await get_redis_client().get(key)
    except RedisError:
        return None


async def _safe_set(key: str, value: str, ttl: int) -> None:
    try:
        await get_redis_client().set(key, value, ex=ttl)
    except RedisError:
        pass


async def cached_fetch(
    key: str,
    ttl: int,
    model: type[T],
    fetcher: Callable[[], Awaitable[T]],
) -> tuple[T, str]:
    """Return (data, status) where status is HIT, MISS or STALE.

    On upstream failure, serve the stale copy if present instead of erroring.
    """
    cached = await _safe_get(key)
    if cached is not None:
        return model.model_validate_json(cached), "HIT"
    try:
        data = await fetcher()
    except AppException:
        stale = await _safe_get(f"{key}:stale")
        if stale is not None:
            return model.model_validate_json(stale), "STALE"
        raise
    payload = data.model_dump_json()
    await _safe_set(key, payload, ttl)
    await _safe_set(f"{key}:stale", payload, STALE_TTL)
    return data, "MISS"


async def invalidate(prefix: str = "nguonc:") -> int:
    """Delete cached upstream entries by prefix. Returns keys removed."""
    try:
        client = get_redis_client()
        removed = 0
        async for key in client.scan_iter(match=f"{prefix}*"):
            await client.delete(key)
            removed += 1
        return removed
    except RedisError:
        return 0
