"""comments.has_spoiler: author/moderator spoiler veil

Boolean with a real `false()` server default (see c41d7e9b2a05: a textual
'false' is truthy on SQLite).

Revision ID: a4d9c1e7f2b8
Revises: c46bc4737183
Create Date: 2026-09-17 20:30:00.000000

"""
import sqlalchemy as sa
from alembic import op

revision = 'a4d9c1e7f2b8'
down_revision = 'c46bc4737183'
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table('comments', schema=None) as batch_op:
        batch_op.add_column(
            sa.Column(
                'has_spoiler',
                sa.Boolean(),
                nullable=False,
                server_default=sa.false(),
            )
        )


def downgrade() -> None:
    with op.batch_alter_table('comments', schema=None) as batch_op:
        batch_op.drop_column('has_spoiler')
