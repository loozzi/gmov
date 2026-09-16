"""Comment persistence operations (one reply level)."""

import uuid

from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import AppException
from app.db.models.comment import Comment
from app.db.models.comment_report import CommentReport
from app.db.models.user import User, UserRole
from app.schemas.library import CommentAdd, CommentOut, CommentUser, ReplyOut


async def create(
    db: AsyncSession, user_id: uuid.UUID, data: CommentAdd
) -> Comment:
    body = data.body.strip()
    if not body or len(body) > 2000:
        raise AppException("Invalid comment body", "VALIDATION_ERROR", 422)
    if data.parent_id is not None:
        parent = (
            await db.execute(
                select(Comment).where(Comment.id == data.parent_id)
            )
        ).scalar_one_or_none()
        if (
            parent is None
            or parent.movie_slug != data.movie_slug
            or parent.parent_id is not None
        ):
            raise AppException("Invalid parent comment", "VALIDATION_ERROR", 422)
    row = Comment(
        user_id=user_id,
        movie_slug=data.movie_slug,
        parent_id=data.parent_id,
        body=body,
    )
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return row


async def list_paginated(
    db: AsyncSession,
    movie_slug: str,
    page: int,
    per_page: int,
    viewer: User | None = None,
) -> tuple[list[CommentOut], int]:
    mask_hidden = viewer is None or viewer.role == UserRole.USER
    total = (
        await db.execute(
            select(func.count())
            .select_from(Comment)
            .where(Comment.movie_slug == movie_slug, Comment.parent_id.is_(None))
        )
    ).scalar_one()
    stmt = (
        select(Comment)
        .where(Comment.movie_slug == movie_slug, Comment.parent_id.is_(None))
        .order_by(Comment.created_at.desc(), Comment.id.desc())
        .offset((page - 1) * per_page)
        .limit(per_page)
    )
    tops = list((await db.execute(stmt)).scalars().all())
    if not tops:
        return [], int(total)

    top_ids = [t.id for t in tops]
    replies_stmt = (
        select(Comment)
        .where(Comment.parent_id.in_(top_ids))
        .order_by(Comment.created_at.asc(), Comment.id.asc())
    )
    replies = list((await db.execute(replies_stmt)).scalars().all())

    user_ids = {t.user_id for t in tops} | {r.user_id for r in replies}
    users_stmt = select(User).where(User.id.in_(user_ids))
    users = (await db.execute(users_stmt)).scalars().all()
    user_map: dict[uuid.UUID, CommentUser] = {
        u.id: CommentUser(username=u.username, display_name=u.display_name)
        for u in users
    }

    reported_ids: set[uuid.UUID] = set()
    if viewer is not None:
        visible_ids = top_ids + [r.id for r in replies]
        reported_ids = set(
            (
                await db.execute(
                    select(CommentReport.comment_id).where(
                        CommentReport.reporter_id == viewer.id,
                        CommentReport.comment_id.in_(visible_ids),
                    )
                )
            ).scalars().all()
        )

    grouped: dict[uuid.UUID, list[ReplyOut]] = {tid: [] for tid in top_ids}
    for r in replies:
        grouped.setdefault(r.parent_id, []).append(
            ReplyOut(
                id=r.id,
                user=user_map[r.user_id],
                body=None if (mask_hidden and r.is_hidden) else r.body,
                is_hidden=r.is_hidden,
                reported=r.id in reported_ids,
                created_at=r.created_at,
            )
        )

    items = [
        CommentOut(
            id=t.id,
            movie_slug=t.movie_slug,
            user=user_map[t.user_id],
            body=None if (mask_hidden and t.is_hidden) else t.body,
            is_hidden=t.is_hidden,
            reported=t.id in reported_ids,
            created_at=t.created_at,
            replies=grouped.get(t.id, []),
            reply_count=len(grouped.get(t.id, [])),
        )
        for t in tops
    ]
    return items, int(total)


async def delete_owned(
    db: AsyncSession, user_id: uuid.UUID, comment_id: uuid.UUID
) -> None:
    row = (
        await db.execute(select(Comment).where(Comment.id == comment_id))
    ).scalar_one_or_none()
    if row is None or row.user_id != user_id:
        raise AppException("Comment not found", "COMMENT_NOT_FOUND", 404)

    # Collect whole subtree (BFS) so SQLite tests pass even without FK enforcement;
    # Postgres additionally cascades via FK ON DELETE CASCADE.
    to_delete: list[uuid.UUID] = [row.id]
    queue: list[uuid.UUID] = [row.id]
    while queue:
        child_ids = list(
            (
                await db.execute(
                    select(Comment.id).where(Comment.parent_id.in_(queue))
                )
            ).scalars().all()
        )
        if not child_ids:
            break
        to_delete.extend(child_ids)
        queue = child_ids

    await db.execute(delete(Comment).where(Comment.id.in_(to_delete)))
    await db.commit()
