"""Reports filed by users against comments (moderation queue)."""

import enum
import uuid
from datetime import datetime

from sqlalchemy import DateTime, Enum, ForeignKey, Text, UniqueConstraint, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin


class ReportReason(str, enum.Enum):
    SPAM = "spam"
    HARASSMENT = "harassment"
    SPOILER = "spoiler"
    OTHER = "other"


class ReportStatus(str, enum.Enum):
    OPEN = "open"
    RESOLVED = "resolved"
    DISMISSED = "dismissed"


class ReportSource(str, enum.Enum):
    """Who opened the report: a user, or the keyword filter on comment create."""

    USER = "user"
    AUTO = "auto"


class CommentReport(Base, TimestampMixin):
    __tablename__ = "comment_reports"
    __table_args__ = (
        UniqueConstraint(
            "comment_id",
            "reporter_id",
            name="uq_comment_reports_comment_reporter",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    comment_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("comments.id", ondelete="CASCADE"), index=True, nullable=False
    )
    # NULL for ReportSource.AUTO rows: the keyword filter is not a user.
    reporter_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=True
    )
    source: Mapped[ReportSource] = mapped_column(
        Enum(
            ReportSource,
            native_enum=False,
            length=10,
            validate_strings=True,
            values_callable=lambda e: [m.value for m in e],
        ),
        default=ReportSource.USER,
        server_default=ReportSource.USER.value,
        nullable=False,
    )
    reason: Mapped[ReportReason] = mapped_column(
        Enum(
            ReportReason,
            native_enum=False,
            length=20,
            validate_strings=True,
            values_callable=lambda e: [m.value for m in e],
        ),
        nullable=False,
    )
    note: Mapped[str | None] = mapped_column(Text, nullable=True, default=None)
    status: Mapped[ReportStatus] = mapped_column(
        Enum(
            ReportStatus,
            native_enum=False,
            length=20,
            validate_strings=True,
            values_callable=lambda e: [m.value for m in e],
        ),
        default=ReportStatus.OPEN,
        server_default=ReportStatus.OPEN.value,
        index=True,
        nullable=False,
    )
    resolved_by: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, default=None
    )
    resolved_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True, default=None
    )
