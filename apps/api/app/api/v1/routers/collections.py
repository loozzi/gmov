"""Collections router: favorites and watchlist."""

from fastapi import APIRouter, Depends, Query, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import ActiveProfile, get_active_profile
from app.db.session import get_db
from app.schemas.library import (
    FavoriteAdd,
    FavoriteOut,
    FavoriteStatus,
    PaginatedFavorites,
    PaginatedWatchlist,
    WatchlistAdd,
    WatchlistOut,
    WatchlistStatus,
)
from app.services import favorite_service, watchlist_service

router = APIRouter(prefix="/me", tags=["collections"])


@router.post("/favorites", response_model=FavoriteOut)
async def add_favorite(
    data: FavoriteAdd,
    response: Response,
    active: ActiveProfile = Depends(get_active_profile),
    db: AsyncSession = Depends(get_db),
) -> FavoriteOut:
    row, created = await favorite_service.add(db, active.profile.id, data)
    response.status_code = status.HTTP_201_CREATED if created else status.HTTP_200_OK
    return FavoriteOut.model_validate(row)


@router.get("/favorites", response_model=PaginatedFavorites)
async def list_favorites(
    active: ActiveProfile = Depends(get_active_profile),
    db: AsyncSession = Depends(get_db),
    page: int = Query(default=1, ge=1),
    per_page: int = Query(default=20, ge=1, le=100),
) -> PaginatedFavorites:
    rows, total = await favorite_service.list_paginated(
        db, active.profile.id, page, per_page
    )
    return PaginatedFavorites(
        items=[FavoriteOut.model_validate(r) for r in rows],
        page=page,
        per_page=per_page,
        total_items=total,
    )


@router.get("/favorites/{movie_slug}/status", response_model=FavoriteStatus)
async def favorite_status(
    movie_slug: str,
    active: ActiveProfile = Depends(get_active_profile),
    db: AsyncSession = Depends(get_db),
) -> FavoriteStatus:
    return FavoriteStatus(
        is_favorite=await favorite_service.is_favorite(
            db, active.profile.id, movie_slug
        )
    )


@router.delete("/favorites/{movie_slug}")
async def remove_favorite(
    movie_slug: str,
    active: ActiveProfile = Depends(get_active_profile),
    db: AsyncSession = Depends(get_db),
) -> dict[str, bool]:
    await favorite_service.remove(db, active.profile.id, movie_slug)
    return {"ok": True}


@router.post("/watchlist", response_model=WatchlistOut)
async def add_watchlist(
    data: WatchlistAdd,
    response: Response,
    active: ActiveProfile = Depends(get_active_profile),
    db: AsyncSession = Depends(get_db),
) -> WatchlistOut:
    row, created = await watchlist_service.add(db, active.profile.id, data)
    response.status_code = status.HTTP_201_CREATED if created else status.HTTP_200_OK
    return WatchlistOut.model_validate(row)


@router.get("/watchlist", response_model=PaginatedWatchlist)
async def list_watchlist(
    active: ActiveProfile = Depends(get_active_profile),
    db: AsyncSession = Depends(get_db),
    page: int = Query(default=1, ge=1),
    per_page: int = Query(default=20, ge=1, le=100),
) -> PaginatedWatchlist:
    rows, total = await watchlist_service.list_paginated(
        db, active.profile.id, page, per_page
    )
    return PaginatedWatchlist(
        items=[WatchlistOut.model_validate(r) for r in rows],
        page=page,
        per_page=per_page,
        total_items=total,
    )


@router.get("/watchlist/{movie_slug}/status", response_model=WatchlistStatus)
async def watchlist_status(
    movie_slug: str,
    active: ActiveProfile = Depends(get_active_profile),
    db: AsyncSession = Depends(get_db),
) -> WatchlistStatus:
    return WatchlistStatus(
        is_saved=await watchlist_service.is_saved(db, active.profile.id, movie_slug)
    )


@router.delete("/watchlist/{movie_slug}")
async def remove_watchlist(
    movie_slug: str,
    active: ActiveProfile = Depends(get_active_profile),
    db: AsyncSession = Depends(get_db),
) -> dict[str, bool]:
    await watchlist_service.remove(db, active.profile.id, movie_slug)
    return {"ok": True}
