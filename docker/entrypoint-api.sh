#!/bin/sh
set -e

echo "[entrypoint] running database migrations..."
alembic upgrade head

echo "[entrypoint] starting API (workers=${UVICORN_WORKERS:-2})..."
exec "$@"
