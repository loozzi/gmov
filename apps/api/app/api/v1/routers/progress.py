"""Progress router: playback progress, continue-watching, watched episodes."""

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import ActiveProfile, get_active_profile
from app.core.ratelimit import check_rate_limit
from app.db.session import get_db
from app.schemas.library import (
    PaginatedProgress,
    ProgressOut,
    ProgressUpsert,
    WatchedAdd,
    WatchedOut,
)
from app.services import progress_service

router = APIRouter(prefix="/me", tags=["progress"])

PROGRESS_RATE_LIMIT = 20
PROGRESS_RATE_WINDOW = 60


async def rate_limited_profile(
    active: ActiveProfile = Depends(get_active_profile),
) -> ActiveProfile:
    await check_rate_limit(
        f"ratelimit:progress:{active.user.id}",
        PROGRESS_RATE_LIMIT,
        PROGRESS_RATE_WINDOW,
    )
    return active


@router.put("/progress", response_model=ProgressOut)
async def upsert_progress(
    data: ProgressUpsert,
    active: ActiveProfile = Depends(rate_limited_profile),
    db: AsyncSession = Depends(get_db),
) -> ProgressOut:
    row = await progress_service.upsert(db, active.profile.id, data)
    return ProgressOut.model_validate(row)


@router.get("/continue-watching", response_model=PaginatedProgress)
async def continue_watching(
    active: ActiveProfile = Depends(get_active_profile),
    db: AsyncSession = Depends(get_db),
    page: int = Query(default=1, ge=1),
    per_page: int = Query(default=20, ge=1, le=100),
) -> PaginatedProgress:
    rows, total = await progress_service.continue_watching(
        db, active.profile.id, page, per_page
    )
    return PaginatedProgress(
        items=[ProgressOut.model_validate(r) for r in rows],
        page=page,
        per_page=per_page,
        total_items=total,
    )


@router.get("/progress/{movie_slug}", response_model=ProgressOut)
async def get_progress(
    movie_slug: str,
    active: ActiveProfile = Depends(get_active_profile),
    db: AsyncSession = Depends(get_db),
) -> ProgressOut:
    row = await progress_service.get_for_movie(db, active.profile.id, movie_slug)
    return ProgressOut.model_validate(row)


@router.delete("/progress/{movie_slug}")
async def delete_progress(
    movie_slug: str,
    active: ActiveProfile = Depends(get_active_profile),
    db: AsyncSession = Depends(get_db),
) -> dict[str, bool]:
    await progress_service.delete_for_movie(db, active.profile.id, movie_slug)
    return {"ok": True}


@router.get("/watched/{movie_slug}", response_model=WatchedOut)
async def get_watched(
    movie_slug: str,
    active: ActiveProfile = Depends(get_active_profile),
    db: AsyncSession = Depends(get_db),
) -> WatchedOut:
    return WatchedOut(
        episode_slugs=await progress_service.watched_episodes(
            db, active.profile.id, movie_slug
        )
    )


@router.post("/watched")
async def mark_watched(
    data: WatchedAdd,
    active: ActiveProfile = Depends(rate_limited_profile),
    db: AsyncSession = Depends(get_db),
) -> dict[str, bool]:
    await progress_service.mark_watched(
        db,
        active.profile.id,
        data.movie_slug,
        data.movie_name,
        data.episode_slug,
        data.episode_name,
        data.poster_url,
        data.server_name,
        data.episode_index,
        data.total_episodes,
    )
    return {"ok": True}
