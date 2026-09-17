"""Per-profile taste preferences and recommendation endpoints."""

from fastapi import APIRouter, Depends, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.deps import ActiveProfile, get_active_profile
from app.db.session import get_db
from app.schemas.preference import (
    PosterFeedbackIn,
    PreferencesIn,
    PreferencesOut,
)
from app.schemas.recommendation import RecommendationsOut
from app.services import preference_service, recommendation_service

router = APIRouter(prefix="/me", tags=["recommendations"])


def _empty() -> PreferencesOut:
    return PreferencesOut(
        genres={}, countries={}, onboarding_completed_at=None, skipped=False
    )


@router.get("/preferences", response_model=PreferencesOut)
async def read_preferences(
    active: ActiveProfile = Depends(get_active_profile),
    db: AsyncSession = Depends(get_db),
) -> PreferencesOut:
    row = await preference_service.get_or_none(db, active.profile.id)
    if row is None:
        return _empty()
    return PreferencesOut.from_preference(row)


@router.put("/preferences", response_model=PreferencesOut)
async def save_preferences(
    data: PreferencesIn,
    active: ActiveProfile = Depends(get_active_profile),
    db: AsyncSession = Depends(get_db),
) -> PreferencesOut:
    row = await preference_service.upsert_quiz(db, active.profile.id, data)
    return PreferencesOut.from_preference(row)


@router.post("/preferences/posters", response_model=PreferencesOut)
async def submit_poster_feedback(
    data: PosterFeedbackIn,
    active: ActiveProfile = Depends(get_active_profile),
    db: AsyncSession = Depends(get_db),
) -> PreferencesOut:
    row = await preference_service.add_poster_weights(
        db, active.profile.id, data.liked
    )
    return PreferencesOut.from_preference(row)


@router.delete("/preferences", status_code=204)
async def reset_preferences(
    active: ActiveProfile = Depends(get_active_profile),
    db: AsyncSession = Depends(get_db),
) -> Response:
    await preference_service.reset(db, active.profile.id)
    return Response(status_code=204)


@router.get("/recommendations", response_model=RecommendationsOut)
async def read_recommendations(
    limit: int = settings.recs_limit,
    active: ActiveProfile = Depends(get_active_profile),
    db: AsyncSession = Depends(get_db),
) -> RecommendationsOut:
    return await recommendation_service.recommend(db, active.profile.id, limit)
