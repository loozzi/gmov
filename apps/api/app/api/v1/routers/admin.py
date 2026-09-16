"""Moderation admin router: report queue + comment visibility toggles."""

import uuid

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import require_role
from app.db.models.comment_report import ReportStatus
from app.db.models.user import User, UserRole
from app.db.session import get_db
from app.schemas.moderation import CommentVisibilityOut, PaginatedReports
from app.services import report_service

router = APIRouter(prefix="/admin", tags=["admin"])

require_moderator = require_role(UserRole.MODERATOR, UserRole.ADMIN)


@router.get("/reports", response_model=PaginatedReports)
async def list_reports(
    status: ReportStatus | None = Query(default=None),
    page: int = Query(default=1, ge=1),
    per_page: int = Query(default=20, ge=1, le=100),
    actor: User = Depends(require_moderator),
    db: AsyncSession = Depends(get_db),
) -> PaginatedReports:
    items, total, open_total = await report_service.list_reports(
        db, status, page, per_page
    )
    return PaginatedReports(
        items=items,
        page=page,
        per_page=per_page,
        total_items=total,
        open_total=open_total,
    )


@router.post(
    "/comments/{comment_id}/hide", response_model=CommentVisibilityOut
)
async def hide_comment(
    comment_id: uuid.UUID,
    actor: User = Depends(require_moderator),
    db: AsyncSession = Depends(get_db),
) -> CommentVisibilityOut:
    await report_service.hide_comment(db, actor, comment_id)
    return CommentVisibilityOut(ok=True, is_hidden=True)


@router.post(
    "/comments/{comment_id}/unhide", response_model=CommentVisibilityOut
)
async def unhide_comment(
    comment_id: uuid.UUID,
    actor: User = Depends(require_moderator),
    db: AsyncSession = Depends(get_db),
) -> CommentVisibilityOut:
    await report_service.unhide_comment(db, actor, comment_id)
    return CommentVisibilityOut(ok=True, is_hidden=False)


@router.post("/reports/{report_id}/dismiss")
async def dismiss_report(
    report_id: uuid.UUID,
    actor: User = Depends(require_moderator),
    db: AsyncSession = Depends(get_db),
) -> dict[str, bool]:
    await report_service.dismiss(db, actor, report_id)
    return {"ok": True}
