"""Per-profile taste preferences, taste profile, and recommendations."""

import uuid

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
from app.schemas.taste import (
    FeedbackIn,
    FeedbackItem,
    FeedbackOut,
    TasteOut,
)
from app.services import (
    catalog_service,
    feedback_service,
    preference_service,
    recommendation_service,
    taste_service,
)

router = APIRouter(prefix="/me", tags=["recommendations"])


async def _read_out(db: AsyncSession, profile_id: uuid.UUID, row) -> PreferencesOut:
    has_signals = await taste_service.has_signals(db, profile_id)
    if row is None:
        return PreferencesOut(
            genres={},
            countries={},
            excluded_genres=[],
            onboarding_completed_at=None,
            skipped=False,
            has_signals=has_signals,
        )
    return PreferencesOut.from_preference(row, has_signals)


@router.get("/preferences", response_model=PreferencesOut)
async def read_preferences(
    active: ActiveProfile = Depends(get_active_profile),
    db: AsyncSession = Depends(get_db),
) -> PreferencesOut:
    row = await preference_service.get_or_none(db, active.profile.id)
    return await _read_out(db, active.profile.id, row)


@router.put("/preferences", response_model=PreferencesOut)
async def save_preferences(
    data: PreferencesIn,
    active: ActiveProfile = Depends(get_active_profile),
    db: AsyncSession = Depends(get_db),
) -> PreferencesOut:
    row = await preference_service.upsert_quiz(db, active.profile.id, data)
    return await _read_out(db, active.profile.id, row)


@router.post("/preferences/posters", response_model=PreferencesOut)
async def submit_poster_feedback(
    data: PosterFeedbackIn,
    active: ActiveProfile = Depends(get_active_profile),
    db: AsyncSession = Depends(get_db),
) -> PreferencesOut:
    row = await preference_service.add_poster_weights(db, active.profile.id, data.liked)
    return await _read_out(db, active.profile.id, row)


@router.delete("/preferences", status_code=204)
async def reset_preferences(
    active: ActiveProfile = Depends(get_active_profile),
    db: AsyncSession = Depends(get_db),
) -> Response:
    await preference_service.reset(db, active.profile.id)
    return Response(status_code=204)


@router.get("/taste", response_model=TasteOut)
async def read_taste(
    active: ActiveProfile = Depends(get_active_profile),
    db: AsyncSession = Depends(get_db),
) -> TasteOut:
    profile_id = active.profile.id
    prefs = await preference_service.get_or_none(db, profile_id)
    taste = await taste_service.taste_profile(db, profile_id, prefs)

    rows = await feedback_service.list_for_profile(db, profile_id)
    cards = {
        item.slug: item
        for item in await catalog_service.by_slugs(db, [row.movie_slug for row in rows])
    }
    feedback = [
        FeedbackItem(
            movie=catalog_service.card_of(cards[row.movie_slug]),
            kind=row.kind,
            created_at=row.created_at,
        )
        for row in rows
        if row.movie_slug in cards
    ]
    return TasteOut(
        genre_weights=taste.genre_weights,
        sources=taste.sources,
        country_weights=taste.country_weights,
        excluded_genres=sorted(taste.excluded_genres),
        feedback=feedback,
        has_signals=taste.has_signals,
        onboarding_completed_at=(prefs.onboarding_completed_at if prefs else None),
        skipped=prefs.skipped if prefs else False,
    )


@router.post("/recommendations/feedback", response_model=FeedbackOut)
async def submit_recommendation_feedback(
    data: FeedbackIn,
    active: ActiveProfile = Depends(get_active_profile),
    db: AsyncSession = Depends(get_db),
) -> FeedbackOut:
    await feedback_service.upsert(db, active.profile.id, data.movie_slug, data.kind)
    return FeedbackOut(movie_slug=data.movie_slug, kind=data.kind)


@router.delete("/recommendations/feedback/{movie_slug}")
async def remove_recommendation_feedback(
    movie_slug: str,
    active: ActiveProfile = Depends(get_active_profile),
    db: AsyncSession = Depends(get_db),
) -> dict[str, bool]:
    await feedback_service.remove(db, active.profile.id, movie_slug)
    return {"ok": True}


@router.get("/recommendations", response_model=RecommendationsOut)
async def read_recommendations(
    limit: int = settings.recs_limit,
    active: ActiveProfile = Depends(get_active_profile),
    db: AsyncSession = Depends(get_db),
) -> RecommendationsOut:
    return await recommendation_service.recommend(db, active.profile.id, limit)
