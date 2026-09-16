"""Star ratings + comments (one reply level).

Revision ID: a1b2c3d4e5f6
Revises: 7f2a9c1d4e68
Create Date: 2026-09-15 08:30:00.000000

"""
import sqlalchemy as sa
from alembic import op

revision = 'a1b2c3d4e5f6'
down_revision = '7f2a9c1d4e68'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table('ratings',
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('user_id', sa.Uuid(), nullable=False),
    sa.Column('movie_slug', sa.String(length=255), nullable=False),
    sa.Column('stars', sa.SmallInteger(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=False),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('user_id', 'movie_slug', name='uq_rating_user_movie')
    )
    op.create_index(op.f('ix_ratings_movie_slug'), 'ratings', ['movie_slug'], unique=False)
    op.create_index(op.f('ix_ratings_user_id'), 'ratings', ['user_id'], unique=False)

    op.create_table('comments',
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('user_id', sa.Uuid(), nullable=False),
    sa.Column('movie_slug', sa.String(length=255), nullable=False),
    sa.Column('parent_id', sa.Uuid(), nullable=True),
    sa.Column('body', sa.Text(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=False),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['parent_id'], ['comments.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_comments_movie_slug'), 'comments', ['movie_slug'], unique=False)
    op.create_index(op.f('ix_comments_user_id'), 'comments', ['user_id'], unique=False)
    op.create_index(op.f('ix_comments_parent_id'), 'comments', ['parent_id'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_comments_parent_id'), table_name='comments')
    op.drop_index(op.f('ix_comments_user_id'), table_name='comments')
    op.drop_index(op.f('ix_comments_movie_slug'), table_name='comments')
    op.drop_table('comments')
    op.drop_index(op.f('ix_ratings_user_id'), table_name='ratings')
    op.drop_index(op.f('ix_ratings_movie_slug'), table_name='ratings')
    op.drop_table('ratings')
