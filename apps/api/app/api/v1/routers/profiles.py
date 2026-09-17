"""Profile router: current profile, list, create, rename."""

import uuid

from fastapi import APIRouter, Depends, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import ratelimit, security
from app.core.deps import ActiveProfile, get_active_profile, get_current_user
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
    db: AsyncSession = Depends(get_db),
) -> ProfileOut:
    profile = await profile_service.current_profile_for(db, active.user, active)
    return ProfileOut.from_profile(profile)


@router.get("/profiles", response_model=ProfileListOut)
async def list_profiles(
    active: ActiveProfile = Depends(get_active_profile),
    db: AsyncSession = Depends(get_db),
) -> ProfileListOut:
    profiles = await profile_service.list_for_user(db, active.user.id)
    current = await profile_service.current_profile_for(db, active.user, active)
    return ProfileListOut(
        items=[
            ProfileListItemOut.from_profile(p, is_current=p.id == current.id)
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
    active: ActiveProfile = Depends(get_active_profile),
    db: AsyncSession = Depends(get_db),
) -> SwitchOut:
    profile = await profile_service.get_owned(db, active.user.id, profile_id)
    if profile is None:
        raise AppException("Profile not found", "PROFILE_NOT_FOUND", 404)
    await profile_service.verify_pin(
        db, profile, data.pin, ratelimit.client_ip(request)
    )
    if active.session_jti is None:
        raise AppException("Session outdated", "SESSION_STALE", 401)
    await profile_service.activate_session(db, active.session_jti, profile.id)
    token = security.create_access_token(
        active.user.id, active.session_jti, profile.id
    )
    return SwitchOut(
        access_token=token, profile=ProfileOut.from_profile(profile)
    )


@router.delete("/profiles/{profile_id}", response_model=SwitchOut)
async def delete_profile(
    profile_id: uuid.UUID,
    data: ProfileSwitchIn,
    request: Request,
    active: ActiveProfile = Depends(get_active_profile),
    db: AsyncSession = Depends(get_db),
) -> SwitchOut:
    profile = await profile_service.get_owned(db, active.user.id, profile_id)
    if profile is None:
        raise AppException("Profile not found", "PROFILE_NOT_FOUND", 404)
    if profile.is_default:
        raise AppException(
            "Cannot delete the default profile", "DEFAULT_PROFILE", 409
        )
    await profile_service.verify_pin(
        db, profile, data.pin, ratelimit.client_ip(request)
    )
    was_active = profile.id == active.profile.id
    await profile_service.delete(db, profile)
    if not was_active:
        return SwitchOut(access_token=None, profile=None)
    default = await profile_service.default_for(db, active.user.id)
    token = None
    if active.session_jti is not None:
        token = security.create_access_token(
            active.user.id, active.session_jti, default.id
        )
    return SwitchOut(
        access_token=token, profile=ProfileOut.from_profile(default)
    )


@router.put("/profiles/{profile_id}/pin", response_model=ProfileOut)
async def set_profile_pin(
    profile_id: uuid.UUID,
    data: ProfilePinIn,
    request: Request,
    current: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> ProfileOut:
    await ratelimit.check_rate_limit(
        f"profile-pin-set:{ratelimit.client_ip(request)}",
        profile_service.PIN_MAX_ATTEMPTS,
        profile_service.PIN_WINDOW,
    )
    profile = await profile_service.get_owned(db, current.id, profile_id)
    if profile is None:
        raise AppException("Profile not found", "PROFILE_NOT_FOUND", 404)
    updated = await profile_service.set_pin(
        db, profile, data.password, data.pin
    )
    return ProfileOut.from_profile(updated)
