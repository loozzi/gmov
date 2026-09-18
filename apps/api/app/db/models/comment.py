"""Threaded comments per movie (one reply level)."""

import uuid

from sqlalchemy import Boolean, ForeignKey, String, Text, Uuid, false
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin


class Comment(Base, TimestampMixin):
    __tablename__ = "comments"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    movie_slug: Mapped[str] = mapped_column(String(255), index=True, nullable=False)
    parent_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid,
        ForeignKey("comments.id", ondelete="CASCADE"),
        index=True,
        nullable=True,
        default=None,
    )
    body: Mapped[str] = mapped_column(Text, nullable=False)
    is_hidden: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default=false(), nullable=False
    )
    # Author-marked (or moderator-marked) spoiler: readers get a veil they can
    # lift locally. Deliberately separate from `is_hidden` (moderation) so a
    # spoiler is not confused with a removed comment.
    has_spoiler: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default=false(), nullable=False
    )
