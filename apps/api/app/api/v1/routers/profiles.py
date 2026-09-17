"""Profile router: current profile, list, create, rename."""

import uuid

from fastapi import APIRouter, Depends, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import ratelimit, security
from app.core.deps import (
    ActiveProfile,
    SessionContext,
    get_active_profile,
    get_current_user,
    get_session_context,
)
from app.core.exceptions import AppException
from app.db.models.user import User
from app.db.session import get_db
from app.schemas.profile import (
    ProfileCreateIn,
    ProfileListItemOut,
    ProfileListOut,
    ProfileOut,
    ProfilePatchIn,
    ProfilePinIn,
    ProfileSwitchIn,
    SwitchOut,
)
from app.services import profile_service

router = APIRouter(prefix="/me", tags=["profiles"])


@router.get("/profile", response_model=ProfileOut)
async def read_current_profile(
    active: ActiveProfile = Depends(get_active_profile),
) -> ProfileOut:
    return ProfileOut.from_profile(active.profile)


@router.get("/profiles", response_model=ProfileListOut)
async def list_profiles(
    ctx: SessionContext = Depends(get_session_context),
    db: AsyncSession = Depends(get_db),
) -> ProfileListOut:
    profiles = await profile_service.list_for_user(db, ctx.user.id)
    return ProfileListOut(
        items=[
            ProfileListItemOut.from_profile(
                p, is_current=ctx.profile is not None and p.id == ctx.profile.id
            )
            for p in profiles
        ],
        max=profile_service.MAX_PROFILES,
    )


@router.post("/profiles", response_model=ProfileOut, status_code=201)
async def create_profile(
    data: ProfileCreateIn,
    current: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> ProfileOut:
    profile = await profile_service.create(db, current, data.name, data.avatar)
    return ProfileOut.from_profile(profile)


@router.patch("/profiles/{profile_id}", response_model=ProfileOut)
async def patch_profile(
    profile_id: uuid.UUID,
    data: ProfilePatchIn,
    current: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> ProfileOut:
    profile = await profile_service.get_owned(db, current.id, profile_id)
    if profile is None:
        raise AppException("Profile not found", "PROFILE_NOT_FOUND", 404)
    updated = await profile_service.rename(db, profile, data.name, data.avatar)
    return ProfileOut.from_profile(updated)


@router.post("/profiles/{profile_id}/switch", response_model=SwitchOut)
async def switch_profile(
    profile_id: uuid.UUID,
    data: ProfileSwitchIn,
    request: Request,
    ctx: SessionContext = Depends(get_session_context),
    db: AsyncSession = Depends(get_db),
) -> SwitchOut:
    """The only way to get a profile-bound token: verifies the PIN first, then
    points this session (and the new access token) at the profile."""
    profile = await profile_service.get_owned(db, ctx.user.id, profile_id)
    if profile is None:
        raise AppException("Profile not found", "PROFILE_NOT_FOUND", 404)
    await profile_service.verify_pin(
        db, profile, data.pin, ratelimit.client_ip(request)
    )
    if ctx.session_jti is None:
        raise AppException("Session outdated", "SESSION_STALE", 401)
    await profile_service.activate_session(db, ctx.session_jti, profile.id)
    token = security.create_access_token(
        ctx.user.id, ctx.session_jti, profile.id
    )
    return SwitchOut(
        access_token=token, profile=ProfileOut.from_profile(profile)
    )


@router.delete("/profiles/{profile_id}", response_model=SwitchOut)
async def delete_profile(
    profile_id: uuid.UUID,
    data: ProfileSwitchIn,
    request: Request,
    ctx: SessionContext = Depends(get_session_context),
    db: AsyncSession = Depends(get_db),
) -> SwitchOut:
    profile = await profile_service.get_owned(db, ctx.user.id, profile_id)
    if profile is None:
        raise AppException("Profile not found", "PROFILE_NOT_FOUND", 404)
    if profile.is_default:
        raise AppException(
            "Cannot delete the default profile", "DEFAULT_PROFILE", 409
        )
    await profile_service.verify_pin(
        db, profile, data.pin, ratelimit.client_ip(request)
    )
    was_active = ctx.profile is not None and profile.id == ctx.profile.id
    await profile_service.delete(db, profile)
    if was_active and ctx.session_jti is not None:
        # No successor profile is handed out: the session goes back to the
        # chooser, so a PIN-locked default is never entered implicitly.
        await profile_service.repoint_session(db, ctx.session_jti, None)
    return SwitchOut(access_token=None, profile=None)


@router.put("/profiles/{profile_id}/pin", response_model=ProfileOut)
async def set_profile_pin(
    profile_id: uuid.UUID,
    data: ProfilePinIn,
    request: Request,
    current: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> ProfileOut:
    ip = ratelimit.client_ip(request)
    await ratelimit.check_login_allowed(ip, current.username)
    profile = await profile_service.get_owned(db, current.id, profile_id)
    if profile is None:
        raise AppException("Profile not found", "PROFILE_NOT_FOUND", 404)
    try:
        updated = await profile_service.set_pin(
            db, profile, data.password, data.pin, data.current_pin, ip
        )
    except AppException as exc:
        if exc.code == "INVALID_PASSWORD":
            await ratelimit.record_login_failure(ip, current.username)
        raise
    await ratelimit.clear_login_failures(ip, current.username)
    return ProfileOut.from_profile(updated)
