"""Create memory tables: research_sessions, trusted_sources, memory_entries, query_logs

Revision ID: 004
Revises: 003
Create Date: 2024-01-04 00:00:00.000000
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = '004'
down_revision: Union[str, None] = '003'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ── Research Sessions ────────────────────────────────────────────────
    op.create_table(
        'research_sessions',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('user_id', sa.String(255), nullable=False),
        sa.Column('title', sa.String(512), nullable=True),
        sa.Column('run_ids', sa.ARRAY(sa.String()), nullable=True),
        sa.Column('context_json', sa.JSON(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index('ix_research_sessions_user_id', 'research_sessions', ['user_id'])

    # ── Trusted Sources ──────────────────────────────────────────────────
    op.create_table(
        'trusted_sources',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('user_id', sa.String(255), nullable=False),
        sa.Column('domain', sa.String(512), nullable=False),
        sa.Column('label', sa.String(255), nullable=True),
        sa.Column('trust_level', sa.Float(), nullable=False, server_default='1.0'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index('ix_trusted_sources_user_id', 'trusted_sources', ['user_id'])
    op.create_unique_constraint('uq_trusted_source_user_domain', 'trusted_sources', ['user_id', 'domain'])

    # ── Memory Entries ───────────────────────────────────────────────────
    op.create_table(
        'memory_entries',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('user_id', sa.String(255), nullable=False),
        sa.Column('category', sa.String(50), nullable=False),
        sa.Column('content', sa.Text(), nullable=False),
        sa.Column('embedding', sa.Text(), nullable=True),
        sa.Column('source_run_id', sa.String(36), nullable=True),
        sa.Column('confidence', sa.Float(), nullable=False, server_default='1.0'),
        sa.Column('access_count', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('is_active', sa.Boolean(), nullable=False, server_default='true'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index('ix_memory_entries_user_id', 'memory_entries', ['user_id'])
    op.create_index('ix_memory_entries_category', 'memory_entries', ['category'])

    # Try to convert embedding to vector type if pgvector is available
    try:
        op.execute(
            'ALTER TABLE memory_entries ALTER COLUMN embedding '
            'TYPE vector(384) USING embedding::vector(384)'
        )
        op.execute(
            'CREATE INDEX ix_memory_entries_embedding_hnsw ON memory_entries '
            'USING hnsw (embedding vector_cosine_ops) '
            'WITH (m = 16, ef_construction = 64)'
        )
    except Exception:
        pass

    # ── Query Logs ───────────────────────────────────────────────────────
    op.create_table(
        'query_logs',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('user_id', sa.String(255), nullable=False),
        sa.Column('query', sa.Text(), nullable=False),
        sa.Column('run_id', sa.String(36), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index('ix_query_logs_user_id', 'query_logs', ['user_id'])


def downgrade() -> None:
    op.drop_table('query_logs')
    op.execute('DROP INDEX IF EXISTS ix_memory_entries_embedding_hnsw')
    op.drop_table('memory_entries')
    op.drop_table('trusted_sources')
    op.drop_table('research_sessions')
