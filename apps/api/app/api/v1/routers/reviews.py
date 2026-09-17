"""Reviews router: star ratings and comments."""

import uuid

from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import ActiveProfile, get_active_profile, get_current_user
from app.core.ratelimit import check_rate_limit
from app.db.models.user import User
from app.db.session import get_db
from app.schemas.library import (
    CommentAdd,
    CommentOut,
    CommentUser,
    RatingOut,
    RatingStatus,
    RatingUpsert,
)
from app.services import comment_service, rating_service, user_service

router = APIRouter(prefix="/me", tags=["reviews"])

COMMENT_RATE_LIMIT = 10
COMMENT_RATE_WINDOW = 60


async def rate_limited_comment_user(
    current: User = Depends(get_current_user),
) -> User:
    await check_rate_limit(
        f"ratelimit:comments:{current.id}",
        COMMENT_RATE_LIMIT,
        COMMENT_RATE_WINDOW,
    )
    return current


@router.put("/ratings", response_model=RatingOut)
async def upsert_rating(
    data: RatingUpsert,
    active: ActiveProfile = Depends(get_active_profile),
    db: AsyncSession = Depends(get_db),
) -> RatingOut:
    row = await rating_service.upsert(db, active.profile.id, data)
    return RatingOut(movie_slug=row.movie_slug, stars=row.stars)


@router.delete("/ratings/{movie_slug}")
async def delete_rating(
    movie_slug: str,
    active: ActiveProfile = Depends(get_active_profile),
    db: AsyncSession = Depends(get_db),
) -> dict[str, bool]:
    await rating_service.remove(db, active.profile.id, movie_slug)
    return {"ok": True}


@router.get("/ratings/{movie_slug}/status", response_model=RatingStatus)
async def rating_status(
    movie_slug: str,
    active: ActiveProfile = Depends(get_active_profile),
    db: AsyncSession = Depends(get_db),
) -> RatingStatus:
    stars = await rating_service.get_stars(db, active.profile.id, movie_slug)
    return RatingStatus(stars=stars)


@router.post(
    "/comments", response_model=CommentOut, status_code=status.HTTP_201_CREATED
)
async def create_comment(
    data: CommentAdd,
    current: User = Depends(rate_limited_comment_user),
    db: AsyncSession = Depends(get_db),
) -> CommentOut:
    row = await comment_service.create(db, current.id, data)
    user = await user_service.get_by_id(db, current.id)
    return CommentOut(
        id=row.id,
        movie_slug=row.movie_slug,
        user=CommentUser(username=user.username, display_name=user.display_name),
        body=row.body,
        created_at=row.created_at,
    )


@router.delete("/comments/{comment_id}")
async def delete_comment(
    comment_id: uuid.UUID,
    current: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict[str, bool]:
    await comment_service.delete_owned(db, current.id, comment_id)
    return {"ok": True}
