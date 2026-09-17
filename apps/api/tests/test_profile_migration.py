"""Migration check: per-user viewing data lands on each user's default profile.

Runs alembic on the pre-profiles schema, seeds two users with one row in each
per-user table plus a refresh token, then upgrades to head and asserts the data
was re-keyed to the default profile of its owner without cross-user leakage.
"""

import sqlite3
import uuid
from pathlib import Path

from app.core.config import settings

APP_DIR = Path(__file__).resolve().parents[1]
PREVIOUS_REVISION = "d2b8e0f4c317"
TABLES = ("favorites", "watchlist", "ratings", "watch_progress")

USER_A = uuid.uuid4().hex
USER_B = uuid.uuid4().hex


def _alembic_config(tmp_path, monkeypatch, name: str):
    from alembic.config import Config

    db_path = tmp_path / name
    monkeypatch.setattr(settings, "database_url", f"sqlite+aiosqlite:///{db_path}")
    cfg = Config(str(APP_DIR / "alembic.ini"))
    cfg.set_main_option("script_location", str(APP_DIR / "app" / "alembic"))
    return cfg, db_path


def _seed(con: sqlite3.Connection) -> None:
    con.executemany(
        "INSERT INTO users"
        " (id, email, username, hashed_password, display_name, is_active,"
        "  created_at, updated_at)"
        " VALUES (?, ?, ?, 'x', ?, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)",
        [
            (USER_A, "a@example.com", "usera", "A"),
            (USER_B, "b@example.com", "userb", "B"),
        ],
    )
    for user_id, prefix in ((USER_A, "a"), (USER_B, "b")):
        movie = f"{prefix}-movie"
        con.execute(
            "INSERT INTO favorites"
            " (id, user_id, movie_slug, movie_name, created_at, updated_at)"
            " VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)",
            (uuid.uuid4().hex, user_id, movie, movie),
        )
        con.execute(
            "INSERT INTO watchlist"
            " (id, user_id, movie_slug, movie_name, created_at, updated_at)"
            " VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)",
            (uuid.uuid4().hex, user_id, movie, movie),
        )
        con.execute(
            "INSERT INTO ratings"
            " (id, user_id, movie_slug, stars, created_at, updated_at)"
            " VALUES (?, ?, ?, 8, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)",
            (uuid.uuid4().hex, user_id, movie),
        )
        con.execute(
            "INSERT INTO watch_progress"
            " (id, user_id, movie_slug, movie_name, episode_slug, episode_name,"
            "  position_seconds, updated_at)"
            " VALUES (?, ?, ?, ?, ?, ?, 0, CURRENT_TIMESTAMP)",
            (uuid.uuid4().hex, user_id, movie, movie, f"{prefix}-ep", "Ep 1"),
        )
    con.execute(
        "INSERT INTO refresh_tokens (id, user_id, jti, expires_at, family_id)"
        " VALUES (?, ?, ?, '2099-01-01 00:00:00', ?)",
        (uuid.uuid4().hex, USER_A, uuid.uuid4().hex, uuid.uuid4().hex),
    )
    con.commit()


def test_backfill_moves_user_data_into_default_profile(tmp_path, monkeypatch):
    from alembic import command

    cfg, db_path = _alembic_config(
        tmp_path, monkeypatch, "profile_migration.db"
    )
    command.upgrade(cfg, PREVIOUS_REVISION)

    con = sqlite3.connect(db_path)
    try:
        _seed(con)
    finally:
        con.close()

    command.upgrade(cfg, "head")

    con = sqlite3.connect(db_path)
    con.row_factory = sqlite3.Row
    try:
        profiles = con.execute(
            "SELECT id, user_id, name, avatar, position, is_default FROM profiles"
        ).fetchall()
        assert len(profiles) == 2
        by_user = {p["user_id"]: p for p in profiles}
        assert set(by_user) == {USER_A, USER_B}
        for profile in profiles:
            assert profile["name"] == "Mặc định"
            assert profile["avatar"] == "popcorn"
            assert profile["position"] == 0
            assert profile["is_default"] == 1

        default_a = by_user[USER_A]["id"]
        default_b = by_user[USER_B]["id"]

        for table in TABLES:
            rows = con.execute(
                f"SELECT movie_slug, profile_id FROM {table}"
            ).fetchall()
            assert len(rows) == 2
            for row in rows:
                expected = (
                    default_a if row["movie_slug"].startswith("a-") else default_b
                )
                assert row["profile_id"] == expected

        for table in TABLES:
            columns = {
                c["name"]: c
                for c in con.execute(f"PRAGMA table_info({table})").fetchall()
            }
            assert "profile_id" in columns
            assert columns["profile_id"]["notnull"] == 1
            assert "user_id" not in columns

        token = con.execute(
            "SELECT profile_id FROM refresh_tokens"
        ).fetchone()
        assert token["profile_id"] is None

        index_names = {
            row["name"]
            for row in con.execute("PRAGMA index_list(profiles)").fetchall()
        }
        assert "uq_profile_user_default" in index_names
    finally:
        con.close()
