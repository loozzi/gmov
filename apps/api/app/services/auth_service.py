"""Auth business logic: register, login, refresh rotation, logout."""

import uuid
from datetime import UTC, datetime, timedelta

import jwt
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import security
from app.core.config import settings
from app.core.exceptions import AppException
from app.db.models.refresh_token import RefreshToken
from app.db.models.user import User
from app.schemas.auth import RegisterIn, TokenPair
from app.services import user_service


def _build_pair(
    user_id: uuid.UUID, family_id: uuid.UUID
) -> tuple[TokenPair, RefreshToken]:
    """Create tokens + the (unsaved) refresh row. Caller commits."""
    access = security.create_access_token(user_id)
    refresh, jti = security.create_refresh_token(user_id)
    expires_at = datetime.now(UTC) + timedelta(
        days=settings.refresh_token_expire_days
    )
    return (
        TokenPair(access_token=access, refresh_token=refresh),
        RefreshToken(
            user_id=user_id,
            jti=jti,
            family_id=family_id,
            expires_at=expires_at,
        ),
    )


async def _issue_pair(db: AsyncSession, user: User) -> TokenPair:
    pair, row = _build_pair(user.id, uuid.uuid4())
    db.add(row)
    await db.commit()
    return pair


async def register(db: AsyncSession, data: RegisterIn) -> User:
    if await user_service.email_exists(db, str(data.email)):
        raise AppException("Email already registered", "EMAIL_TAKEN", 409)
    if await user_service.username_exists(db, data.username):
        raise AppException("Username already taken", "USERNAME_TAKEN", 409)
    return await user_service.create(db, data)


async def login(db: AsyncSession, login: str, password: str) -> TokenPair:
    user = await user_service.get_by_login(db, login)
    if user is None or not security.verify_password(password, user.hashed_password):
        raise AppException("Invalid credentials", "INVALID_CREDENTIALS", 401)
    if not user.is_active:
        raise AppException("Account is disabled", "ACCOUNT_DISABLED", 403)
    return await _issue_pair(db, user)


def _decode_refresh(token: str) -> dict:
    try:
        payload = security.decode_token(token)
    except jwt.ExpiredSignatureError:
        raise AppException("Refresh token expired", "INVALID_REFRESH_TOKEN", 401)
    except jwt.PyJWTError:
        raise AppException("Invalid refresh token", "INVALID_REFRESH_TOKEN", 401)
    if payload.get("type") != security.REFRESH_TOKEN_TYPE:
        raise AppException("Invalid refresh token", "INVALID_REFRESH_TOKEN", 401)
    return payload


# A revoked token presented again within this window is treated as a
# duplicate delivery (double boot, two tabs racing rotation), NOT theft:
# re-issue instead of 401. Anything older is theft: every token in the
# family is compromised and the whole family fails hard from then on.
REFRESH_GRACE_SECONDS = 30


async def _load_row(db: AsyncSession, jti: str) -> RefreshToken | None:
    stmt = (
        select(RefreshToken)
        .where(RefreshToken.jti == jti)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    return (await db.execute(stmt)).scalar_one_or_none()


async def _revoke_family(
    db: AsyncSession, family_id: uuid.UUID, now: datetime
) -> None:
    stmt = (
        select(RefreshToken)
        .where(RefreshToken.family_id == family_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    for member in (await db.execute(stmt)).scalars().all():
        member.compromised = True
        if member.revoked_at is None:
            member.revoked_at = now
    await db.commit()


def _as_aware(value: datetime) -> datetime:
    # SQLite returns naive datetimes; Postgres (tz-aware) returns aware ones.
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value


async def refresh(db: AsyncSession, token: str) -> TokenPair:
    """Rotate refresh tokens atomically: revoke-old + issue-new share ONE
    transaction, so an earlier failure leaves the old token usable and the
    user is never logged out by a half-finished rotation. The theft branch
    is the deliberate exception: it commits the family revocation before
    raising so that write is durable."""
    payload = _decode_refresh(token)
    try:
        row = await _load_row(db, str(payload["jti"]))
        now = datetime.now(UTC)
        if row is None or _as_aware(row.expires_at) <= now:
            raise AppException(
                "Invalid refresh token", "INVALID_REFRESH_TOKEN", 401
            )
        if row.revoked_at is None:
            row.revoked_at = now  # normal rotation
        elif row.compromised or (
            now - _as_aware(row.revoked_at)
        ).total_seconds() > REFRESH_GRACE_SECONDS:
            await _revoke_family(db, row.family_id, now)
            raise AppException(
                "Invalid refresh token", "INVALID_REFRESH_TOKEN", 401
            )
        # Grace path (recently revoked): duplicate delivery — re-issue
        # without touching the row.
        user = await user_service.get_by_id(db, row.user_id)
        if user is None or not user.is_active:
            raise AppException(
                "Invalid refresh token", "INVALID_REFRESH_TOKEN", 401
            )
        pair, new_row = _build_pair(user.id, row.family_id)
        db.add(new_row)
        await db.commit()
        return pair
    except Exception:
        await db.rollback()
        raise


async def logout(db: AsyncSession, token: str) -> None:
    """Destroy a refresh session. Idempotent: unknown tokens still return 200.

    The row is DELETED (not revoked) so logout takes effect immediately —
    unlike rotation revokes, it is NOT covered by the re-issue grace window.
    """
    try:
        payload = security.decode_token(token)
    except jwt.PyJWTError:
        return
    jti = payload.get("jti")
    if not jti:
        return
    stmt = select(RefreshToken).where(RefreshToken.jti == str(jti))
    row = (await db.execute(stmt)).scalar_one_or_none()
    if row is not None:
        await db.delete(row)
        await db.commit()
