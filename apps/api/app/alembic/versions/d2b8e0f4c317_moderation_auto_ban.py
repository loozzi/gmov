"""moderation: keyword auto-reports (source) + user bans

Revision ID: d2b8e0f4c317
Revises: c41d7e9b2a05
Create Date: 2026-09-17 19:30:00.000000

"""

import sqlalchemy as sa
from alembic import op

revision = 'd2b8e0f4c317'
down_revision = 'c41d7e9b2a05'
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table('users', schema=None) as batch_op:
        batch_op.add_column(
            sa.Column('banned_at', sa.DateTime(timezone=True), nullable=True)
        )
        batch_op.add_column(
            sa.Column('ban_reason', sa.String(length=200), nullable=True)
        )

    with op.batch_alter_table('comment_reports', schema=None) as batch_op:
        # 'user' keeps every existing row classified as a user report.
        batch_op.add_column(
            sa.Column(
                'source',
                sa.String(length=10),
                server_default='user',
                nullable=False,
            )
        )
        batch_op.alter_column(
            'reporter_id', existing_type=sa.Uuid(), nullable=True
        )


def downgrade() -> None:
    with op.batch_alter_table('comment_reports', schema=None) as batch_op:
        batch_op.alter_column(
            'reporter_id', existing_type=sa.Uuid(), nullable=False
        )
        batch_op.drop_column('source')

    with op.batch_alter_table('users', schema=None) as batch_op:
        batch_op.drop_column('ban_reason')
        batch_op.drop_column('banned_at')
