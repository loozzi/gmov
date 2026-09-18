"""Per-profile thumbs feedback on recommended movies (taste signal)."""

import uuid

from sqlalchemy import ForeignKey, String, UniqueConstraint, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin

INTERESTED = "interested"
NOT_INTERESTED = "not_interested"
KINDS = frozenset({INTERESTED, NOT_INTERESTED})


class RecommendationFeedback(Base, TimestampMixin):
    __tablename__ = "recommendation_feedback"
    __table_args__ = (
        UniqueConstraint(
            "profile_id",
            "movie_slug",
            name="uq_recommendation_feedback_profile_movie",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    profile_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("profiles.id", ondelete="CASCADE"), index=True, nullable=False
    )
    movie_slug: Mapped[str] = mapped_column(String(255), index=True, nullable=False)
    kind: Mapped[str] = mapped_column(String(32), nullable=False)
