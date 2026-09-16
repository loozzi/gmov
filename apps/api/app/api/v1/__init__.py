"""API v1 router aggregation."""

from fastapi import APIRouter

from app.api.v1.routers import auth, me, movies, users

api_router = APIRouter(prefix="/api/v1")
api_router.include_router(auth.router)
api_router.include_router(users.router)
api_router.include_router(movies.router)
api_router.include_router(movies.comments_router)
api_router.include_router(me.router)
