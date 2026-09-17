"""Viewing profiles inside one account."""

import uuid

from sqlalchemy import (
    Boolean,
    ForeignKey,
    Index,
    SmallInteger,
    String,
    UniqueConstraint,
    Uuid,
    false,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin

AVATAR_KEYS: tuple[str, ...] = (
    "popcorn",
    "rocket",
    "cat",
    "panda",
    "robot",
    "ghost",
    "alien",
    "ninja",
    "pirate",
    "dino",
    "star",
    "clover",
)
FALLBACK_AVATAR = "popcorn"


class Profile(Base, TimestampMixin):
    __tablename__ = "profiles"
    __table_args__ = (
        UniqueConstraint("user_id", "name", name="uq_profile_user_name"),
        UniqueConstraint("user_id", "position", name="uq_profile_user_position"),
        Index(
            "uq_profile_user_default",
            "user_id",
            unique=True,
            postgresql_where=text("is_default"),
            sqlite_where=text("is_default = 1"),
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    name: Mapped[str] = mapped_column(String(32), nullable=False)
    avatar: Mapped[str] = mapped_column(
        String(32),
        nullable=False,
        default=FALLBACK_AVATAR,
        server_default=FALLBACK_AVATAR,
    )
    position: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    is_default: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default=false()
    )
    pin_hash: Mapped[str | None] = mapped_column(
        String(255), nullable=True, default=None
    )
