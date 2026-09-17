"""Recommendation rail schemas (API boundary)."""

from typing import Literal

from pydantic import BaseModel, Field

from app.schemas.movie import MovieCard


class RecommendationItem(BaseModel):
    movie: MovieCard
    reason: str | None = None


class RecommendationsOut(BaseModel):
    items: list[RecommendationItem] = Field(default_factory=list)
    source: Literal["personal", "popular", "newest"] = "personal"
