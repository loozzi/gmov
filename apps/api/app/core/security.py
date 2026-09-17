"""Password hashing (bcrypt via passlib) and JWT helpers (PyJWT)."""

import uuid
from datetime import UTC, datetime, timedelta

import jwt
from passlib.context import CryptContext

from app.core.config import settings

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

ACCESS_TOKEN_TYPE = "access"
REFRESH_TOKEN_TYPE = "refresh"


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(password: str, hashed: str) -> bool:
    return pwd_context.verify(password, hashed)


def _encode(
    subject: str,
    token_type: str,
    expires: timedelta,
    extra: dict[str, str] | None = None,
) -> str:
    now = datetime.now(UTC)
    payload = {
        "sub": subject,
        "type": token_type,
        "jti": str(uuid.uuid4()),
        "iat": now,
        "exp": now + expires,
    }
    if extra:
        payload.update(extra)
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def create_access_token(
    user_id: uuid.UUID, session_jti: str, profile_id: uuid.UUID | None = None
) -> str:
    """Mint an access token. `pid` is the session's selected profile and is
    omitted entirely until the user picks one (see `POST /me/profiles/{id}
    /switch`), so an unselected token can never be mistaken for "the default
    profile": profile-scoped endpoints answer PROFILE_REQUIRED instead."""
    extra = {"sid": session_jti}
    if profile_id is not None:
        extra["pid"] = str(profile_id)
    return _encode(
        str(user_id),
        ACCESS_TOKEN_TYPE,
        timedelta(minutes=settings.access_token_expire_minutes),
        extra,
    )


def create_refresh_token(user_id: uuid.UUID) -> tuple[str, str]:
    """Return (token, jti) so the caller can persist the jti."""
    token = _encode(
        str(user_id),
        REFRESH_TOKEN_TYPE,
        timedelta(days=settings.refresh_token_expire_days),
    )
    jti = str(jwt.decode(token, options={"verify_signature": False}).get("jti", ""))
    return token, jti


def decode_token(token: str) -> dict:
    return jwt.decode(
        token, settings.jwt_secret, algorithms=[settings.jwt_algorithm]
    )
