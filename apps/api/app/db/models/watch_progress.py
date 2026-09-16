"""Per-episode watch progress (also serves as watch history)."""

import uuid
from datetime import datetime

from sqlalchemy import (
    DateTime,
    ForeignKey,
    Integer,
    String,
    UniqueConstraint,
    Uuid,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class WatchProgress(Base):
    __tablename__ = "watch_progress"
    __table_args__ = (
        UniqueConstraint(
            "user_id", "movie_slug", "episode_slug",
            name="uq_progress_user_movie_episode",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    movie_slug: Mapped[str] = mapped_column(String(255), index=True, nullable=False)
    movie_name: Mapped[str] = mapped_column(String(255), nullable=False)
    poster_url: Mapped[str | None] = mapped_column(String(2048), nullable=True)
    episode_slug: Mapped[str] = mapped_column(String(255), nullable=False)
    episode_name: Mapped[str] = mapped_column(String(255), nullable=False)
    server_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    episode_index: Mapped[int | None] = mapped_column(Integer, nullable=True)
    total_episodes: Mapped[int | None] = mapped_column(Integer, nullable=True)
    position_seconds: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    duration_seconds: Mapped[int | None] = mapped_column(Integer, nullable=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )
