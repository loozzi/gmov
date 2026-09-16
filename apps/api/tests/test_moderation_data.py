"""Data-layer tests for comment moderation: models, migration, schemas, CLI."""

import importlib.util
import re
import uuid
from datetime import UTC, datetime
from pathlib import Path
from types import SimpleNamespace

import pytest
import pytest_asyncio
from pydantic import ValidationError
from sqlalchemy import (
    CheckConstraint,
    UniqueConstraint,
    create_engine,
    inspect,
    select,
    text,
)
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.orm import Session

from app.core.config import Settings, settings
from app.db.base import Base
from app.db.models.comment import Comment
from app.db.models.comment_report import (
    CommentReport,
    ReportReason,
    ReportStatus,
)
from app.db.models.user import User, UserRole
from app.schemas.library import CommentOut, CommentUser
from app.schemas.moderation import ReportIn

APP_DIR = Path(__file__).resolve().parents[1]

_MODERATION_MIGRATION = (
    APP_DIR
    / "app"
    / "alembic"
    / "versions"
    / "b7c1d9e2f3a4_comment_moderation.py"
)
_spec = importlib.util.spec_from_file_location(
    "comment_moderation_migration", _MODERATION_MIGRATION
)
assert _spec is not None and _spec.loader is not None
_migration = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_migration)
PREVIOUS_HEAD = _migration.down_revision
_MIGRATION_SOURCE = _MODERATION_MIGRATION.read_text()


@pytest_asyncio.fixture
async def db_env(tmp_path):
    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path}/mod.db")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    factory = async_sessionmaker(engine, expire_on_commit=False)
    yield SimpleNamespace(factory=factory, engine=engine)
    await engine.dispose()


def _user(username: str = "moduser") -> User:
    return User(
        email=f"{username}@gmov.dev",
        username=username,
        hashed_password="x",
        display_name=username,
    )


async def test_user_role_defaults_to_user(db_env):
    async with db_env.factory() as db:
        user = _user()
        db.add(user)
        await db.commit()
        await db.refresh(user)
    assert user.role == UserRole.USER


async def test_comment_is_hidden_defaults_false(db_env):
    async with db_env.factory() as db:
        user = _user()
        db.add(user)
        await db.flush()
        comment = Comment(user_id=user.id, movie_slug="mao", body="hi")
        db.add(comment)
        await db.commit()
        await db.refresh(comment)
    assert comment.is_hidden is False


async def test_comment_report_defaults(db_env):
    async with db_env.factory() as db:
        reporter = _user("reporter")
        author = _user("author")
        db.add_all([reporter, author])
        await db.flush()
        comment = Comment(user_id=author.id, movie_slug="mao", body="hi")
        db.add(comment)
        await db.flush()
        report = CommentReport(
            comment_id=comment.id,
            reporter_id=reporter.id,
            reason=ReportReason.SPAM,
        )
        db.add(report)
        await db.commit()
        await db.refresh(report)
    assert report.status == ReportStatus.OPEN
    assert report.note is None
    assert report.resolved_by is None
    assert report.resolved_at is None


async def test_comment_report_unique_per_reporter(db_env):
    async with db_env.factory() as db:
        reporter = _user("reporter")
        author = _user("author")
        db.add_all([reporter, author])
        await db.flush()
        comment = Comment(user_id=author.id, movie_slug="mao", body="hi")
        db.add(comment)
        await db.flush()
        db.add(
            CommentReport(
                comment_id=comment.id,
                reporter_id=reporter.id,
                reason=ReportReason.SPAM,
            )
        )
        await db.commit()

        db.add(
            CommentReport(
                comment_id=comment.id,
                reporter_id=reporter.id,
                reason=ReportReason.HARASSMENT,
            )
        )
        with pytest.raises(IntegrityError):
            await db.commit()


def test_hide_threshold_default_and_validation(monkeypatch):
    monkeypatch.delenv("COMMENT_REPORT_HIDE_THRESHOLD", raising=False)
    assert Settings().comment_report_hide_threshold == 3
    with pytest.raises(ValidationError):
        Settings(comment_report_hide_threshold=0)


def _quoted_values(clause: str) -> set[str]:
    return set(re.findall(r"'([a-z_]+)'", clause))


def test_model_constraint_metadata_matches_migration():
    user_checks = {
        c.name
        for c in User.__table__.constraints
        if isinstance(c, CheckConstraint)
    }
    assert "ck_users_role" in user_checks
    role_check = next(
        c
        for c in User.__table__.constraints
        if isinstance(c, CheckConstraint) and c.name == "ck_users_role"
    )
    model_roles = _quoted_values(str(role_check.sqltext))
    assert model_roles == {"user", "moderator", "admin"}

    migration_check = re.search(
        r"create_check_constraint\(\s*'ck_users_role',\s*"
        r"\"role IN \(([^)]*)\)\"",
        _MIGRATION_SOURCE,
    )
    assert migration_check is not None
    assert _quoted_values(migration_check.group(1)) == model_roles

    report_uniques = {
        c.name
        for c in CommentReport.__table__.constraints
        if isinstance(c, UniqueConstraint)
    }
    assert "uq_comment_reports_comment_reporter" in report_uniques
    migration_unique = re.search(
        r"UniqueConstraint\([^)]*"
        r"name='uq_comment_reports_comment_reporter'\)",
        _MIGRATION_SOURCE,
    )
    assert migration_unique is not None


def test_report_in_validates_reason_and_note_length():
    ok = ReportIn(comment_id=uuid.uuid4(), reason="spam", note="x" * 500)
    assert ok.reason == ReportReason.SPAM
    assert len(ok.note or "") == 500
    with pytest.raises(ValidationError):
        ReportIn(comment_id=uuid.uuid4(), reason="wizard")
    with pytest.raises(ValidationError):
        ReportIn(comment_id=uuid.uuid4(), reason="spam", note="x" * 501)


def test_comment_out_allows_null_body_and_hidden_flag():
    out = CommentOut(
        id=uuid.uuid4(),
        movie_slug="mao",
        user=CommentUser(username="u", display_name="U"),
        body=None,
        is_hidden=True,
        created_at=datetime.now(UTC),
    )
    assert out.body is None
    assert out.is_hidden is True


def _assert_schema(db_path: Path, *, present: bool) -> None:
    engine = create_engine(f"sqlite:///{db_path}")
    try:
        insp = inspect(engine)
        tables = set(insp.get_table_names())
        user_cols = {c["name"] for c in insp.get_columns("users")}
        comment_cols = {c["name"] for c in insp.get_columns("comments")}
    finally:
        engine.dispose()
    assert ("comment_reports" in tables) is present
    assert ("role" in user_cols) is present
    assert ("is_hidden" in comment_cols) is present


def test_migration_upgrade_downgrade_upgrade(tmp_path, monkeypatch):
    from alembic import command
    from alembic.config import Config

    db_path = tmp_path / "migration.db"
    monkeypatch.setattr(settings, "database_url", f"sqlite+aiosqlite:///{db_path}")
    cfg = Config(str(APP_DIR / "alembic.ini"))
    cfg.set_main_option("script_location", str(APP_DIR / "app" / "alembic"))

    command.upgrade(cfg, "head")
    _assert_schema(db_path, present=True)

    command.downgrade(cfg, PREVIOUS_HEAD)
    _assert_schema(db_path, present=False)

    command.upgrade(cfg, "head")
    _assert_schema(db_path, present=True)


def test_migration_stores_enum_values(tmp_path, monkeypatch):
    """The migrated schema must store lowercase enum values (matching the CHECK
    constraint and server_default), not SQLAlchemy member names."""
    from alembic import command
    from alembic.config import Config

    db_path = tmp_path / "enum_values.db"
    monkeypatch.setattr(settings, "database_url", f"sqlite+aiosqlite:///{db_path}")
    cfg = Config(str(APP_DIR / "alembic.ini"))
    cfg.set_main_option("script_location", str(APP_DIR / "app" / "alembic"))
    command.upgrade(cfg, "head")

    engine = create_engine(f"sqlite:///{db_path}")
    try:
        with Session(engine) as session:
            user = _user("enumuser")
            session.add(user)
            session.flush()
            comment = Comment(user_id=user.id, movie_slug="mao", body="hi")
            session.add(comment)
            session.flush()
            report = CommentReport(
                comment_id=comment.id,
                reporter_id=user.id,
                reason=ReportReason.SPAM,
            )
            session.add(report)
            session.commit()

            role_raw = session.execute(text("SELECT role FROM users")).scalar_one()
            reason_raw, status_raw = session.execute(
                text("SELECT reason, status FROM comment_reports")
            ).one()
            assert role_raw == "user"
            assert reason_raw == "spam"
            assert status_raw == "open"

            # A row that relies on the migration's server_default must load via ORM.
            session.execute(
                text(
                    "INSERT INTO users (id, email, username, hashed_password,"
                    " display_name, is_active, created_at, updated_at)"
                    " VALUES (:id, :email, :username, 'x', 'x', 1,"
                    " CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"
                ),
                {
                    "id": str(uuid.uuid4()),
                    "email": "backfill@gmov.dev",
                    "username": "backfill",
                },
            )
            session.commit()
            session.expire_all()
            backfilled = session.execute(
                select(User).where(User.username == "backfill")
            ).scalar_one()
            assert backfilled.role == UserRole.USER
            assert session.get(User, user.id).role == UserRole.USER
            stored = session.execute(select(CommentReport)).scalar_one()
            assert stored.reason == ReportReason.SPAM
            assert stored.status == ReportStatus.OPEN
    finally:
        engine.dispose()


async def test_cli_set_role_promotes(db_env, monkeypatch):
    from app import cli

    async with db_env.factory() as db:
        db.add(_user("alice"))
        await db.commit()

    monkeypatch.setattr(cli, "session_factory", db_env.factory)
    monkeypatch.setattr(cli, "engine", db_env.engine)

    code = await cli.main(["set-role", "alice", "admin"])
    assert code == 0

    async with db_env.factory() as db:
        user = (
            await db.execute(select(User).where(User.username == "alice"))
        ).scalar_one()
    assert user.role == UserRole.ADMIN


async def test_cli_unknown_user_returns_nonzero(db_env, monkeypatch):
    from app import cli

    monkeypatch.setattr(cli, "session_factory", db_env.factory)
    monkeypatch.setattr(cli, "engine", db_env.engine)

    code = await cli.main(["set-role", "ghost", "admin"])
    assert code == 1


async def test_cli_invalid_role_rejected_by_argparse(monkeypatch):
    from app import cli

    disposed = False

    class FakeEngine:
        async def dispose(self) -> None:
            nonlocal disposed
            disposed = True

    monkeypatch.setattr(cli, "engine", FakeEngine())

    with pytest.raises(SystemExit) as exc:
        await cli.main(["set-role", "alice", "wizard"])
    assert exc.value.code == 2
    assert disposed is True
