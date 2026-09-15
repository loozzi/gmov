"""watchlist ("want to watch", separate from favorites).

Revision ID: 7f2a9c1d4e68
Revises: e0976b6afeb9
Create Date: 2026-09-15 08:00:00.000000

"""
import sqlalchemy as sa
from alembic import op

revision = '7f2a9c1d4e68'
down_revision = 'e0976b6afeb9'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table('watchlist',
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('user_id', sa.Uuid(), nullable=False),
    sa.Column('movie_slug', sa.String(length=255), nullable=False),
    sa.Column('movie_name', sa.String(length=255), nullable=False),
    sa.Column('poster_url', sa.String(length=2048), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=False),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('user_id', 'movie_slug', name='uq_watchlist_user_movie')
    )
    op.create_index(op.f('ix_watchlist_movie_slug'), 'watchlist', ['movie_slug'], unique=False)
    op.create_index(op.f('ix_watchlist_user_id'), 'watchlist', ['user_id'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_watchlist_user_id'), table_name='watchlist')
    op.drop_index(op.f('ix_watchlist_movie_slug'), table_name='watchlist')
    op.drop_table('watchlist')
