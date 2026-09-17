"""profile preferences and catalog items

Revision ID: c46bc4737183
Revises: 79d983c25d9a
Create Date: 2026-09-17 10:09:00.152653

"""
import sqlalchemy as sa
from alembic import op

revision = 'c46bc4737183'
down_revision = '79d983c25d9a'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "profile_preferences",
        sa.Column("profile_id", sa.Uuid(), nullable=False),
        sa.Column("genres", sa.JSON(), nullable=False, server_default=sa.text("'{}'")),
        sa.Column("countries", sa.JSON(), nullable=False, server_default=sa.text("'{}'")),
        sa.Column("onboarding_completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("skipped", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("(CURRENT_TIMESTAMP)"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("(CURRENT_TIMESTAMP)"), nullable=False),
        sa.ForeignKeyConstraint(["profile_id"], ["profiles.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("profile_id"),
    )
    op.create_table(
        "catalog_items",
        sa.Column("slug", sa.String(length=255), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("original_name", sa.String(length=255), nullable=True),
        sa.Column("poster_url", sa.Text(), nullable=False),
        sa.Column("thumb_url", sa.Text(), nullable=False),
        sa.Column("year", sa.Integer(), nullable=True),
        sa.Column("genres", sa.JSON(), nullable=False, server_default=sa.text("'[]'")),
        sa.Column("country", sa.String(length=64), nullable=True),
        sa.Column("casts", sa.Text(), nullable=True),
        sa.Column("director", sa.Text(), nullable=True),
        sa.Column("fetched_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("source", sa.String(length=32), nullable=False),
        sa.PrimaryKeyConstraint("slug"),
    )
    op.create_index(
        op.f("ix_catalog_items_year"), "catalog_items", ["year"], unique=False
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_catalog_items_year"), table_name="catalog_items")
    op.drop_table("catalog_items")
    op.drop_table("profile_preferences")
