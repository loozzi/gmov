"""comments.is_hidden default as a real boolean

`server_default='false'` is rendered as DEFAULT 'false', which SQLite stores as
the *text* 'false' (bool() -> True), so any insert relying on the DB default
created an already-hidden comment. Matches RefreshToken.compromised.

Revision ID: c41d7e9b2a05
Revises: e3a91c7b5d42
Create Date: 2026-09-17 18:00:00.000000

"""
import sqlalchemy as sa
from alembic import op

revision = 'c41d7e9b2a05'
down_revision = 'e3a91c7b5d42'
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table('comments', schema=None) as batch_op:
        batch_op.alter_column(
            'is_hidden',
            existing_type=sa.Boolean(),
            existing_nullable=False,
            server_default=sa.false(),
        )


def downgrade() -> None:
    with op.batch_alter_table('comments', schema=None) as batch_op:
        batch_op.alter_column(
            'is_hidden',
            existing_type=sa.Boolean(),
            existing_nullable=False,
            server_default='false',
        )
