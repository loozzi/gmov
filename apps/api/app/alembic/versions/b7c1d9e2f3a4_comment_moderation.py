"""comment moderation: user roles, hidden comments, comment reports

Revision ID: b7c1d9e2f3a4
Revises: a1b2c3d4e5f6
Create Date: 2026-09-16 10:00:00.000000

"""
import sqlalchemy as sa
from alembic import op

revision = 'b7c1d9e2f3a4'
down_revision = 'a1b2c3d4e5f6'
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table('users', schema=None) as batch_op:
        batch_op.add_column(
            sa.Column(
                'role',
                sa.String(length=20),
                server_default='user',
                nullable=False,
            )
        )
        batch_op.create_check_constraint(
            'ck_users_role', "role IN ('user', 'moderator', 'admin')"
        )

    with op.batch_alter_table('comments', schema=None) as batch_op:
        batch_op.add_column(
            sa.Column(
                'is_hidden',
                sa.Boolean(),
                server_default='false',
                nullable=False,
            )
        )

    op.create_table('comment_reports',
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('comment_id', sa.Uuid(), nullable=False),
    sa.Column('reporter_id', sa.Uuid(), nullable=False),
    sa.Column('reason', sa.String(length=20), nullable=False),
    sa.Column('note', sa.Text(), nullable=True),
    sa.Column('status', sa.String(length=20), server_default='open', nullable=False),
    sa.Column('resolved_by', sa.Uuid(), nullable=True),
    sa.Column('resolved_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=False),
    sa.ForeignKeyConstraint(['comment_id'], ['comments.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['reporter_id'], ['users.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['resolved_by'], ['users.id'], ondelete='SET NULL'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('comment_id', 'reporter_id', name='uq_comment_reports_comment_reporter')
    )
    op.create_index(op.f('ix_comment_reports_comment_id'), 'comment_reports', ['comment_id'], unique=False)
    op.create_index(op.f('ix_comment_reports_reporter_id'), 'comment_reports', ['reporter_id'], unique=False)
    op.create_index(op.f('ix_comment_reports_status'), 'comment_reports', ['status'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_comment_reports_status'), table_name='comment_reports')
    op.drop_index(op.f('ix_comment_reports_reporter_id'), table_name='comment_reports')
    op.drop_index(op.f('ix_comment_reports_comment_id'), table_name='comment_reports')
    op.drop_table('comment_reports')

    with op.batch_alter_table('comments', schema=None) as batch_op:
        batch_op.drop_column('is_hidden')

    with op.batch_alter_table('users', schema=None) as batch_op:
        batch_op.drop_constraint('ck_users_role', type_='check')
        batch_op.drop_column('role')
