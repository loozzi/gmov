"""Comment report router: file reports and check report status."""

import uuid

from fastapi import APIRouter, Depends, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_current_user
from app.core.ratelimit import check_rate_limit
from app.db.models.user import User
from app.db.session import get_db
from app.schemas.moderation import ReportCreated, ReportIn, ReportStatusOut
from app.services import report_service

router = APIRouter(prefix="/me", tags=["reports"])

REPORT_RATE_LIMIT = report_service.RATE_LIMIT
REPORT_RATE_WINDOW = report_service.RATE_WINDOW


async def rate_limited_report_user(
    current: User = Depends(get_current_user),
) -> User:
    await check_rate_limit(
        f"ratelimit:reports:{current.id}",
        REPORT_RATE_LIMIT,
        REPORT_RATE_WINDOW,
    )
    return current


@router.post("/reports", response_model=ReportCreated)
async def create_report(
    data: ReportIn,
    response: Response,
    current: User = Depends(rate_limited_report_user),
    db: AsyncSession = Depends(get_db),
) -> ReportCreated:
    row, created = await report_service.create(db, current.id, data)
    response.status_code = status.HTTP_201_CREATED if created else status.HTTP_200_OK
    return ReportCreated(id=row.id, status=row.status)


@router.get("/reports/{comment_id}/status", response_model=ReportStatusOut)
async def report_status(
    comment_id: uuid.UUID,
    current: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> ReportStatusOut:
    reported = await report_service.status(db, current.id, comment_id)
    return ReportStatusOut(reported=reported)
