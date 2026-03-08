"""Add user_id, thread_id, gate_route to runs table

Revision ID: 002
Revises: 001
Create Date: 2024-01-02 00:00:00.000000
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = '002'
down_revision: Union[str, None] = '001'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('runs', sa.Column('user_id', sa.String(255), nullable=True))
    op.add_column('runs', sa.Column('thread_id', sa.String(36), nullable=True))
    op.add_column('runs', sa.Column('gate_route', sa.String(20), nullable=True))
    op.create_index('ix_runs_user_id', 'runs', ['user_id'])
    op.create_index('ix_runs_thread_id', 'runs', ['thread_id'])


def downgrade() -> None:
    op.drop_index('ix_runs_thread_id', table_name='runs')
    op.drop_index('ix_runs_user_id', table_name='runs')
    op.drop_column('runs', 'gate_route')
    op.drop_column('runs', 'thread_id')
    op.drop_column('runs', 'user_id')
