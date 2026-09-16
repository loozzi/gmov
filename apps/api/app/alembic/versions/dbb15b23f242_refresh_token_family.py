"""add refresh token family_id and compromise flag

Revision ID: dbb15b23f242
Revises: b7c1d9e2f3a4
Create Date: 2026-09-16 12:15:00.000000

"""
import sqlalchemy as sa
from alembic import op

revision = 'dbb15b23f242'
down_revision = 'b7c1d9e2f3a4'
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table('refresh_tokens', schema=None) as batch_op:
        batch_op.add_column(sa.Column('family_id', sa.Uuid(), nullable=True))
        batch_op.add_column(
            sa.Column(
                'compromised',
                sa.Boolean(),
                server_default=sa.false(),
                nullable=False,
            )
        )

    op.execute('UPDATE refresh_tokens SET family_id = id WHERE family_id IS NULL')

    with op.batch_alter_table('refresh_tokens', schema=None) as batch_op:
        batch_op.alter_column(
            'family_id', existing_type=sa.Uuid(), nullable=False
        )
        batch_op.create_index(
            op.f('ix_refresh_tokens_family_id'), ['family_id'], unique=False
        )


def downgrade() -> None:
    with op.batch_alter_table('refresh_tokens', schema=None) as batch_op:
        batch_op.drop_index(op.f('ix_refresh_tokens_family_id'))
        batch_op.drop_column('compromised')
        batch_op.drop_column('family_id')
