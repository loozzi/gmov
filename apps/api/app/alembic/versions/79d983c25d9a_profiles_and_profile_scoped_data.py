"""profiles and profile-scoped viewing data

Creates `profiles` and moves `favorite`/`watchlist`/`rating`/`watch_progress`
rows onto each user's default profile. `refresh_tokens` gains a nullable
`profile_id` so old sessions fall back to the default profile.

Revision ID: 79d983c25d9a
Revises: d2b8e0f4c317
Create Date: 2026-09-17 20:30:00.000000

"""

import uuid
from datetime import UTC, datetime

import sqlalchemy as sa
from alembic import op
from sqlalchemy.engine import Connection

revision = "79d983c25d9a"
down_revision = "d2b8e0f4c317"
branch_labels = None
depends_on = None

# table -> (old unique, new unique, unique tail, old owner index, new owner index)
_TABLES: dict[str, tuple[str, str, tuple[str, ...], str, str]] = {
    "favorites": (
        "uq_favorite_user_movie", "uq_favorite_profile_movie", ("movie_slug",),
        "ix_favorites_user_id", "ix_favorites_profile_id",
    ),
    "watchlist": (
        "uq_watchlist_user_movie", "uq_watchlist_profile_movie", ("movie_slug",),
        "ix_watchlist_user_id", "ix_watchlist_profile_id",
    ),
    "ratings": (
        "uq_rating_user_movie", "uq_rating_profile_movie", ("movie_slug",),
        "ix_ratings_user_id", "ix_ratings_profile_id",
    ),
    "watch_progress": (
        "uq_progress_user_movie_episode", "uq_progress_profile_movie_episode",
        ("movie_slug", "episode_slug"),
        "ix_watch_progress_user_id", "ix_watch_progress_profile_id",
    ),
}


def _is_sqlite() -> bool:
    return op.get_bind().dialect.name == "sqlite"


def _create_profiles() -> None:
    op.create_table(
        "profiles",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(length=32), nullable=False),
        sa.Column("avatar", sa.String(length=32), nullable=False, server_default="popcorn"),
        sa.Column("position", sa.SmallInteger(), nullable=False),
        sa.Column("is_default", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("pin_hash", sa.String(length=255), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("(CURRENT_TIMESTAMP)"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("(CURRENT_TIMESTAMP)"), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "name", name="uq_profile_user_name"),
        sa.UniqueConstraint("user_id", "position", name="uq_profile_user_position"),
    )
    op.create_index(op.f("ix_profiles_user_id"), "profiles", ["user_id"], unique=False)
    op.create_index(
        "uq_profile_user_default", "profiles", ["user_id"], unique=True,
        postgresql_where=sa.text("is_default"), sqlite_where=sa.text("is_default = 1"),
    )


def _insert_default_profiles_sqlite(connection: Connection) -> None:
    users = sa.table("users", sa.column("id", sa.Uuid()))
    profiles = sa.table(
        "profiles",
        sa.column("id", sa.Uuid()),
        sa.column("user_id", sa.Uuid()),
        sa.column("name", sa.String()),
        sa.column("avatar", sa.String()),
        sa.column("position", sa.SmallInteger()),
        sa.column("is_default", sa.Boolean()),
        sa.column("created_at", sa.DateTime(timezone=True)),
        sa.column("updated_at", sa.DateTime(timezone=True)),
    )
    now = datetime.now(UTC)
    rows = [
        {
            "id": uuid.uuid4(), "user_id": user_id, "name": "Mặc định",
            "avatar": "popcorn", "position": 0, "is_default": True,
            "created_at": now, "updated_at": now,
        }
        for user_id in connection.execute(sa.select(users.c.id)).scalars()
    ]
    if rows:
        connection.execute(profiles.insert(), rows)


def _insert_default_profiles() -> None:
    if _is_sqlite():
        _insert_default_profiles_sqlite(op.get_bind())
    else:
        op.execute(
            "INSERT INTO profiles (id, user_id, name, avatar, position, is_default, created_at, updated_at)"
            " SELECT gen_random_uuid(), id, 'Mặc định', 'popcorn', 0, true, now(), now() FROM users"
        )


def _backfill_owner() -> None:
    for table in _TABLES:
        if _is_sqlite():
            op.execute(
                f"UPDATE {table} SET profile_id = (SELECT p.id FROM profiles p"
                f" WHERE p.user_id = {table}.user_id AND p.is_default)"
            )
        else:
            op.execute(
                f"UPDATE {table} t SET profile_id = p.id FROM profiles p"
                " WHERE p.user_id = t.user_id AND p.is_default"
            )


def _rekey_table(
    table: str, old_unique: str, new_unique: str, tail: tuple[str, ...],
    old_index: str, new_index: str,
) -> None:
    if _is_sqlite():
        with op.batch_alter_table(table, schema=None) as batch_op:
            batch_op.alter_column("profile_id", existing_type=sa.Uuid(), nullable=False)
            batch_op.create_foreign_key(f"fk_{table}_profile", "profiles", ["profile_id"], ["id"], ondelete="CASCADE")
            batch_op.drop_constraint(old_unique, type_="unique")
            batch_op.create_unique_constraint(new_unique, ["profile_id", *tail])
            batch_op.drop_index(old_index)
            batch_op.create_index(new_index, ["profile_id"], unique=False)
            batch_op.drop_column("user_id")
    else:
        op.alter_column(table, "profile_id", existing_type=sa.Uuid(), nullable=False)
        op.create_foreign_key(f"fk_{table}_profile", table, "profiles", ["profile_id"], ["id"], ondelete="CASCADE")
        op.drop_constraint(old_unique, table, type_="unique")
        op.create_unique_constraint(new_unique, table, ["profile_id", *tail])
        op.drop_index(old_index, table_name=table)
        op.create_index(new_index, table, ["profile_id"], unique=False)
        op.drop_column(table, "user_id")


def _add_refresh_token_profile() -> None:
    column = sa.Column("profile_id", sa.Uuid(), nullable=True)
    if _is_sqlite():
        with op.batch_alter_table("refresh_tokens", schema=None) as batch_op:
            batch_op.add_column(column)
            batch_op.create_foreign_key("fk_refresh_tokens_profile", "profiles", ["profile_id"], ["id"], ondelete="SET NULL")
    else:
        op.add_column("refresh_tokens", column)
        op.create_foreign_key("fk_refresh_tokens_profile", "refresh_tokens", "profiles", ["profile_id"], ["id"], ondelete="SET NULL")


def upgrade() -> None:
    _create_profiles()
    _insert_default_profiles()
    for table in _TABLES:
        op.add_column(table, sa.Column("profile_id", sa.Uuid(), nullable=True))
    _backfill_owner()
    for table, spec in _TABLES.items():
        _rekey_table(table, *spec)
    _add_refresh_token_profile()


def _drop_refresh_token_profile() -> None:
    if _is_sqlite():
        with op.batch_alter_table("refresh_tokens", schema=None) as batch_op:
            batch_op.drop_constraint("fk_refresh_tokens_profile", type_="foreignkey")
            batch_op.drop_column("profile_id")
    else:
        op.drop_constraint("fk_refresh_tokens_profile", "refresh_tokens", type_="foreignkey")
        op.drop_column("refresh_tokens", "profile_id")


def _unkey_table(
    table: str, old_unique: str, new_unique: str, tail: tuple[str, ...],
    old_index: str, new_index: str,
) -> None:
    # Downgrade merges data of extra (non-default) profiles back onto the
    # owning user: the old schema only has room for one row per user.
    op.add_column(table, sa.Column("user_id", sa.Uuid(), nullable=True))
    if _is_sqlite():
        op.execute(
            f"UPDATE {table} SET user_id = (SELECT p.user_id FROM profiles p"
            f" WHERE p.id = {table}.profile_id)"
        )
        with op.batch_alter_table(table, schema=None) as batch_op:
            batch_op.alter_column("user_id", existing_type=sa.Uuid(), nullable=False)
            batch_op.create_foreign_key(f"fk_{table}_user", "users", ["user_id"], ["id"], ondelete="CASCADE")
            batch_op.drop_constraint(f"fk_{table}_profile", type_="foreignkey")
            batch_op.drop_constraint(new_unique, type_="unique")
            batch_op.drop_index(new_index)
            batch_op.create_unique_constraint(old_unique, ["user_id", *tail])
            batch_op.create_index(old_index, ["user_id"], unique=False)
            batch_op.drop_column("profile_id")
    else:
        op.execute(
            f"UPDATE {table} t SET user_id = p.user_id FROM profiles p"
            " WHERE p.id = t.profile_id"
        )
        op.alter_column(table, "user_id", existing_type=sa.Uuid(), nullable=False)
        op.create_foreign_key(f"fk_{table}_user", table, "users", ["user_id"], ["id"], ondelete="CASCADE")
        op.drop_constraint(f"fk_{table}_profile", table, type_="foreignkey")
        op.drop_constraint(new_unique, table, type_="unique")
        op.drop_index(new_index, table_name=table)
        op.create_unique_constraint(old_unique, table, ["user_id", *tail])
        op.create_index(old_index, table, ["user_id"], unique=False)
        op.drop_column(table, "profile_id")


def _drop_profiles() -> None:
    op.drop_index("uq_profile_user_default", table_name="profiles")
    op.drop_index(op.f("ix_profiles_user_id"), table_name="profiles")
    op.drop_table("profiles")


def downgrade() -> None:
    _drop_refresh_token_profile()
    for table, spec in _TABLES.items():
        _unkey_table(table, *spec)
    _drop_profiles()
