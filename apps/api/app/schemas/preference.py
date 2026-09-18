"""Preference API schemas (request/response boundary)."""

import math
from datetime import datetime

from pydantic import BaseModel, Field, field_validator

from app.db.models.profile_preference import ProfilePreference

MAX_PREFERENCE_KEYS = 100
MAX_WEIGHT = 10.0
MAX_POSTER_SLUGS = 200


class PreferencesOut(BaseModel):
    genres: dict[str, float]
    countries: dict[str, float]
    excluded_genres: list[str]
    onboarding_completed_at: datetime | None
    skipped: bool
    has_signals: bool = False

    @classmethod
    def from_preference(
        cls, row: ProfilePreference, has_signals: bool
    ) -> "PreferencesOut":
        return cls(
            genres=dict(row.genres or {}),
            countries=dict(row.countries or {}),
            excluded_genres=list(row.excluded_genres or []),
            onboarding_completed_at=row.onboarding_completed_at,
            skipped=row.skipped,
            has_signals=has_signals,
        )


class PreferencesIn(BaseModel):
    genres: dict[str, float]
    countries: dict[str, float]
    excluded_genres: list[str] = Field(
        default_factory=list, max_length=MAX_PREFERENCE_KEYS
    )
    skipped: bool = False

    @field_validator("genres", "countries")
    @classmethod
    def _bounded_weights(cls, value: dict[str, float]) -> dict[str, float]:
        if len(value) > MAX_PREFERENCE_KEYS:
            raise ValueError(f"at most {MAX_PREFERENCE_KEYS} entries")
        for weight in value.values():
            if not math.isfinite(weight):
                raise ValueError("weight must be finite")
            if not -MAX_WEIGHT <= weight <= MAX_WEIGHT:
                raise ValueError(
                    f"weight must be within [-{MAX_WEIGHT}, {MAX_WEIGHT}]"
                )
        return value


class PosterFeedbackIn(BaseModel):
    liked: list[str] = Field(default_factory=list, max_length=MAX_POSTER_SLUGS)
    skipped: list[str] = Field(default_factory=list, max_length=MAX_POSTER_SLUGS)
