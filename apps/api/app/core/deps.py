"""Shared FastAPI dependencies."""

import uuid

import jwt
from fastapi import Depends
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import security
from app.core.exceptions import AppException
from app.db.models.user import User
from app.db.session import get_db
from app.services import user_service

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/v1/auth/login")


async def get_current_user(
    token: str = Depends(oauth2_scheme),
    db: AsyncSession = Depends(get_db),
) -> User:
    try:
        payload = security.decode_token(token)
    except jwt.ExpiredSignatureError:
        raise AppException("Token expired", "UNAUTHORIZED", 401)
    except jwt.PyJWTError:
        raise AppException("Invalid token", "UNAUTHORIZED", 401)
    if payload.get("type") != security.ACCESS_TOKEN_TYPE:
        raise AppException("Invalid token", "UNAUTHORIZED", 401)
    try:
        user_id = uuid.UUID(str(payload.get("sub")))
    except (ValueError, TypeError):
        raise AppException("Invalid token", "UNAUTHORIZED", 401)
    user = await user_service.get_by_id(db, user_id)
    if user is None or not user.is_active:
        raise AppException("Invalid token", "UNAUTHORIZED", 401)
    return user
