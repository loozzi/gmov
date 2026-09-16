"""Comment report persistence and moderation queue operations."""

import uuid
from datetime import UTC, datetime

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from app.core.config import settings
from app.core.exceptions import AppException
from app.db.models.comment import Comment
from app.db.models.comment_report import CommentReport, ReportStatus
from app.db.models.user import User
from app.schemas.library import CommentUser
from app.schemas.moderation import (
    ReportCommentInfo,
    ReportIn,
    ReportItem,
)

RATE_LIMIT = 10
RATE_WINDOW = 60


async def _get_comment(db: AsyncSession, comment_id: uuid.UUID) -> Comment:
    comment = (
        await db.execute(select(Comment).where(Comment.id == comment_id))
    ).scalar_one_or_none()
    if comment is None:
        raise AppException("Comment not found", "COMMENT_NOT_FOUND", 404)
    return comment


async def create(
    db: AsyncSession, user_id: uuid.UUID, data: ReportIn
) -> tuple[CommentReport, bool]:
    try:
        comment = await _get_comment(db, data.comment_id)
        if comment.user_id == user_id:
            raise AppException(
                "Cannot report your own comment", "CANNOT_REPORT_OWN", 422
            )
        existing = (
            await db.execute(
                select(CommentReport).where(
                    CommentReport.comment_id == data.comment_id,
                    CommentReport.reporter_id == user_id,
                )
            )
        ).scalar_one_or_none()
        if existing is not None:
            return existing, False

        if comment.is_hidden:
            raise AppException("Comment is hidden", "COMMENT_HIDDEN", 409)

        comment = (
            await db.execute(
                select(Comment)
                .where(Comment.id == data.comment_id)
                .with_for_update()
            )
        ).scalar_one()

        row = CommentReport(
            comment_id=data.comment_id,
            reporter_id=user_id,
            reason=data.reason,
            note=data.note,
        )
        db.add(row)
        try:
            await db.flush()
        except IntegrityError:
            await db.rollback()
            existing = (
                await db.execute(
                    select(CommentReport).where(
                        CommentReport.comment_id == data.comment_id,
                        CommentReport.reporter_id == user_id,
                    )
                )
            ).scalar_one_or_none()
            if existing is None:
                raise
            return existing, False

        open_count = (
            await db.execute(
                select(func.count(func.distinct(CommentReport.reporter_id)))
                .select_from(CommentReport)
                .where(
                    CommentReport.comment_id == data.comment_id,
                    CommentReport.status == ReportStatus.OPEN,
                )
            )
        ).scalar_one()
        if open_count >= settings.comment_report_hide_threshold:
            comment.is_hidden = True

        await db.commit()
        await db.refresh(row)
        return row, True
    except Exception:
        await db.rollback()
        raise


async def status(
    db: AsyncSession, user_id: uuid.UUID, comment_id: uuid.UUID
) -> bool:
    stmt = select(CommentReport.id).where(
        CommentReport.comment_id == comment_id,
        CommentReport.reporter_id == user_id,
    )
    return (await db.execute(stmt)).scalar_one_or_none() is not None


async def list_reports(
    db: AsyncSession,
    status: ReportStatus | None,
    page: int,
    per_page: int,
) -> tuple[list[ReportItem], int, int]:
    conditions = []
    if status is not None:
        conditions.append(CommentReport.status == status)

    total = (
        await db.execute(
            select(func.count())
            .select_from(CommentReport)
            .where(*conditions)
        )
    ).scalar_one()
    open_total = (
        await db.execute(
            select(func.count())
            .select_from(CommentReport)
            .where(CommentReport.status == ReportStatus.OPEN)
        )
    ).scalar_one()

    reporter = aliased(User)
    author = aliased(User)
    stmt = (
        select(CommentReport, reporter, Comment, author)
        .join(reporter, reporter.id == CommentReport.reporter_id)
        .join(Comment, Comment.id == CommentReport.comment_id)
        .join(author, author.id == Comment.user_id)
        .where(*conditions)
        .order_by(CommentReport.created_at.desc(), CommentReport.id.desc())
        .offset((page - 1) * per_page)
        .limit(per_page)
    )
    rows = (await db.execute(stmt)).all()
    items = [
        ReportItem(
            id=report.id,
            reason=report.reason,
            note=report.note,
            status=report.status,
            created_at=report.created_at,
            reporter=CommentUser(
                username=reporter.username, display_name=reporter.display_name
            ),
            comment=ReportCommentInfo(
                id=comment.id,
                body=comment.body,
                is_hidden=comment.is_hidden,
                movie_slug=comment.movie_slug,
                user=CommentUser(
                    username=author.username, display_name=author.display_name
                ),
                created_at=comment.created_at,
            ),
        )
        for report, reporter, comment, author in rows
    ]
    return items, int(total), int(open_total)


async def hide_comment(
    db: AsyncSession, actor: User, comment_id: uuid.UUID
) -> None:
    try:
        comment = await _get_comment(db, comment_id)
        comment.is_hidden = True
        now = datetime.now(UTC)
        reports = (
            await db.execute(
                select(CommentReport).where(
                    CommentReport.comment_id == comment_id,
                    CommentReport.status == ReportStatus.OPEN,
                )
            )
        ).scalars().all()
        for report in reports:
            report.status = ReportStatus.RESOLVED
            report.resolved_by = actor.id
            report.resolved_at = now
        await db.commit()
    except Exception:
        await db.rollback()
        raise


async def unhide_comment(
    db: AsyncSession, actor: User, comment_id: uuid.UUID
) -> None:
    try:
        comment = await _get_comment(db, comment_id)
        comment.is_hidden = False
        await db.commit()
    except Exception:
        await db.rollback()
        raise


async def dismiss(
    db: AsyncSession, actor: User, report_id: uuid.UUID
) -> None:
    try:
        report = (
            await db.execute(
                select(CommentReport).where(CommentReport.id == report_id)
            )
        ).scalar_one_or_none()
        if report is None:
            raise AppException("Report not found", "REPORT_NOT_FOUND", 404)
        if report.status == ReportStatus.OPEN:
            report.status = ReportStatus.DISMISSED
            report.resolved_by = actor.id
            report.resolved_at = datetime.now(UTC)
        await db.commit()
    except Exception:
        await db.rollback()
        raise
