"""Star ratings per profile per movie."""

import uuid

from sqlalchemy import ForeignKey, SmallInteger, String, UniqueConstraint, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin


class Rating(Base, TimestampMixin):
    __tablename__ = "ratings"
    __table_args__ = (
        UniqueConstraint("profile_id", "movie_slug", name="uq_rating_profile_movie"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    profile_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("profiles.id", ondelete="CASCADE"), index=True, nullable=False
    )
    movie_slug: Mapped[str] = mapped_column(String(255), index=True, nullable=False)
    stars: Mapped[int] = mapped_column(SmallInteger, nullable=False)
