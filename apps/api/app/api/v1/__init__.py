"""API v1 router aggregation."""

from fastapi import APIRouter

from app.api.v1.routers import (
    admin,
    auth,
    collections,
    movies,
    progress,
    reports,
    reviews,
    users,
)

api_router = APIRouter(prefix="/api/v1")
api_router.include_router(auth.router)
api_router.include_router(users.router)
api_router.include_router(movies.router)
api_router.include_router(movies.comments_router)
api_router.include_router(progress.router)
api_router.include_router(collections.router)
api_router.include_router(reviews.router)
api_router.include_router(reports.router)
api_router.include_router(admin.router)
