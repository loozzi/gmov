"""Unified error model: every error responds {"detail": ..., "code": ...}."""

from fastapi import FastAPI, Request, status
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException


class AppException(Exception):
    def __init__(
        self,
        detail: str,
        code: str,
        status_code: int = status.HTTP_400_BAD_REQUEST,
    ) -> None:
        super().__init__(detail)
        self.detail = detail
        self.code = code
        self.status_code = status_code


def _error_response(
    detail: object, code: str, status_code: int
) -> JSONResponse:
    return JSONResponse(
        status_code=status_code, content={"detail": detail, "code": code}
    )


async def _app_exception_handler(_: Request, exc: AppException) -> JSONResponse:
    return _error_response(exc.detail, exc.code, exc.status_code)


async def _http_exception_handler(
    _: Request, exc: StarletteHTTPException
) -> JSONResponse:
    code = "UNAUTHORIZED" if exc.status_code == 401 else "HTTP_ERROR"
    return _error_response(exc.detail, code, exc.status_code)


async def _validation_handler(
    _: Request, exc: RequestValidationError
) -> JSONResponse:
    return _error_response(
        jsonable_encoder(exc.errors()), "VALIDATION_ERROR", 422
    )


async def _unhandled_handler(_: Request, __: Exception) -> JSONResponse:
    return _error_response("Internal server error", "INTERNAL_ERROR", 500)


def register_exception_handlers(app: FastAPI) -> None:
    app.add_exception_handler(AppException, _app_exception_handler)  # type: ignore[arg-type]
    app.add_exception_handler(StarletteHTTPException, _http_exception_handler)  # type: ignore[arg-type]
    app.add_exception_handler(RequestValidationError, _validation_handler)  # type: ignore[arg-type]
    app.add_exception_handler(Exception, _unhandled_handler)
