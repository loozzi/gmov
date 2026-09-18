"""Explicit onboarding preferences for one profile."""

import uuid
from datetime import datetime

from sqlalchemy import JSON, Boolean, DateTime, ForeignKey, Uuid, false, text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin


class ProfilePreference(Base, TimestampMixin):
    __tablename__ = "profile_preferences"

    profile_id: Mapped[uuid.UUID] = mapped_column(
        Uuid,
        ForeignKey("profiles.id", ondelete="CASCADE"),
        primary_key=True,
        nullable=False,
    )
    genres: Mapped[dict[str, float]] = mapped_column(
        JSON, nullable=False, default=dict, server_default=text("'{}'")
    )
    countries: Mapped[dict[str, float]] = mapped_column(
        JSON, nullable=False, default=dict, server_default=text("'{}'")
    )
    excluded_genres: Mapped[list[str]] = mapped_column(
        JSON, nullable=False, default=list, server_default=text("'[]'")
    )
    onboarding_completed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True, default=None
    )
    skipped: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default=false()
    )
