"""Taste profile API schemas (weights + sources + card feedback)."""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

from app.schemas.movie import MovieCard

FeedbackKind = Literal["interested", "not_interested"]


class FeedbackIn(BaseModel):
    movie_slug: str = Field(min_length=1, max_length=255)
    kind: FeedbackKind


class FeedbackOut(BaseModel):
    movie_slug: str
    kind: FeedbackKind


class FeedbackItem(BaseModel):
    movie: MovieCard
    kind: FeedbackKind
    created_at: datetime


class TasteOut(BaseModel):
    genre_weights: dict[str, float] = Field(default_factory=dict)
    sources: dict[str, dict[str, float]] = Field(default_factory=dict)
    country_weights: dict[str, float] = Field(default_factory=dict)
    excluded_genres: list[str] = Field(default_factory=list)
    feedback: list[FeedbackItem] = Field(default_factory=list)
    has_signals: bool = False
    onboarding_completed_at: datetime | None = None
    skipped: bool = False
