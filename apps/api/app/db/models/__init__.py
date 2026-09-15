"""Database model exports (import here so Alembic sees all tables)."""

from app.db.models.favorite import Favorite  # noqa: F401
from app.db.models.refresh_token import RefreshToken  # noqa: F401
from app.db.models.user import User  # noqa: F401
from app.db.models.watch_progress import WatchProgress  # noqa: F401
