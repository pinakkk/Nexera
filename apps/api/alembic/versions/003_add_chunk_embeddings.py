"""Add embedding column to chunks (pgvector)

Revision ID: 003
Revises: 002
Create Date: 2024-01-03 00:00:00.000000
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = '003'
down_revision: Union[str, None] = '002'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Enable pgvector extension (safe to call if already exists)
    op.execute('CREATE EXTENSION IF NOT EXISTS vector')

    # Add embedding column (384-dim vector for BAAI/bge-small-en-v1.5)
    op.add_column('chunks', sa.Column('embedding', sa.Text(), nullable=True))

    # If pgvector is available, alter column type to vector(384)
    # This is done via raw SQL since alembic doesn't natively support vector types
    try:
        op.execute('ALTER TABLE chunks ALTER COLUMN embedding TYPE vector(384) USING embedding::vector(384)')
        # Create HNSW index for fast approximate nearest-neighbor search
        op.execute(
            'CREATE INDEX ix_chunks_embedding_hnsw ON chunks '
            'USING hnsw (embedding vector_cosine_ops) '
            'WITH (m = 16, ef_construction = 64)'
        )
    except Exception:
        # pgvector not installed; keep as TEXT column (embeddings stored as JSON strings)
        pass


def downgrade() -> None:
    op.execute('DROP INDEX IF EXISTS ix_chunks_embedding_hnsw')
    op.drop_column('chunks', 'embedding')
