"""Redis fixed-window rate limiting (fail-open if Redis is down)."""

from redis.exceptions import RedisError

from app.core.exceptions import AppException
from app.db.session import get_redis_client


async def check_rate_limit(key: str, limit: int, window_seconds: int) -> None:
    try:
        client = get_redis_client()
        count = await client.incr(key)
        if count == 1:
            await client.expire(key, window_seconds)
        if count > limit:
            raise AppException("Too many requests", "RATE_LIMITED", 429)
    except AppException:
        raise
    except (RedisError, OSError):
        pass
