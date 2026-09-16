"""Library schemas: watch progress + favorites + watchlist + ratings + comments."""

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


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


class WatchlistAdd(BaseModel):
    movie_slug: str = Field(min_length=1, max_length=255)
    movie_name: str = Field(min_length=1, max_length=255)
    poster_url: str | None = Field(default=None, max_length=2048)


class WatchlistOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    movie_slug: str
    movie_name: str
    poster_url: str | None
    created_at: datetime


class PaginatedWatchlist(BaseModel):
    items: list[WatchlistOut]
    page: int
    per_page: int
    total_items: int


class WatchlistStatus(BaseModel):
    is_saved: bool


class WatchedAdd(BaseModel):
    movie_slug: str = Field(min_length=1, max_length=255)
    movie_name: str = Field(min_length=1, max_length=255)
    episode_slug: str = Field(min_length=1, max_length=255)
    episode_name: str = Field(min_length=1, max_length=255)
    poster_url: str | None = Field(default=None, max_length=2048)
    server_name: str | None = Field(default=None, max_length=255)


class WatchedOut(BaseModel):
    episode_slugs: list[str]


class RatingUpsert(BaseModel):
    movie_slug: str = Field(min_length=1, max_length=255)
    stars: int = Field(ge=1, le=5)


class RatingOut(BaseModel):
    movie_slug: str
    stars: int


class RatingStatus(BaseModel):
    stars: int | None


class RatingSummary(BaseModel):
    average: float | None
    count: int


class CommentUser(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    username: str
    display_name: str


class ReplyOut(BaseModel):
    id: uuid.UUID
    user: CommentUser
    body: str | None
    is_hidden: bool = False
    reported: bool = False
    created_at: datetime


class CommentOut(BaseModel):
    id: uuid.UUID
    movie_slug: str
    user: CommentUser
    body: str | None
    is_hidden: bool = False
    reported: bool = False
    created_at: datetime
    replies: list[ReplyOut] = Field(default_factory=list)
    reply_count: int = 0


class PaginatedComments(BaseModel):
    items: list[CommentOut]
    page: int
    per_page: int
    total_items: int


class CommentAdd(BaseModel):
    movie_slug: str = Field(min_length=1, max_length=255)
    body: str = Field(min_length=1, max_length=2000)
    parent_id: uuid.UUID | None = None

    @field_validator("body", mode="before")
    @classmethod
    def _strip_body(cls, v: object) -> object:
        if isinstance(v, str):
            return v.strip()
        return v
