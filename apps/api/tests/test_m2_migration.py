"""Migration check: M2 `profile_preferences` and `catalog_items`.

Runs alembic to the pre-M2 revision, seeds one user plus their default profile,
then upgrades to head and asserts both new tables carry the documented columns
and defaults, that a profile's preferences cascade away with the profile, that
catalog rows round-trip, and that downgrade drops both tables again.
"""

import sqlite3
import uuid
from pathlib import Path

import pytest

from app.core.config import settings

APP_DIR = Path(__file__).resolve().parents[1]
PREVIOUS_REVISION = "79d983c25d9a"
NEW_TABLES = ("profile_preferences", "catalog_items")

USER_ID = uuid.uuid4().hex
PROFILE_ID = uuid.uuid4().hex


def _alembic_config(tmp_path, monkeypatch, name: str):
    from alembic.config import Config

    db_path = tmp_path / name
    monkeypatch.setattr(settings, "database_url", f"sqlite+aiosqlite:///{db_path}")
    cfg = Config(str(APP_DIR / "alembic.ini"))
    cfg.set_main_option("script_location", str(APP_DIR / "app" / "alembic"))
    return cfg, db_path


def _seed_profile(con: sqlite3.Connection) -> None:
    con.execute(
        "INSERT INTO users"
        " (id, email, username, hashed_password, display_name, is_active,"
        "  created_at, updated_at)"
        " VALUES (?, ?, ?, 'x', ?, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)",
        (USER_ID, "m2@example.com", "m2user", "M2"),
    )
    con.execute(
        "INSERT INTO profiles"
        " (id, user_id, name, avatar, position, is_default, created_at,"
        "  updated_at)"
        " VALUES (?, ?, 'Mặc định', 'popcorn', 0, 1, CURRENT_TIMESTAMP,"
        "  CURRENT_TIMESTAMP)",
        (PROFILE_ID, USER_ID),
    )
    con.commit()


def _upgraded_to_head(tmp_path, monkeypatch, name: str):
    from alembic import command

    cfg, db_path = _alembic_config(tmp_path, monkeypatch, name)
    command.upgrade(cfg, PREVIOUS_REVISION)
    con = sqlite3.connect(db_path)
    try:
        _seed_profile(con)
    finally:
        con.close()
    command.upgrade(cfg, "head")
    return cfg, db_path


def _columns(con: sqlite3.Connection, table: str) -> dict:
    return {
        row["name"]: row
        for row in con.execute(f"PRAGMA table_info({table})").fetchall()
    }


def test_m2_tables_have_documented_shape(tmp_path, monkeypatch):
    cfg, db_path = _upgraded_to_head(tmp_path, monkeypatch, "m2_shape.db")

    con = sqlite3.connect(db_path)
    con.row_factory = sqlite3.Row
    try:
        tables = {
            row["name"]
            for row in con.execute(
                "SELECT name FROM sqlite_master WHERE type = 'table'"
            ).fetchall()
        }
        assert set(NEW_TABLES) <= tables

        prefs = _columns(con, "profile_preferences")
        assert prefs["profile_id"]["pk"] == 1
        assert prefs["profile_id"]["notnull"] == 1
        for nullable in ("genres", "countries", "skipped", "created_at", "updated_at"):
            assert prefs[nullable]["notnull"] == 1
        assert prefs["onboarding_completed_at"]["notnull"] == 0
        assert prefs["excluded_genres"]["notnull"] == 1

        feedback = _columns(con, "recommendation_feedback")
        assert feedback["id"]["pk"] == 1
        assert feedback["profile_id"]["notnull"] == 1
        assert feedback["movie_slug"]["notnull"] == 1
        assert feedback["kind"]["notnull"] == 1

        catalog = _columns(con, "catalog_items")
        assert catalog["slug"]["pk"] == 1
        for not_null in (
            "name",
            "poster_url",
            "thumb_url",
            "genres",
            "fetched_at",
            "source",
        ):
            assert catalog[not_null]["notnull"] == 1
        for nullable in (
            "original_name",
            "year",
            "country",
            "casts",
            "director",
        ):
            assert catalog[nullable]["notnull"] == 0
        assert "kind" not in catalog

        con.execute(
            "INSERT INTO profile_preferences (profile_id) VALUES (?)", (PROFILE_ID,)
        )
        row = con.execute(
            "SELECT genres, countries, excluded_genres, skipped, typeof(skipped)"
            " FROM profile_preferences WHERE profile_id = ?",
            (PROFILE_ID,),
        ).fetchone()
        assert row["genres"] == "{}"
        assert row["countries"] == "{}"
        assert row["excluded_genres"] == "[]"
        assert row["skipped"] in (0, False), row["skipped"]

        con.execute(
            "INSERT INTO recommendation_feedback (id, profile_id, movie_slug, kind)"
            " VALUES ('fb-1', ?, 'phim-a', 'interested')",
            (PROFILE_ID,),
        )
        con.commit()
        with pytest.raises(sqlite3.IntegrityError):
            con.execute(
                "INSERT INTO recommendation_feedback"
                " (id, profile_id, movie_slug, kind)"
                " VALUES ('fb-2', ?, 'phim-a', 'not_interested')",
                (PROFILE_ID,),
            )
        con.rollback()
    finally:
        con.close()

    assert cfg is not None


def test_catalog_items_accepts_documented_row(tmp_path, monkeypatch):
    _, db_path = _upgraded_to_head(tmp_path, monkeypatch, "m2_catalog.db")

    con = sqlite3.connect(db_path)
    con.row_factory = sqlite3.Row
    try:
        con.execute(
            "INSERT INTO catalog_items"
            " (slug, name, original_name, poster_url, thumb_url, year, genres,"
            "  country, casts, director, fetched_at, source)"
            " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?)",
            (
                "phim-moi",
                "Phim Mới",
                "New Movie",
                "https://img/poster.jpg",
                "https://img/thumb.jpg",
                2026,
                '["hanh-dong"]',
                "viet-nam",
                "Diễn viên A",
                "Đạo diễn B",
                "latest",
            ),
        )
        con.commit()
        row = con.execute(
            "SELECT slug, name, original_name, year, genres, country, casts,"
            " director, source FROM catalog_items WHERE slug = 'phim-moi'"
        ).fetchone()
        assert row["name"] == "Phim Mới"
        assert row["original_name"] == "New Movie"
        assert row["year"] == 2026
        assert row["genres"] == '["hanh-dong"]'
        assert row["country"] == "viet-nam"
        assert row["casts"] == "Diễn viên A"
        assert row["director"] == "Đạo diễn B"
        assert row["source"] == "latest"

        con.execute(
            "INSERT INTO catalog_items"
            " (slug, name, poster_url, thumb_url, fetched_at, source)"
            " VALUES ('-empty', 'E', '', '', CURRENT_TIMESTAMP, 'search')"
        )
        empty = con.execute(
            "SELECT poster_url, thumb_url, genres, original_name, year, country,"
            " casts, director FROM catalog_items WHERE slug = '-empty'"
        ).fetchone()
        assert empty["poster_url"] == ""
        assert empty["thumb_url"] == ""
        assert empty["genres"] == "[]"
        assert empty["original_name"] is None
        assert empty["year"] is None
        assert empty["country"] is None
        assert empty["casts"] is None
        assert empty["director"] is None
    finally:
        con.close()


def test_profile_preferences_cascades_when_profile_deleted(tmp_path, monkeypatch):
    _, db_path = _upgraded_to_head(tmp_path, monkeypatch, "m2_cascade.db")

    con = sqlite3.connect(db_path)
    con.row_factory = sqlite3.Row
    try:
        con.execute("PRAGMA foreign_keys = ON")
        fks = {
            row["from"]: row
            for row in con.execute(
                "PRAGMA foreign_key_list(profile_preferences)"
            ).fetchall()
        }
        assert set(fks) == {"profile_id"}
        assert fks["profile_id"]["table"] == "profiles"
        assert fks["profile_id"]["on_delete"] == "CASCADE"

        con.execute(
            "INSERT INTO profile_preferences (profile_id) VALUES (?)", (PROFILE_ID,)
        )
        con.commit()
        assert (
            con.execute("SELECT COUNT(*) FROM profile_preferences").fetchone()[0] == 1
        )

        con.execute("DELETE FROM profiles WHERE id = ?", (PROFILE_ID,))
        con.commit()
        assert (
            con.execute("SELECT COUNT(*) FROM profile_preferences").fetchone()[0] == 0
        )
    finally:
        con.close()


def test_m2_revision_follows_profiles_migration(tmp_path, monkeypatch):
    """The M2 migration chains onto the profiles one.

    Later migrations (comments.has_spoiler, …) may sit on top of it, so this
    looks for the revision parented by the profiles migration instead of
    assuming M2 is the head.
    """
    from alembic.script import ScriptDirectory

    cfg, _ = _alembic_config(tmp_path, monkeypatch, "m2_revision.db")
    script = ScriptDirectory.from_config(cfg)
    children = [
        rev
        for rev in script.walk_revisions()
        if rev.down_revision == PREVIOUS_REVISION
    ]
    assert children, "no migration follows the profiles migration"
    assert any(rev.module.__name__.startswith("c46bc4737183") for rev in children)


def test_downgrade_drops_m2_tables(tmp_path, monkeypatch):
    from alembic import command

    cfg, db_path = _upgraded_to_head(tmp_path, monkeypatch, "m2_downgrade.db")

    command.downgrade(cfg, PREVIOUS_REVISION)

    con = sqlite3.connect(db_path)
    con.row_factory = sqlite3.Row
    try:
        tables = {
            row["name"]
            for row in con.execute(
                "SELECT name FROM sqlite_master WHERE type = 'table'"
            ).fetchall()
        }
        assert tables.isdisjoint(NEW_TABLES)
        assert "profiles" in tables
    finally:
        con.close()
