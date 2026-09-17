"""Profile router: current profile, list, create, rename."""

import uuid

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

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
