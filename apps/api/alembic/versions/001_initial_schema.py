"""Initial schema

Revision ID: 001
Revises:
Create Date: 2024-01-01 00:00:00.000000
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = '001'
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'runs',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('query', sa.Text(), nullable=False),
        sa.Column('constraints_json', sa.JSON(), nullable=True),
        sa.Column('status', sa.String(20), nullable=False, server_default='pending'),
        sa.Column('report_md', sa.Text(), nullable=True),
        sa.Column('report_json', sa.JSON(), nullable=True),
        sa.Column('scores_json', sa.JSON(), nullable=True),
        sa.Column('model_name', sa.String(100), nullable=True),
        sa.Column('iteration_count', sa.Integer(), server_default='0'),
        sa.Column('created_at', sa.DateTime(), server_default=sa.func.now()),
        sa.Column('finished_at', sa.DateTime(), nullable=True),
    )

    op.create_table(
        'run_events',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('run_id', sa.String(36), sa.ForeignKey('runs.id', ondelete='CASCADE'), nullable=False),
        sa.Column('timestamp', sa.DateTime(), server_default=sa.func.now()),
        sa.Column('state', sa.String(30), nullable=False),
        sa.Column('message', sa.Text(), nullable=True),
        sa.Column('payload_json', sa.JSON(), nullable=True),
    )
    op.create_index('ix_run_events_run_id', 'run_events', ['run_id'])

    op.create_table(
        'documents',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('url', sa.String(2048), unique=True, nullable=True),
        sa.Column('title', sa.String(500), nullable=True),
        sa.Column('domain', sa.String(255), nullable=True),
        sa.Column('published_at', sa.DateTime(), nullable=True),
        sa.Column('fetched_at', sa.DateTime(), server_default=sa.func.now()),
        sa.Column('raw_text', sa.Text(), nullable=True),
        sa.Column('clean_text', sa.Text(), nullable=True),
        sa.Column('metadata_json', sa.JSON(), nullable=True),
        sa.Column('content_hash', sa.String(64), nullable=True, index=True),
    )

    op.create_table(
        'chunks',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('document_id', sa.String(36), sa.ForeignKey('documents.id', ondelete='CASCADE'), nullable=False),
        sa.Column('run_id', sa.String(36), sa.ForeignKey('runs.id', ondelete='SET NULL'), nullable=True),
        sa.Column('chunk_index', sa.Integer(), nullable=False),
        sa.Column('chunk_text', sa.Text(), nullable=False),
        sa.Column('token_count', sa.Integer(), nullable=True),
        sa.Column('metadata_json', sa.JSON(), nullable=True),
    )
    op.create_index('ix_chunks_document_id', 'chunks', ['document_id'])
    op.create_index('ix_chunks_run_id', 'chunks', ['run_id'])

    op.create_table(
        'citations',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('run_id', sa.String(36), sa.ForeignKey('runs.id', ondelete='CASCADE'), nullable=False),
        sa.Column('document_id', sa.String(36), sa.ForeignKey('documents.id', ondelete='SET NULL'), nullable=True),
        sa.Column('chunk_id', sa.String(36), sa.ForeignKey('chunks.id', ondelete='SET NULL'), nullable=True),
        sa.Column('claim_text', sa.Text(), nullable=True),
        sa.Column('snippet', sa.Text(), nullable=True),
        sa.Column('url', sa.String(2048), nullable=True),
        sa.Column('section_key', sa.String(200), nullable=True),
    )
    op.create_index('ix_citations_run_id', 'citations', ['run_id'])

    op.create_table(
        'sources',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('run_id', sa.String(36), sa.ForeignKey('runs.id', ondelete='SET NULL'), nullable=True),
        sa.Column('filename', sa.String(500), nullable=True),
        sa.Column('url', sa.String(2048), nullable=True),
        sa.Column('content_type', sa.String(100), nullable=True),
        sa.Column('raw_text', sa.Text(), nullable=True),
        sa.Column('status', sa.String(20), server_default='pending'),
        sa.Column('created_at', sa.DateTime(), server_default=sa.func.now()),
    )

    op.create_table(
        'learning_memory',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('type', sa.String(50), nullable=False),
        sa.Column('key', sa.String(200), nullable=False),
        sa.Column('value_json', sa.JSON(), nullable=True),
        sa.Column('score', sa.Float(), nullable=True),
        sa.Column('updated_at', sa.DateTime(), server_default=sa.func.now()),
    )


def downgrade() -> None:
    op.drop_table('learning_memory')
    op.drop_table('sources')
    op.drop_table('citations')
    op.drop_table('chunks')
    op.drop_table('documents')
    op.drop_table('run_events')
    op.drop_table('runs')
