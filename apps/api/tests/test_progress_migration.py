"""Migration schema check: watch_progress carries the episode-position columns."""

from pathlib import Path

from sqlalchemy import create_engine, inspect

from app.core.config import settings

APP_DIR = Path(__file__).resolve().parents[1]


def test_migration_adds_nullable_episode_position(tmp_path, monkeypatch):
    from alembic import command
    from alembic.config import Config

    db_path = tmp_path / "progress_migration.db"
    monkeypatch.setattr(settings, "database_url", f"sqlite+aiosqlite:///{db_path}")
    cfg = Config(str(APP_DIR / "alembic.ini"))
    cfg.set_main_option("script_location", str(APP_DIR / "app" / "alembic"))

    command.upgrade(cfg, "head")

    engine = create_engine(f"sqlite:///{db_path}")
    try:
        cols = {c["name"]: c for c in inspect(engine).get_columns("watch_progress")}
    finally:
        engine.dispose()

    assert cols["episode_index"]["nullable"] is True
    assert cols["total_episodes"]["nullable"] is True
