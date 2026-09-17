"""Preference API schemas (request/response boundary)."""

from datetime import datetime

from pydantic import BaseModel, Field

from app.db.models.profile_preference import ProfilePreference


class PreferencesOut(BaseModel):
    genres: dict[str, float]
    countries: dict[str, float]
    onboarding_completed_at: datetime | None
    skipped: bool

    @classmethod
    def from_preference(cls, row: ProfilePreference) -> "PreferencesOut":
        return cls(
            genres=dict(row.genres or {}),
            countries=dict(row.countries or {}),
            onboarding_completed_at=row.onboarding_completed_at,
            skipped=row.skipped,
        )


class PreferencesIn(BaseModel):
    genres: dict[str, float]
    countries: dict[str, float]
    skipped: bool = False


class PosterFeedbackIn(BaseModel):
    liked: list[str] = Field(default_factory=list)
    skipped: list[str] = Field(default_factory=list)
