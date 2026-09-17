"""Redis fixed-window rate limiting (fail-open if Redis is down)."""

import hashlib
import ipaddress
import uuid

from fastapi import Request
from redis.exceptions import RedisError

from app.core.config import settings
from app.core.exceptions import AppException
from app.db.session import get_redis_client

LOGIN_FAIL_LIMIT = 5
LOGIN_FAIL_IP_LIMIT = 20
LOGIN_FAIL_WINDOW = 900  # 15 minutes

REGISTER_HOUR_LIMIT = 3
REGISTER_HOUR_WINDOW = 3600
REGISTER_DAY_LIMIT = 10
REGISTER_DAY_WINDOW = 86400


def _peer_ip(request: Request) -> str:
    return request.client.host if request.client else "unknown"


def _in_trusted_proxies(ip: str) -> bool:
    try:
        addr = ipaddress.ip_address(ip)
    except ValueError:
        return False
    for net in settings.trusted_proxies:
        try:
            if addr in ipaddress.ip_network(net, strict=False):
                return True
        except ValueError:
            continue
    return False


def client_ip(request: Request) -> str:
    """Best-effort client IP. X-Forwarded-For is only trusted when the direct
    peer is a configured trusted proxy (e.g. our nginx), never blindly."""
    peer = _peer_ip(request)
    if peer != "unknown" and _in_trusted_proxies(peer):
        forwarded = request.headers.get("x-forwarded-for")
        if forwarded:
            first = forwarded.split(",")[0].strip()
            if first:
                try:
                    ipaddress.ip_address(first)
                    return first
                except ValueError:
                    pass
    return peer


async def check_rate_limit(key: str, limit: int, window_seconds: int) -> None:
    try:
        client = get_redis_client()
        count = await client.incr(key)
        if count == 1:
            await client.expire(key, window_seconds)
        if count > limit:
            ttl = await client.ttl(key)
            raise AppException(
                "Too many requests",
                "RATE_LIMITED",
                429,
                headers=_retry_after(ttl),
            )
    except AppException:
        raise
    except (RedisError, OSError, ValueError):
        pass


def pin_attempt_key(profile_id: uuid.UUID, ip: str) -> str:
    """Counter shared by every PIN check (switch + delete) of a profile."""
    return f"profile-pin:{profile_id}:{ip}"


def _username_digest(username: str) -> str:
    return hashlib.sha256(username.strip().lower().encode()).hexdigest()[:16]


def _login_fail_key(ip: str, username: str) -> str:
    return f"ratelimit:login-fail:{ip}:{_username_digest(username)}"


def _login_fail_ip_key(ip: str) -> str:
    return f"ratelimit:login-fail:ip:{ip}"


async def _counter(client, key: str) -> tuple[int, int]:
    """(current count, ttl seconds). Missing key -> (0, 0)."""
    count = await client.get(key)
    if count is None:
        return 0, 0
    ttl = await client.ttl(key)
    return int(count), max(ttl, 0)


def _retry_after(ttl: int) -> dict[str, str]:
    return {"Retry-After": str(max(ttl, 1))}


def _vi_cooldown(ttl: int, what: str) -> str:
    minutes = max((ttl + 59) // 60, 1)
    return f"{what} Vui lòng thử lại sau khoảng {minutes} phút."


async def check_login_allowed(ip: str, username: str) -> None:
    try:
        client = get_redis_client()
        fails, ttl = await _counter(client, _login_fail_key(ip, username))
        if fails >= LOGIN_FAIL_LIMIT:
            raise AppException(
                _vi_cooldown(ttl, "Đăng nhập sai quá nhiều lần."),
                "RATE_LIMITED",
                429,
                headers=_retry_after(ttl),
            )
        ip_fails, ip_ttl = await _counter(client, _login_fail_ip_key(ip))
        if ip_fails >= LOGIN_FAIL_IP_LIMIT:
            raise AppException(
                _vi_cooldown(ip_ttl, "Đăng nhập sai quá nhiều lần."),
                "RATE_LIMITED",
                429,
                headers=_retry_after(ip_ttl),
            )
    except AppException:
        raise
    except (RedisError, OSError, ValueError):
        pass


async def record_login_failure(ip: str, username: str) -> None:
    try:
        client = get_redis_client()
        for key in (_login_fail_key(ip, username), _login_fail_ip_key(ip)):
            count = await client.incr(key)
            if count == 1:
                await client.expire(key, LOGIN_FAIL_WINDOW)
    except (RedisError, OSError):
        pass


async def clear_login_failures(ip: str, username: str) -> None:
    try:
        await get_redis_client().delete(_login_fail_key(ip, username))
    except (RedisError, OSError):
        pass


def _register_hour_key(ip: str) -> str:
    return f"ratelimit:register-hour:{ip}"


def _register_day_key(ip: str) -> str:
    return f"ratelimit:register-day:{ip}"


async def check_register_allowed(ip: str) -> None:
    """Max 3 accounts / IP / hour, 10 / IP / day."""
    try:
        client = get_redis_client()
        hour_count, hour_ttl = await _counter(client, _register_hour_key(ip))
        if hour_count >= REGISTER_HOUR_LIMIT:
            raise AppException(
                _vi_cooldown(hour_ttl, "Bạn đã tạo quá nhiều tài khoản."),
                "RATE_LIMITED",
                429,
                headers=_retry_after(hour_ttl),
            )
        day_count, day_ttl = await _counter(client, _register_day_key(ip))
        if day_count >= REGISTER_DAY_LIMIT:
            raise AppException(
                _vi_cooldown(day_ttl, "Bạn đã tạo quá nhiều tài khoản."),
                "RATE_LIMITED",
                429,
                headers=_retry_after(day_ttl),
            )
    except AppException:
        raise
    except (RedisError, OSError, ValueError):
        pass


async def record_register_success(ip: str) -> None:
    try:
        client = get_redis_client()
        for key, window in (
            (_register_hour_key(ip), REGISTER_HOUR_WINDOW),
            (_register_day_key(ip), REGISTER_DAY_WINDOW),
        ):
            count = await client.incr(key)
            if count == 1:
                await client.expire(key, window)
    except (RedisError, OSError):
        pass
