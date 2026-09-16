"""Auth router: register, login, refresh, logout."""

from fastapi import APIRouter, Depends, Request, status
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import ratelimit
from app.core.exceptions import AppException
from app.db.session import get_db
from app.schemas.auth import RefreshIn, RegisterIn, TokenPair
from app.schemas.user import UserOut
from app.services import auth_service

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/register", response_model=UserOut, status_code=status.HTTP_201_CREATED)
async def register(
    request: Request,
    data: RegisterIn,
    db: AsyncSession = Depends(get_db),
) -> UserOut:
    ip = ratelimit.client_ip(request)
    await ratelimit.check_register_allowed(ip)
    if data.website:
        raise AppException(
            "Yêu cầu đăng ký không hợp lệ.",
            "BOT_DETECTED",
            400,
        )
    user = await auth_service.register(db, data)
    await ratelimit.record_register_success(ip)
    return UserOut.model_validate(user)


@router.post("/login", response_model=TokenPair)
async def login(
    request: Request,
    form: OAuth2PasswordRequestForm = Depends(),
    db: AsyncSession = Depends(get_db),
) -> TokenPair:
    ip = ratelimit.client_ip(request)
    await ratelimit.check_login_allowed(ip, form.username)
    try:
        pair = await auth_service.login(db, form.username, form.password)
    except AppException:
        await ratelimit.record_login_failure(ip, form.username)
        raise
    await ratelimit.clear_login_failures(ip, form.username)
    return pair


@router.post("/refresh", response_model=TokenPair)
async def refresh(
    data: RefreshIn, db: AsyncSession = Depends(get_db)
) -> TokenPair:
    return await auth_service.refresh(db, data.refresh_token)


@router.post("/logout")
async def logout(
    data: RefreshIn, db: AsyncSession = Depends(get_db)
) -> dict[str, bool]:
    await auth_service.logout(db, data.refresh_token)
    return {"ok": True}
