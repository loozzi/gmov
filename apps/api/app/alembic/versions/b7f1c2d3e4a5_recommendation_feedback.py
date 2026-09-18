"""recommendation feedback + excluded genres

Adds `profile_preferences.excluded_genres` (genre slugs the user removed on the
taste page, JSON list, real `'[]'` server default like other JSON columns) and
the `recommendation_feedback` table (one thumb per profile+movie).

Revision ID: b7f1c2d3e4a5
Revises: a4d9c1e7f2b8
Create Date: 2026-09-18 09:30:00.000000

"""

import sqlalchemy as sa
from alembic import op

revision = "b7f1c2d3e4a5"
down_revision = "a4d9c1e7f2b8"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("profile_preferences", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column(
                "excluded_genres",
                sa.JSON(),
                nullable=False,
                server_default=sa.text("'[]'"),
            )
        )
    op.create_table(
        "recommendation_feedback",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("profile_id", sa.Uuid(), nullable=False),
        sa.Column("movie_slug", sa.String(length=255), nullable=False),
        sa.Column("kind", sa.String(length=32), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("(CURRENT_TIMESTAMP)"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("(CURRENT_TIMESTAMP)"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["profile_id"], ["profiles.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "profile_id",
            "movie_slug",
            name="uq_recommendation_feedback_profile_movie",
        ),
    )
    op.create_index(
        op.f("ix_recommendation_feedback_profile_id"),
        "recommendation_feedback",
        ["profile_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_recommendation_feedback_movie_slug"),
        "recommendation_feedback",
        ["movie_slug"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(
        op.f("ix_recommendation_feedback_movie_slug"),
        table_name="recommendation_feedback",
    )
    op.drop_index(
        op.f("ix_recommendation_feedback_profile_id"),
        table_name="recommendation_feedback",
    )
    op.drop_table("recommendation_feedback")
    with op.batch_alter_table("profile_preferences", schema=None) as batch_op:
        batch_op.drop_column("excluded_genres")
