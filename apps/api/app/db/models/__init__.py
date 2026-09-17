"""Database model exports (import here so Alembic sees all tables)."""

from app.db.models.catalog_item import CatalogItem  # noqa: F401
from app.db.models.comment import Comment  # noqa: F401
from app.db.models.comment_report import CommentReport  # noqa: F401
from app.db.models.favorite import Favorite  # noqa: F401
from app.db.models.profile import Profile  # noqa: F401
from app.db.models.profile_preference import ProfilePreference  # noqa: F401
from app.db.models.rating import Rating  # noqa: F401
from app.db.models.refresh_token import RefreshToken  # noqa: F401
from app.db.models.user import User  # noqa: F401
from app.db.models.watch_progress import WatchProgress  # noqa: F401
from app.db.models.watchlist import Watchlist  # noqa: F401
