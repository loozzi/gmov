"""add episode position to watch progress

Revision ID: e3a91c7b5d42
Revises: dbb15b23f242
Create Date: 2026-09-16 15:00:00.000000

"""
import sqlalchemy as sa
from alembic import op

revision = 'e3a91c7b5d42'
down_revision = 'dbb15b23f242'
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table('watch_progress', schema=None) as batch_op:
        batch_op.add_column(sa.Column('episode_index', sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column('total_episodes', sa.Integer(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table('watch_progress', schema=None) as batch_op:
        batch_op.drop_column('total_episodes')
        batch_op.drop_column('episode_index')
