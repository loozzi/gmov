"""Moderation schemas: comment reports, visibility and user bans."""

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.db.models.comment_report import ReportReason, ReportSource, ReportStatus


class ReportIn(BaseModel):
    comment_id: uuid.UUID
    reason: ReportReason
    note: str | None = Field(default=None, max_length=500)


class ReportCreated(BaseModel):
    id: uuid.UUID
    status: ReportStatus


class ReportStatusOut(BaseModel):
    reported: bool


class AdminCommentUser(BaseModel):
    """Comment author / reporter as seen by moderators.

    Unlike the public `CommentUser` this carries the id (so a moderator can act
    on the account) and the ban state (so the queue can render the toggle
    without a second request).
    """

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    username: str
    display_name: str
    banned_at: datetime | None = None


class ReportCommentInfo(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    body: str
    is_hidden: bool
    movie_slug: str
    user: AdminCommentUser
    created_at: datetime


class ReportItem(BaseModel):
    id: uuid.UUID
    reason: ReportReason
    note: str | None
    status: ReportStatus
    source: ReportSource
    created_at: datetime
    reporter: AdminCommentUser | None  # None for keyword (auto) reports
    comment: ReportCommentInfo


class PaginatedReports(BaseModel):
    items: list[ReportItem]
    page: int
    per_page: int
    total_items: int
    open_total: int


class CommentVisibilityOut(BaseModel):
    ok: bool = True
    is_hidden: bool


class BanIn(BaseModel):
    reason: str | None = Field(default=None, max_length=200)


class BannedUserOut(BaseModel):
    id: uuid.UUID
    username: str
    banned_at: datetime | None
    ban_reason: str | None
