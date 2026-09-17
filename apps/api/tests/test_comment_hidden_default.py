"""Schema check: comments.is_hidden must default to a real boolean.

`server_default="false"` (a plain string) is rendered as `DEFAULT 'false'`, and
SQLite stores the *text* `'false'` — which `bool()` reads as True. Any insert
that relies on the DB default (raw SQL, bulk, a future code path) would then
create an already-hidden comment. RefreshToken.compromised already uses
`sa.false()`; this keeps comments consistent.
"""

import sqlite3
from pathlib import Path

from app.core.config import settings

APP_DIR = Path(__file__).resolve().parents[1]


def _upgraded_sqlite(tmp_path, monkeypatch) -> sqlite3.Connection:
    from alembic import command
    from alembic.config import Config

    db_path = tmp_path / "comment_default.db"
    monkeypatch.setattr(settings, "database_url", f"sqlite+aiosqlite:///{db_path}")
    cfg = Config(str(APP_DIR / "alembic.ini"))
    cfg.set_main_option("script_location", str(APP_DIR / "app" / "alembic"))
    command.upgrade(cfg, "head")
    return sqlite3.connect(db_path)


def test_comments_is_hidden_default_is_falsy(tmp_path, monkeypatch):
    con = _upgraded_sqlite(tmp_path, monkeypatch)
    try:
        con.execute(
            "INSERT INTO comments"
            " (id, user_id, movie_slug, body, created_at, updated_at)"
            " VALUES ('1', '2', 'x', 'body', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"
        )
        value, kind = con.execute(
            "SELECT is_hidden, typeof(is_hidden) FROM comments"
        ).fetchone()
    finally:
        con.close()

    assert not bool(value), f"is_hidden default came back as {value!r} ({kind})"
