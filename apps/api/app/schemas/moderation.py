"""Moderation schemas: comment reports and visibility."""

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.db.models.comment_report import ReportReason, ReportStatus
from app.schemas.library import CommentUser


class ReportIn(BaseModel):
    comment_id: uuid.UUID
    reason: ReportReason
    note: str | None = Field(default=None, max_length=500)


class ReportCreated(BaseModel):
    id: uuid.UUID
    status: ReportStatus


class ReportStatusOut(BaseModel):
    reported: bool


class ReportCommentInfo(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    body: str
    is_hidden: bool
    movie_slug: str
    user: CommentUser
    created_at: datetime


class ReportItem(BaseModel):
    id: uuid.UUID
    reason: ReportReason
    note: str | None
    status: ReportStatus
    created_at: datetime
    reporter: CommentUser
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
