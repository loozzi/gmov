"""Watchlist ("want to watch") movies per profile."""

import uuid

from sqlalchemy import ForeignKey, String, UniqueConstraint, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin


class Watchlist(Base, TimestampMixin):
    __tablename__ = "watchlist"
    __table_args__ = (
        UniqueConstraint(
            "profile_id", "movie_slug", name="uq_watchlist_profile_movie"
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    profile_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("profiles.id", ondelete="CASCADE"), index=True, nullable=False
    )
    movie_slug: Mapped[str] = mapped_column(String(255), index=True, nullable=False)
    movie_name: Mapped[str] = mapped_column(String(255), nullable=False)
    poster_url: Mapped[str | None] = mapped_column(String(2048), nullable=True)
