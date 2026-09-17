"""Cached catalog metadata gathered from upstream listings."""

from datetime import datetime

from sqlalchemy import JSON, DateTime, Integer, String, Text, text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class CatalogItem(Base):
    __tablename__ = "catalog_items"

    slug: Mapped[str] = mapped_column(String(255), primary_key=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    original_name: Mapped[str | None] = mapped_column(
        String(255), nullable=True, default=None
    )
    poster_url: Mapped[str] = mapped_column(Text, nullable=False, default="")
    thumb_url: Mapped[str] = mapped_column(Text, nullable=False, default="")
    year: Mapped[int | None] = mapped_column(
        Integer, nullable=True, index=True, default=None
    )
    genres: Mapped[list[str]] = mapped_column(
        JSON, nullable=False, default=list, server_default=text("'[]'")
    )
    country: Mapped[str | None] = mapped_column(String(64), nullable=True, default=None)
    casts: Mapped[str | None] = mapped_column(Text, nullable=True, default=None)
    director: Mapped[str | None] = mapped_column(Text, nullable=True, default=None)
    fetched_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    source: Mapped[str] = mapped_column(String(32), nullable=False)
