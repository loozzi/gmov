"""Redis fixed-window rate limiting (fail-open if Redis is down)."""

from fastapi import Request
from redis.exceptions import RedisError

from app.core.exceptions import AppException
from app.db.session import get_redis_client

LOGIN_FAIL_LIMIT = 5
LOGIN_FAIL_WINDOW = 900  # 15 minutes


def client_ip(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


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


def _login_fail_key(ip: str) -> str:
    return f"ratelimit:login-fail:{ip}"


async def check_login_allowed(ip: str) -> None:
    try:
        fails = await get_redis_client().get(_login_fail_key(ip))
        if fails is not None and int(fails) >= LOGIN_FAIL_LIMIT:
            raise AppException(
                "Too many failed logins. Try again in 15 minutes.",
                "RATE_LIMITED",
                429,
            )
    except AppException:
        raise
    except (RedisError, OSError, ValueError):
        pass


async def record_login_failure(ip: str) -> None:
    try:
        client = get_redis_client()
        count = await client.incr(_login_fail_key(ip))
        if count == 1:
            await client.expire(_login_fail_key(ip), LOGIN_FAIL_WINDOW)
    except (RedisError, OSError):
        pass


async def clear_login_failures(ip: str) -> None:
    try:
        await get_redis_client().delete(_login_fail_key(ip))
    except (RedisError, OSError):
        pass
