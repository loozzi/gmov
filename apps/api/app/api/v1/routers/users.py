"""Current-user router: profile read/update."""

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_current_user
from app.db.models.user import User
from app.db.session import get_db
from app.schemas.user import UserOut, UserUpdate
from app.services import user_service

router = APIRouter(prefix="/users", tags=["users"])


@router.get("/me", response_model=UserOut)
async def read_me(current: User = Depends(get_current_user)) -> UserOut:
    return UserOut.model_validate(current)


@router.patch("/me", response_model=UserOut)
async def update_me(
    data: UserUpdate,
    current: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> UserOut:
    display_name = data.display_name.strip() if data.display_name else None
    if not display_name and data.avatar_url is None:
        return UserOut.model_validate(current)
    updated = await user_service.update_profile(
        db, current, display_name or None, data.avatar_url
    )
    return UserOut.model_validate(updated)
