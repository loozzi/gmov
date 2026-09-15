"""Library schemas: watch progress + favorites (API boundary)."""

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, model_validator


class ProgressUpsert(BaseModel):
    movie_slug: str = Field(min_length=1, max_length=255)
    movie_name: str = Field(min_length=1, max_length=255)
    poster_url: str | None = Field(default=None, max_length=2048)
    episode_slug: str = Field(min_length=1, max_length=255)
    episode_name: str = Field(min_length=1, max_length=255)
    server_name: str | None = Field(default=None, max_length=255)
    position_seconds: int = Field(default=0, ge=0)
    duration_seconds: int | None = Field(default=None, gt=0)

    @model_validator(mode="after")
    def _check_position(self) -> "ProgressUpsert":
        if (
            self.duration_seconds is not None
            and self.position_seconds > self.duration_seconds
        ):
            raise ValueError("position_seconds must not exceed duration_seconds")
        return self


class ProgressOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    movie_slug: str
    movie_name: str
    poster_url: str | None
    episode_slug: str
    episode_name: str
    server_name: str | None
    position_seconds: int
    duration_seconds: int | None
    updated_at: datetime


class PaginatedProgress(BaseModel):
    items: list[ProgressOut]
    page: int
    per_page: int
    total_items: int


class FavoriteAdd(BaseModel):
    movie_slug: str = Field(min_length=1, max_length=255)
    movie_name: str = Field(min_length=1, max_length=255)
    poster_url: str | None = Field(default=None, max_length=2048)


class FavoriteOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    movie_slug: str
    movie_name: str
    poster_url: str | None
    created_at: datetime


class PaginatedFavorites(BaseModel):
    items: list[FavoriteOut]
    page: int
    per_page: int
    total_items: int


class FavoriteStatus(BaseModel):
    is_favorite: bool


class WatchedAdd(BaseModel):
    movie_slug: str = Field(min_length=1, max_length=255)
    movie_name: str = Field(min_length=1, max_length=255)
    episode_slug: str = Field(min_length=1, max_length=255)
    episode_name: str = Field(min_length=1, max_length=255)
    poster_url: str | None = Field(default=None, max_length=2048)
    server_name: str | None = Field(default=None, max_length=255)


class WatchedOut(BaseModel):
    episode_slugs: list[str]
