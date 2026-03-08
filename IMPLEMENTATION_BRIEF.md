# Nexara — Autonomous Research Agent: Complete Implementation Brief

> **Purpose of this document**: This is a complete, unambiguous engineering brief for an AI agent (Claude Opus) to implement all remaining features in one session. Read it fully before touching any file. Every decision is already made. Follow exactly.

---

## 0. ORIENTATION — Read This First

### What Nexara Is
A full-stack autonomous research agent:
- **Backend**: FastAPI (Python 3.11+) at `apps/api/`
- **Frontend**: Next.js 15 (App Router, TypeScript) at `apps/web/`
- **Databases**: MongoDB Atlas (run metadata) + PostgreSQL (research artifacts)
- **LLM**: Groq API — fast model `llama-3.1-8b-instant`, smart model `llama-3.3-70b-versatile`
- **Auth**: WorkOS AuthKit (JWT, optional — anonymous mode exists)
- **Deployment Target**: Leapcell (FastAPI), Vercel (Next.js)

### What Is Already Built and Working
Do NOT rewrite or refactor these — they work:
- Custom async FSM orchestrator (`services/orchestrator.py`) with states: `INTAKE → PLAN → WAIT_FOR_USER → RESEARCH_LOOP → RETRIEVE_EVIDENCE → KG_EXTRACT → SYNTHESIZE → VERIFY → [REFINE loop] → FINALIZE`
- Full Tavily web search with caching + dedup (`services/searcher.py`)
- Semantic Scholar + arXiv academic search (`services/academic.py`)
- trafilatura HTML scraping + pypdf (`services/fetcher.py`)
- Token-based document chunker (`services/indexer.py`)
- BM25 + TF-IDF retriever (`services/retriever.py`)
- spaCy knowledge graph (`services/knowledge_graph.py`)
- LLM synthesizer with citations (`services/synthesizer.py`)
- CoVe verification + Critic evaluator (`services/verifier.py`, `services/evaluator.py`)
- Refiner loop (`services/refiner.py`)
- Research Gate cost router (`services/research_gate.py`)
- Safety Guard (`services/safety_guard.py`)
- Model Router (`services/model_router.py`)
- SSE event streaming (`services/event_bus.py`)
- WorkOS JWT auth (`app/auth.py`)
- Per-request BYOAPI key overrides (`app/user_keys.py`)
- Full Next.js frontend: chat interface, trace timeline, report viewer, sources panel
- WorkOS auth flow (sign-in, sign-up, callback, middleware)
- Settings page with API key management
- ResearchInput with voice, file upload, URL grounding
- TTS / STT / Vision endpoints

### What Is MISSING (Your Job)
In priority order:
1. **Dense embeddings + pgvector** — NO embedding code exists anywhere
2. **user_id in PostgreSQL runs table** — multi-tenancy broken
3. **Reranker** — Cohere key exists in config but zero integration code
4. **Persistent memory system** — no cross-session learning at all
5. **History page** — deleted from frontend
6. **Frontend: sources page, memory page, confidence badge, progress UI**

---

## 1. HARD CONSTRAINTS — Non-Negotiable

### Leapcell Deployment Budget (~500MB max)
The backend deploys to Leapcell (512MB free tier). These constraints are ABSOLUTE:

**DO NOT install:**
- `torch` / `torchvision` / `torchaudio` — adds 300MB, will break deployment
- `sentence-transformers` — requires torch
- `tensorflow` / `jax` — same problem
- `cohere` SDK — user has no Cohere API key

**USE INSTEAD:**
- `fastembed` — ONNX-based embeddings, ~50MB, no torch, same BAAI/bge models
- `flashrank` — ONNX-based reranker, ~30MB, no API key needed
- `pgvector` — PostgreSQL extension for vector storage (already likely available on Neon/Supabase/Railway)

**Remove from requirements.txt:**
- `scikit-learn` (implicit — used in retriever for TF-IDF; once dense retrieval is added, BM25+dense replaces BM25+TF-IDF, making TF-IDF redundant)
- Do NOT remove `numpy` — still needed by fastembed and rank-bm25

### No New API Keys Required
Only keys available: `GROQ_API_KEY`, `TAVILY_API_KEY`, `DATABASE_URL` (MongoDB), `WORKOS_*`
Optional existing: `SEMANTIC_SCHOLAR_API_KEY`, `BRIGHTDATA_API_KEY`, `REDIS_URL`
User has NO: Cohere, OpenAI, Pinecone, Weaviate, HuggingFace token

### Database
- **PostgreSQL** = existing Neon/Supabase instance (from `DATABASE_URL` in alembic.ini)
- **MongoDB Atlas** = existing cluster (from `DATABASE_URL` env var, mongodb+srv:// format)
- These are different URLs. Check `apps/api/app/db/database.py` for Postgres URL, `apps/api/app/db/mongo.py` for Mongo URL
- Alembic manages PostgreSQL migrations. Always create new migration files, never edit existing ones.

---

## 2. FINAL REQUIREMENTS.TXT

Replace `apps/api/requirements.txt` with exactly this:

```
# Core API
fastapi==0.115.0
uvicorn[standard]==0.30.6
pydantic>=2.11.0,<3
pydantic-settings>=2.7.0,<3
python-dotenv==1.0.1
python-multipart==0.0.12
sse-starlette==2.1.3
aiofiles==24.1.0

# Database — PostgreSQL
sqlalchemy[asyncio]==2.0.35
psycopg[binary]>=3.2.3,<4
alembic==1.13.2
pgvector>=0.3.0

# Database — MongoDB
pymongo==4.10.1

# HTTP
httpx==0.27.2
certifi>=2024.8.30

# LLM
groq>=1.0.0

# Search
tavily-python==0.5.0
feedparser==6.0.11

# Document processing
trafilatura==1.12.2
pypdf==5.0.1

# Retrieval — lexical
rank-bm25==0.2.2
numpy==1.26.4

# Retrieval — semantic (ONNX, no torch)
fastembed>=0.3.6

# Reranking (ONNX, no API key)
flashrank>=0.2.9

# NLP — Knowledge Graph
spacy>=3.7.0,<4

# Infra
redis==5.1.1
slowapi==0.1.9
tenacity==9.0.0
prometheus-client==0.21.0
python-jose[cryptography]>=3.3.0

# PDF generation
reportlab>=4.0.0
```

---

## 3. ENVIRONMENT VARIABLES TO ADD

Add these to `apps/api/app/config.py` (Settings class) and `apps/api/.env.example`:

```python
# Embeddings
EMBEDDING_DIMS: int = 384                          # BAAI/bge-small dims
EMBEDDING_MODEL: str = "BAAI/bge-small-en-v1.5"   # fastembed model name
EMBEDDING_CACHE_DIR: str = ".fastembed_cache"      # local model cache

# Reranker
RERANKER_MODEL: str = "ms-marco-MiniLM-L-12-v2"   # flashrank model
RERANKER_TOP_N: int = 10                           # chunks after rerank
RERANKER_ENABLED: bool = True

# Memory
MEMORY_ENABLED: bool = True
MEMORY_MAX_ENTRIES: int = 100      # per user
MEMORY_TOP_K: int = 5              # entries injected into planner

# Postgres URL (separate from MongoDB DATABASE_URL)
POSTGRES_URL: str = ""             # postgresql+psycopg://... (from alembic.ini)
```

---

## 4. PHASE 1 — Foundation Fixes

### 4A. Add user_id to PostgreSQL runs table

**File: `apps/api/app/db/models.py`**

Find the `Run` class and add:
```python
user_id = Column(String(128), nullable=True, index=True)
thread_id = Column(String(128), nullable=True, index=True)
gate_route = Column(String(32), nullable=True)
```
(thread_id and gate_route may already be in Mongo but not Postgres — add them here for parity)

**New file: `apps/api/alembic/versions/002_add_user_fields_to_runs.py`**

```python
"""add user fields to runs

Revision ID: 002
Revises: 001
Create Date: 2026-03-08
"""
from alembic import op
import sqlalchemy as sa

revision = '002'
down_revision = '001'
branch_labels = None
depends_on = None

def upgrade():
    op.add_column('runs', sa.Column('user_id', sa.String(128), nullable=True))
    op.add_column('runs', sa.Column('thread_id', sa.String(128), nullable=True))
    op.add_column('runs', sa.Column('gate_route', sa.String(32), nullable=True))
    op.create_index('ix_runs_user_id', 'runs', ['user_id'])
    op.create_index('ix_runs_thread_id', 'runs', ['thread_id'])

def downgrade():
    op.drop_index('ix_runs_user_id', 'runs')
    op.drop_index('ix_runs_thread_id', 'runs')
    op.drop_column('runs', 'user_id')
    op.drop_column('runs', 'thread_id')
    op.drop_column('runs', 'gate_route')
```

**File: `apps/api/app/api/v1/runs.py`**

When creating a Run ORM object, pass `user_id=user_id` (extracted from JWT), `thread_id=body.thread_id`, and later `gate_route=gate_result.route`.

**File: `apps/api/app/services/orchestrator.py`**

Add `user_id: str | None = None` parameter to the `run()` method. Store it in state dict as `state['user_id'] = user_id`. Pass it to MemoryService in Phase 4.

### 4B. Dual-DB Clarification (Code Comment + Cleanup)

MongoDB = fast metadata queries (status, list, stream). PostgreSQL = full artifact store (documents, chunks, citations, KG, claims, verification).

Add a comment block at the top of both `apps/api/app/db/mongo.py` and `apps/api/app/db/database.py` explaining this split. No code changes needed beyond what's already implemented — the split already works correctly. The confusion was architectural, not a code bug.

---

## 5. PHASE 2 — Dense Embeddings + Vector Retrieval

### 5A. New file: `apps/api/app/services/embedder.py`

```python
"""
EmbedderService — ONNX-based dense embeddings via fastembed.
No PyTorch. Runs on CPU. Model: BAAI/bge-small-en-v1.5 (384 dims).
Model is downloaded once on first use, cached to EMBEDDING_CACHE_DIR.
"""
from __future__ import annotations
import asyncio
from functools import lru_cache
from typing import List
from fastembed import TextEmbedding
from app.config import get_settings

settings = get_settings()

class EmbedderService:
    _instance: "EmbedderService | None" = None
    _model: TextEmbedding | None = None

    def __init__(self):
        # Lazy load — model downloads on first embed call
        self._model = None

    def _get_model(self) -> TextEmbedding:
        if self._model is None:
            self._model = TextEmbedding(
                model_name=settings.EMBEDDING_MODEL,
                cache_dir=settings.EMBEDDING_CACHE_DIR,
            )
        return self._model

    async def embed_texts(self, texts: List[str]) -> List[List[float]]:
        """Embed a batch of texts. Returns list of 384-dim vectors."""
        if not texts:
            return []
        loop = asyncio.get_event_loop()
        model = self._get_model()
        # Run in executor to avoid blocking event loop
        embeddings = await loop.run_in_executor(
            None, lambda: list(model.embed(texts))
        )
        return [e.tolist() for e in embeddings]

    async def embed_query(self, query: str) -> List[float]:
        """Embed a single query string."""
        results = await self.embed_texts([query])
        return results[0] if results else []


@lru_cache(maxsize=1)
def get_embedder() -> EmbedderService:
    return EmbedderService()
```

### 5B. Alembic migration for pgvector

**New file: `apps/api/alembic/versions/003_add_chunk_embeddings.py`**

```python
"""add vector embeddings to chunks

Revision ID: 003
Revises: 002
Create Date: 2026-03-08
"""
from alembic import op
import sqlalchemy as sa
from pgvector.sqlalchemy import Vector

revision = '003'
down_revision = '002'
branch_labels = None
depends_on = None

def upgrade():
    # Enable pgvector extension
    op.execute('CREATE EXTENSION IF NOT EXISTS vector')
    # Add embedding column to chunks
    op.add_column('chunks', sa.Column('embedding', Vector(384), nullable=True))
    # IVFFlat index for approximate nearest neighbour search
    # Use after table has data: CREATE INDEX CONCURRENTLY
    op.execute(
        'CREATE INDEX IF NOT EXISTS ix_chunks_embedding '
        'ON chunks USING ivfflat (embedding vector_cosine_ops) '
        'WITH (lists = 50)'
    )

def downgrade():
    op.execute('DROP INDEX IF EXISTS ix_chunks_embedding')
    op.drop_column('chunks', 'embedding')
```

**File: `apps/api/app/db/models.py`**

Add to `Chunk` class:
```python
from pgvector.sqlalchemy import Vector
# inside Chunk class:
embedding = Column(Vector(384), nullable=True)
```

### 5C. Embed after indexing

**File: `apps/api/app/services/indexer.py`**

After creating and persisting chunks, call the embedder:

```python
# At the end of the index_document() or equivalent method,
# after bulk-inserting chunks into the DB:

from app.services.embedder import get_embedder

async def _embed_and_store_chunks(self, session, chunk_objects, chunk_texts):
    """Compute embeddings and update chunk rows."""
    embedder = get_embedder()
    embeddings = await embedder.embed_texts(chunk_texts)
    for chunk_obj, embedding in zip(chunk_objects, embeddings):
        chunk_obj.embedding = embedding
    await session.commit()
```

Call `_embed_and_store_chunks` after the bulk insert. If embedding fails (model not loaded yet, first run), log warning and continue — retriever will fall back to BM25-only gracefully.

### 5D. Dense retrieval + RRF fusion

**File: `apps/api/app/services/retriever.py`**

Add these methods to the existing `RetrieverService` class:

```python
async def dense_retrieve(
    self,
    query: str,
    run_id: UUID,
    session,  # AsyncSession
    top_k: int = 20,
) -> list[Chunk]:
    """Semantic retrieval via pgvector cosine distance."""
    from app.services.embedder import get_embedder
    from app.db.models import Chunk
    from sqlalchemy import select, text

    embedder = get_embedder()
    query_vec = await embedder.embed_query(query)

    # pgvector cosine distance operator: <=>
    stmt = (
        select(Chunk)
        .where(
            Chunk.run_id == run_id,
            Chunk.embedding.isnot(None),
        )
        .order_by(Chunk.embedding.cosine_distance(query_vec))
        .limit(top_k)
    )
    result = await session.execute(stmt)
    return result.scalars().all()


def _reciprocal_rank_fusion(
    self,
    bm25_chunks: list,
    dense_chunks: list,
    k: int = 60,
) -> list:
    """Combine BM25 + dense results via RRF. Higher score = more relevant."""
    scores: dict[str, float] = {}
    chunk_map: dict[str, object] = {}

    for rank, chunk in enumerate(bm25_chunks):
        cid = str(chunk.id)
        scores[cid] = scores.get(cid, 0.0) + 1.0 / (k + rank + 1)
        chunk_map[cid] = chunk

    for rank, chunk in enumerate(dense_chunks):
        cid = str(chunk.id)
        scores[cid] = scores.get(cid, 0.0) + 1.0 / (k + rank + 1)
        chunk_map[cid] = chunk

    ranked_ids = sorted(scores, key=lambda x: scores[x], reverse=True)
    return [chunk_map[cid] for cid in ranked_ids]
```

Modify the main `retrieve()` or `retrieve_evidence()` method to:
1. Run existing BM25 retrieval (keep as-is, rename to `_bm25_retrieve`)
2. Call `dense_retrieve()`
3. Call `_reciprocal_rank_fusion()` to merge
4. Return fused results

If `dense_retrieve` fails (e.g., no embeddings stored yet), log warning and return BM25 results only.

**REMOVE scikit-learn TF-IDF**: Once RRF fusion is in place, the TF-IDF component is replaced by the dense vector leg. Remove sklearn imports and TF-IDF scoring from `retriever.py`. Pure BM25 (rank-bm25) + dense (pgvector) + RRF is the new retrieval stack.

---

## 6. PHASE 3 — Reranker (flashrank, no API key)

### 6A. New file: `apps/api/app/services/reranker.py`

```python
"""
RerankerService — ONNX cross-encoder reranker via flashrank.
No API key. No PyTorch. Model downloaded once, cached locally.
Model: ms-marco-MiniLM-L-12-v2 (~80MB ONNX)
"""
from __future__ import annotations
import asyncio
from functools import lru_cache
from dataclasses import dataclass
from app.config import get_settings

settings = get_settings()

@dataclass
class RankedChunk:
    text: str
    score: float
    original_chunk: object  # The ORM Chunk object


class RerankerService:
    _ranker = None

    def _get_ranker(self):
        if self._ranker is None:
            from flashrank import Ranker
            self._ranker = Ranker(
                model_name=settings.RERANKER_MODEL,
                cache_dir=".flashrank_cache",
            )
        return self._ranker

    async def rerank(
        self,
        query: str,
        chunks: list,  # list of Chunk ORM objects with .chunk_text
        top_n: int | None = None,
    ) -> list:
        """
        Rerank chunks by cross-encoder relevance to query.
        Returns top_n chunks (or RERANKER_TOP_N from settings) ordered by relevance.
        Falls back to original order if reranker fails.
        """
        if not chunks or not settings.RERANKER_ENABLED:
            return chunks

        top_n = top_n or settings.RERANKER_TOP_N

        try:
            from flashrank import RerankRequest
            ranker = self._get_ranker()

            passages = [{"text": c.chunk_text[:512]} for c in chunks]
            request = RerankRequest(query=query, passages=passages)

            loop = asyncio.get_event_loop()
            results = await loop.run_in_executor(
                None, lambda: ranker.rerank(request)
            )

            # results is list of dicts with 'index' and 'score'
            reranked = sorted(results, key=lambda r: r["score"], reverse=True)
            return [chunks[r["index"]] for r in reranked[:top_n]]

        except Exception as e:
            # Never crash the pipeline for reranker failure
            import logging
            logging.getLogger(__name__).warning(f"Reranker failed, using original order: {e}")
            return chunks[:top_n]


@lru_cache(maxsize=1)
def get_reranker() -> RerankerService:
    return RerankerService()
```

### 6B. Wire reranker into orchestrator

**File: `apps/api/app/services/orchestrator.py`**

After the `RETRIEVE_EVIDENCE` state handler completes (evidence list built), before `KG_EXTRACT`, add reranking:

```python
# In the RETRIEVE_EVIDENCE → KG_EXTRACT transition:
from app.services.reranker import get_reranker

reranker = get_reranker()
# evidence is list of chunk objects at this point
state['evidence'] = await reranker.rerank(
    query=state['query'],
    chunks=state['evidence'],
    top_n=settings.RERANKER_TOP_N,
)
```

Add a new orchestrator state `RERANK` between `RETRIEVE_EVIDENCE` and `KG_EXTRACT` if the state machine makes that clean. Otherwise, inline it in `RETRIEVE_EVIDENCE` handler.

---

## 7. PHASE 4 — Persistent Memory System

### 7A. New SQLAlchemy models

**File: `apps/api/app/db/models.py`** — append these classes:

```python
class ResearchSession(Base):
    """Groups related runs by thread/topic for a user."""
    __tablename__ = "research_sessions"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    user_id = Column(String(128), nullable=False, index=True)
    thread_id = Column(String(128), nullable=True, unique=True, index=True)
    title = Column(String(512), nullable=True)          # Auto from first query
    topic_tags = Column(ARRAY(String), nullable=True)   # e.g. ["AI", "research"]
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow)
    updated_at = Column(DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow)


class TrustedSource(Base):
    """Domains/URLs the agent has found reliable across runs."""
    __tablename__ = "trusted_sources"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    user_id = Column(String(128), nullable=True, index=True)   # None = global
    domain = Column(String(255), nullable=False, index=True)
    trust_score = Column(Float, nullable=False, default=0.7)   # 0.0–1.0
    times_cited = Column(Integer, nullable=False, default=0)
    times_contradicted = Column(Integer, nullable=False, default=0)
    topics = Column(ARRAY(String), nullable=True)
    reason = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow)
    updated_at = Column(DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow)


class MemoryEntry(Base):
    """Semantic memory: facts, learnings, decisions extracted from past runs."""
    __tablename__ = "memory_entries"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    user_id = Column(String(128), nullable=False, index=True)
    entry_type = Column(
        String(32), nullable=False
    )  # 'fact' | 'decision' | 'source_quality' | 'query_pattern'
    content = Column(Text, nullable=False)
    embedding = Column(Vector(384), nullable=True)      # For semantic search
    run_id = Column(UUID(as_uuid=True), ForeignKey("runs.id", ondelete="SET NULL"), nullable=True, index=True)
    access_count = Column(Integer, nullable=False, default=0)
    relevance_score = Column(Float, nullable=False, default=0.5)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow)
    last_accessed = Column(DateTime(timezone=True), nullable=True)


class QueryLog(Base):
    """Log of research queries with quality scores for learning."""
    __tablename__ = "query_logs"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    user_id = Column(String(128), nullable=False, index=True)
    original_query = Column(Text, nullable=False)
    sub_questions = Column(ARRAY(String), nullable=True)
    search_queries = Column(ARRAY(String), nullable=True)
    success_score = Column(Float, nullable=True)        # From evaluator overall score
    run_id = Column(UUID(as_uuid=True), ForeignKey("runs.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow)
```

### 7B. Alembic migration for memory

**New file: `apps/api/alembic/versions/004_memory_system.py`**

```python
"""add memory system tables

Revision ID: 004
Revises: 003
Create Date: 2026-03-08
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID, ARRAY
from pgvector.sqlalchemy import Vector

revision = '004'
down_revision = '003'
branch_labels = None
depends_on = None

def upgrade():
    op.create_table(
        'research_sessions',
        sa.Column('id', UUID(as_uuid=True), primary_key=True),
        sa.Column('user_id', sa.String(128), nullable=False, index=True),
        sa.Column('thread_id', sa.String(128), nullable=True, unique=True),
        sa.Column('title', sa.String(512), nullable=True),
        sa.Column('topic_tags', ARRAY(sa.String), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True)),
        sa.Column('updated_at', sa.DateTime(timezone=True)),
    )
    op.create_index('ix_research_sessions_user_id', 'research_sessions', ['user_id'])
    op.create_index('ix_research_sessions_thread_id', 'research_sessions', ['thread_id'])

    op.create_table(
        'trusted_sources',
        sa.Column('id', UUID(as_uuid=True), primary_key=True),
        sa.Column('user_id', sa.String(128), nullable=True),
        sa.Column('domain', sa.String(255), nullable=False),
        sa.Column('trust_score', sa.Float, nullable=False, server_default='0.7'),
        sa.Column('times_cited', sa.Integer, nullable=False, server_default='0'),
        sa.Column('times_contradicted', sa.Integer, nullable=False, server_default='0'),
        sa.Column('topics', ARRAY(sa.String), nullable=True),
        sa.Column('reason', sa.Text, nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True)),
        sa.Column('updated_at', sa.DateTime(timezone=True)),
    )
    op.create_index('ix_trusted_sources_user_id', 'trusted_sources', ['user_id'])
    op.create_index('ix_trusted_sources_domain', 'trusted_sources', ['domain'])

    op.create_table(
        'memory_entries',
        sa.Column('id', UUID(as_uuid=True), primary_key=True),
        sa.Column('user_id', sa.String(128), nullable=False),
        sa.Column('entry_type', sa.String(32), nullable=False),
        sa.Column('content', sa.Text, nullable=False),
        sa.Column('embedding', Vector(384), nullable=True),
        sa.Column('run_id', UUID(as_uuid=True), sa.ForeignKey('runs.id', ondelete='SET NULL'), nullable=True),
        sa.Column('access_count', sa.Integer, nullable=False, server_default='0'),
        sa.Column('relevance_score', sa.Float, nullable=False, server_default='0.5'),
        sa.Column('created_at', sa.DateTime(timezone=True)),
        sa.Column('last_accessed', sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index('ix_memory_entries_user_id', 'memory_entries', ['user_id'])
    op.execute(
        'CREATE INDEX IF NOT EXISTS ix_memory_entries_embedding '
        'ON memory_entries USING ivfflat (embedding vector_cosine_ops) '
        'WITH (lists = 20)'
    )

    op.create_table(
        'query_logs',
        sa.Column('id', UUID(as_uuid=True), primary_key=True),
        sa.Column('user_id', sa.String(128), nullable=False),
        sa.Column('original_query', sa.Text, nullable=False),
        sa.Column('sub_questions', ARRAY(sa.String), nullable=True),
        sa.Column('search_queries', ARRAY(sa.String), nullable=True),
        sa.Column('success_score', sa.Float, nullable=True),
        sa.Column('run_id', UUID(as_uuid=True), sa.ForeignKey('runs.id', ondelete='SET NULL'), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True)),
    )
    op.create_index('ix_query_logs_user_id', 'query_logs', ['user_id'])

def downgrade():
    op.drop_table('query_logs')
    op.drop_table('memory_entries')
    op.drop_table('trusted_sources')
    op.drop_table('research_sessions')
```

### 7C. New file: `apps/api/app/services/memory.py`

```python
"""
MemoryService — persistent cross-session memory for the research agent.

Responsibilities:
1. retrieve_context(query, user_id) — called in INTAKE state
   → semantic search over memory_entries
   → returns trusted sources + past query patterns + key facts
   → formats as context string for planner prompt injection

2. store_run_memory(run_id, user_id, state) — called in FINALIZE state
   → stores trusted sources from high-citation domains
   → stores successful query patterns (if eval score > 0.7)
   → stores key facts from verified claims
   → logs the query for future learning
"""
from __future__ import annotations
import logging
from datetime import datetime, timezone
from uuid import uuid4
from typing import Optional
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.db.models import MemoryEntry, TrustedSource, QueryLog
from app.services.embedder import get_embedder
from app.config import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()


class MemoryService:

    async def retrieve_context(
        self,
        query: str,
        user_id: str | None,
        session: AsyncSession,
        top_k: int | None = None,
    ) -> str:
        """
        Retrieve relevant memory for a query. Returns formatted context string.
        Returns empty string if memory disabled or user_id is None (anonymous).
        """
        if not settings.MEMORY_ENABLED or not user_id:
            return ""

        top_k = top_k or settings.MEMORY_TOP_K
        context_parts = []

        try:
            # 1. Semantic search over memory entries
            embedder = get_embedder()
            query_vec = await embedder.embed_query(query)

            stmt = (
                select(MemoryEntry)
                .where(
                    MemoryEntry.user_id == user_id,
                    MemoryEntry.embedding.isnot(None),
                )
                .order_by(MemoryEntry.embedding.cosine_distance(query_vec))
                .limit(top_k)
            )
            result = await session.execute(stmt)
            entries = result.scalars().all()

            if entries:
                facts = [e.content for e in entries]
                context_parts.append(
                    "RELEVANT MEMORY FROM PAST RESEARCH:\n" +
                    "\n".join(f"- {f}" for f in facts)
                )
                # Update access metadata
                for e in entries:
                    e.access_count += 1
                    e.last_accessed = datetime.now(timezone.utc)
                await session.commit()

            # 2. Trusted sources for this user
            trusted_stmt = (
                select(TrustedSource)
                .where(
                    (TrustedSource.user_id == user_id) |
                    (TrustedSource.user_id.is_(None))
                )
                .order_by(TrustedSource.trust_score.desc())
                .limit(10)
            )
            trusted_result = await session.execute(trusted_stmt)
            trusted = trusted_result.scalars().all()

            if trusted:
                domains = [f"{t.domain} (trust: {t.trust_score:.1f})" for t in trusted]
                context_parts.append(
                    "TRUSTED SOURCES (prefer these):\n" +
                    ", ".join(domains)
                )

        except Exception as e:
            logger.warning(f"Memory retrieval failed: {e}")
            return ""

        return "\n\n".join(context_parts)

    async def store_run_memory(
        self,
        run_id,
        user_id: str | None,
        state: dict,
        session: AsyncSession,
    ) -> None:
        """
        Extract and persist learnings from a completed run.
        Called after FINALIZE. Never raises — memory failure must not break the pipeline.
        """
        if not settings.MEMORY_ENABLED or not user_id:
            return

        try:
            embedder = get_embedder()

            # 1. Store verified claims as facts
            verification = state.get("verification_result", {})
            claims = verification.get("claims", []) if isinstance(verification, dict) else []
            facts_to_store = [
                c.get("text", "") for c in claims
                if isinstance(c, dict) and c.get("verification_status") == "VERIFIED"
            ][:5]  # Max 5 facts per run

            if facts_to_store:
                embeddings = await embedder.embed_texts(facts_to_store)
                for content, embedding in zip(facts_to_store, embeddings):
                    entry = MemoryEntry(
                        id=uuid4(),
                        user_id=user_id,
                        entry_type="fact",
                        content=content,
                        embedding=embedding,
                        run_id=run_id,
                        relevance_score=0.7,
                        created_at=datetime.now(timezone.utc),
                    )
                    session.add(entry)

            # 2. Store trusted sources (domains with 2+ citations)
            citations = state.get("citations", [])
            domain_counts: dict[str, int] = {}
            for c in citations:
                url = c.get("url", "") if isinstance(c, dict) else getattr(c, "url", "")
                if url:
                    from urllib.parse import urlparse
                    domain = urlparse(url).netloc.replace("www.", "")
                    if domain:
                        domain_counts[domain] = domain_counts.get(domain, 0) + 1

            for domain, count in domain_counts.items():
                if count >= 2:
                    # Upsert trusted source
                    existing = await session.execute(
                        select(TrustedSource).where(
                            TrustedSource.user_id == user_id,
                            TrustedSource.domain == domain,
                        )
                    )
                    existing = existing.scalar_one_or_none()
                    if existing:
                        existing.times_cited += count
                        existing.trust_score = min(1.0, existing.trust_score + 0.05)
                        existing.updated_at = datetime.now(timezone.utc)
                    else:
                        session.add(TrustedSource(
                            id=uuid4(),
                            user_id=user_id,
                            domain=domain,
                            trust_score=0.6,
                            times_cited=count,
                            created_at=datetime.now(timezone.utc),
                            updated_at=datetime.now(timezone.utc),
                        ))

            # 3. Log the query pattern if quality was good
            eval_result = state.get("eval_result", {})
            overall_score = (
                eval_result.get("overall", 0) if isinstance(eval_result, dict) else 0
            )
            if overall_score >= 0.7:
                plan = state.get("plan", {})
                all_queries = state.get("all_query_strings", [])
                session.add(QueryLog(
                    id=uuid4(),
                    user_id=user_id,
                    original_query=state.get("query", ""),
                    sub_questions=plan.get("sub_questions", []) if isinstance(plan, dict) else [],
                    search_queries=all_queries[:10],
                    success_score=overall_score,
                    run_id=run_id,
                    created_at=datetime.now(timezone.utc),
                ))

            await session.commit()
            logger.info(f"Stored memory for run {run_id}: {len(facts_to_store)} facts, {len(domain_counts)} domains")

        except Exception as e:
            logger.warning(f"Memory storage failed for run {run_id}: {e}")
            await session.rollback()
```

### 7D. Wire memory into orchestrator

**File: `apps/api/app/services/orchestrator.py`**

```python
# Import
from app.services.memory import MemoryService

# In __init__ or as a singleton:
self.memory_svc = MemoryService()

# In INTAKE state handler, after validation:
memory_context = await self.memory_svc.retrieve_context(
    query=query,
    user_id=state.get('user_id'),
    session=session,
)
state['memory_context'] = memory_context

# In PLAN state handler, inject memory_context into the TeamLeader prompt:
# Find where plan prompt is built in team_leader.py and add:
# if memory_context: prompt += f"\n\n{memory_context}"

# In FINALIZE state handler, before returning:
await self.memory_svc.store_run_memory(
    run_id=state['run_id'],
    user_id=state.get('user_id'),
    state=state,
    session=session,
)
```

**File: `apps/api/app/services/team_leader.py`**

In the prompt construction, add a memory context injection point:
```python
# In the prompt building section:
memory_section = ""
if memory_context := constraints.get("memory_context", ""):
    memory_section = f"\n\n{memory_context}\n\nUse the above memory to guide your research plan."

prompt = f"""[existing prompt]
{memory_section}
..."""
```

### 7E. Memory API endpoints

**New file: `apps/api/app/api/v1/memory.py`**

```python
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete
from app.db.database import get_session
from app.auth import get_current_user
from app.db.models import MemoryEntry, TrustedSource, QueryLog
from pydantic import BaseModel
from uuid import UUID

router = APIRouter(prefix="/v1/memory", tags=["memory"])


class TrustedSourceCreate(BaseModel):
    domain: str
    trust_score: float = 0.8
    reason: str | None = None


@router.get("/sources")
async def list_trusted_sources(
    user_id: str = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    stmt = select(TrustedSource).where(
        (TrustedSource.user_id == user_id) | (TrustedSource.user_id.is_(None))
    ).order_by(TrustedSource.trust_score.desc())
    result = await session.execute(stmt)
    sources = result.scalars().all()
    return {"sources": [
        {
            "id": str(s.id), "domain": s.domain,
            "trust_score": s.trust_score, "times_cited": s.times_cited,
            "reason": s.reason, "created_at": s.created_at.isoformat(),
        }
        for s in sources
    ]}


@router.post("/sources")
async def add_trusted_source(
    body: TrustedSourceCreate,
    user_id: str = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    from uuid import uuid4
    from datetime import datetime, timezone
    source = TrustedSource(
        id=uuid4(), user_id=user_id,
        domain=body.domain, trust_score=body.trust_score,
        reason=body.reason, times_cited=0,
        created_at=datetime.now(timezone.utc),
        updated_at=datetime.now(timezone.utc),
    )
    session.add(source)
    await session.commit()
    return {"id": str(source.id), "domain": source.domain}


@router.delete("/sources/{source_id}")
async def delete_trusted_source(
    source_id: UUID,
    user_id: str = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    result = await session.execute(
        select(TrustedSource).where(
            TrustedSource.id == source_id,
            TrustedSource.user_id == user_id,
        )
    )
    source = result.scalar_one_or_none()
    if not source:
        raise HTTPException(404, "Source not found")
    await session.delete(source)
    await session.commit()
    return {"deleted": True}


@router.get("/entries")
async def list_memory_entries(
    limit: int = 20,
    user_id: str = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    stmt = (
        select(MemoryEntry)
        .where(MemoryEntry.user_id == user_id)
        .order_by(MemoryEntry.created_at.desc())
        .limit(limit)
    )
    result = await session.execute(stmt)
    entries = result.scalars().all()
    return {"entries": [
        {
            "id": str(e.id), "entry_type": e.entry_type,
            "content": e.content, "relevance_score": e.relevance_score,
            "access_count": e.access_count,
            "created_at": e.created_at.isoformat(),
        }
        for e in entries
    ]}


@router.delete("/entries/{entry_id}")
async def delete_memory_entry(
    entry_id: UUID,
    user_id: str = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    result = await session.execute(
        select(MemoryEntry).where(
            MemoryEntry.id == entry_id,
            MemoryEntry.user_id == user_id,
        )
    )
    entry = result.scalar_one_or_none()
    if not entry:
        raise HTTPException(404, "Entry not found")
    await session.delete(entry)
    await session.commit()
    return {"deleted": True}


@router.get("/stats")
async def memory_stats(
    user_id: str = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    from sqlalchemy import func
    total_entries = await session.scalar(
        select(func.count()).where(MemoryEntry.user_id == user_id)
    )
    total_sources = await session.scalar(
        select(func.count()).where(TrustedSource.user_id == user_id)
    )
    total_queries = await session.scalar(
        select(func.count()).where(QueryLog.user_id == user_id)
    )
    return {
        "total_memory_entries": total_entries,
        "trusted_sources": total_sources,
        "logged_queries": total_queries,
    }
```

**Register in `apps/api/app/api/v1/__init__.py`:**
```python
from .memory import router as memory_router
router.include_router(memory_router)
```

---

## 8. PHASE 5 — Frontend: History, Sources, Memory Pages

### 8A. Restore History Page

**File: `apps/web/app/history/page.tsx`**

```typescript
'use client'

import { useEffect, useState } from 'react'
import { listRuns, deleteRun } from '@/lib/api'
import type { RunStatus } from '@/lib/types'
import Link from 'next/link'
import { Trash2, ExternalLink, Clock, ChevronRight } from 'lucide-react'

export default function HistoryPage() {
  const [runs, setRuns] = useState<RunStatus[]>([])
  const [loading, setLoading] = useState(true)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  useEffect(() => {
    listRuns(50, 0).then(r => { setRuns(r); setLoading(false) }).catch(() => setLoading(false))
  }, [])

  const handleDelete = async (id: string) => {
    setDeletingId(id)
    await deleteRun(id)
    setRuns(prev => prev.filter(r => r.id !== id))
    setDeletingId(null)
  }

  const statusColor = (s: string) => ({
    completed: 'text-emerald-500',
    running: 'text-blue-500',
    failed: 'text-red-500',
    pending: 'text-amber-500',
  }[s] || 'text-zinc-400')

  if (loading) return (
    <div className="flex items-center justify-center h-64 text-zinc-400">Loading history...</div>
  )

  return (
    <div className="max-w-4xl mx-auto px-6 py-10">
      <h1 className="text-2xl font-semibold text-zinc-900 dark:text-white mb-2">Research History</h1>
      <p className="text-sm text-zinc-500 mb-8">{runs.length} past research sessions</p>

      {runs.length === 0 && (
        <div className="text-center text-zinc-400 py-20">No research history yet.</div>
      )}

      <div className="space-y-2">
        {runs.map(run => (
          <div
            key={run.id}
            className="flex items-center gap-4 px-4 py-3 rounded-xl border border-black/[0.06] dark:border-white/[0.06] bg-white dark:bg-white/[0.03] hover:bg-zinc-50 dark:hover:bg-white/[0.05] transition-colors group"
          >
            <div className="flex-1 min-w-0">
              <Link href={`/runs/${run.id}`} className="flex items-center gap-2 group/link">
                <p className="text-sm font-medium text-zinc-900 dark:text-white truncate group-hover/link:text-orange-500 transition-colors">
                  {run.query}
                </p>
                <ChevronRight size={14} className="text-zinc-400 shrink-0 opacity-0 group-hover/link:opacity-100 transition-opacity" />
              </Link>
              <div className="flex items-center gap-3 mt-1">
                <span className={`text-xs font-medium ${statusColor(run.status)}`}>
                  {run.status}
                </span>
                <span className="text-xs text-zinc-400 flex items-center gap-1">
                  <Clock size={10} />
                  {new Date(run.created_at).toLocaleDateString('en-US', {
                    month: 'short', day: 'numeric', year: 'numeric',
                    hour: '2-digit', minute: '2-digit'
                  })}
                </span>
              </div>
            </div>
            <button
              onClick={() => handleDelete(run.id)}
              disabled={deletingId === run.id}
              className="p-2 rounded-lg text-zinc-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors opacity-0 group-hover:opacity-100"
            >
              <Trash2 size={14} />
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
```

### 8B. Sources Page

**New file: `apps/web/app/sources/page.tsx`**

Create a page that:
1. Calls `listRuns(20, 0)` to get recent runs
2. For each completed run, extracts `sources` from the result (or calls `getRun(id)` for details)
3. Deduplicates by domain, aggregates citation counts
4. Renders a table with: domain, reliability badge, citation count, first seen date, link to example URL
5. Reliability heuristic (reuse from `SourcesPanel.tsx`):
   - `.gov`, `.edu`, `arxiv.org`, `nature.com`, `pubmed.ncbi.nlm.nih.gov`, `scholar.google.com` = "reliable"
   - `.org`, `.int` = "moderate"
   - Everything else = "unverified"

Use the same styling patterns as `SourcesPanel.tsx`.

### 8C. Memory Page

**New file: `apps/web/app/memory/page.tsx`**

Calls `/v1/memory/sources`, `/v1/memory/entries`, `/v1/memory/stats` (requires auth).
Shows:
- Stats cards: total memories, trusted domains, logged queries
- Trusted Sources table: domain, trust score bar, times cited, delete button
- Memory Entries list: entry type badge, content preview, access count, created at, delete button
- If user not signed in: show "Sign in to view your research memory" message

### 8D. Sidebar navigation update

**File: `apps/web/components/Sidebar.tsx`**

Add navigation items for `/history`, `/sources`, `/memory` alongside the existing items.

### 8E. Confidence Score UI

**File: `apps/web/components/ReportViewer.tsx`**

At the top of the report (before the markdown body), add a confidence display:

```typescript
// If evaluation scores exist:
const overallPct = evaluation ? Math.round(evaluation.overall * 100) : null
const confidenceColor = overallPct
  ? overallPct >= 80 ? 'text-emerald-500' : overallPct >= 60 ? 'text-amber-500' : 'text-red-500'
  : 'text-zinc-400'

// Render:
{overallPct !== null && (
  <div className="flex items-center gap-4 mb-4 p-3 rounded-xl bg-zinc-50 dark:bg-white/[0.03] border border-black/[0.05] dark:border-white/[0.05]">
    <div className={`text-2xl font-bold ${confidenceColor}`}>{overallPct}%</div>
    <div className="flex-1 text-xs text-zinc-500 space-y-1">
      <div>Confidence Score</div>
      <div className="flex gap-3 flex-wrap">
        {[
          ['Groundedness', evaluation.accuracy],
          ['Coverage', evaluation.coverage],
          ['Citations', evaluation.citation_quality],
          ['Coherence', evaluation.coherence],
        ].map(([label, val]) => (
          <span key={label as string}>{label}: {Math.round((val as number) * 100)}%</span>
        ))}
      </div>
    </div>
  </div>
)}
```

### 8F. TraceTimeline progress bar

**File: `apps/web/components/TraceTimeline.tsx`**

Add a progress percentage based on current state:

```typescript
const STATE_PROGRESS: Record<string, number> = {
  intake: 5, plan: 15, wait_for_user: 20, search: 35,
  fetch_parse: 45, index: 50, retrieve: 60, rerank: 65,
  kg_extract: 70, synthesize: 80, verify: 88, evaluate: 92,
  refine: 75, finalize: 100, failed: 100,
}

// Render a thin progress bar above the timeline when run is active
const progress = STATE_PROGRESS[activeState] ?? 0
```

---

## 9. PHASE 6 — lib/api.ts additions

**File: `apps/web/lib/api.ts`**

Add these functions:

```typescript
// Memory API
export async function listTrustedSources() {
  return apiFetch('/v1/memory/sources')
}

export async function addTrustedSource(domain: string, trust_score = 0.8, reason?: string) {
  return apiFetch('/v1/memory/sources', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ domain, trust_score, reason }),
  })
}

export async function deleteTrustedSource(id: string) {
  return apiFetch(`/v1/memory/sources/${id}`, { method: 'DELETE' })
}

export async function listMemoryEntries(limit = 20) {
  return apiFetch(`/v1/memory/entries?limit=${limit}`)
}

export async function deleteMemoryEntry(id: string) {
  return apiFetch(`/v1/memory/entries/${id}`, { method: 'DELETE' })
}

export async function getMemoryStats() {
  return apiFetch('/v1/memory/stats')
}
```

---

## 10. COMPLETE FILE CHANGE LIST

### New Files (create from scratch)
```
apps/api/app/services/embedder.py
apps/api/app/services/reranker.py
apps/api/app/services/memory.py
apps/api/app/api/v1/memory.py
apps/api/alembic/versions/002_add_user_fields_to_runs.py
apps/api/alembic/versions/003_add_chunk_embeddings.py
apps/api/alembic/versions/004_memory_system.py
apps/web/app/history/page.tsx
apps/web/app/sources/page.tsx
apps/web/app/memory/page.tsx
```

### Modified Files (targeted edits only, do not rewrite)
```
apps/api/requirements.txt              → replace with final version from Section 2
apps/api/app/config.py                 → add embedding + memory + reranker settings
apps/api/app/db/models.py              → add user_id/thread_id to Run; add 4 new model classes
apps/api/app/services/orchestrator.py → add user_id param; wire memory in INTAKE + FINALIZE; add RERANK step
apps/api/app/services/retriever.py    → add dense_retrieve(); add _reciprocal_rank_fusion(); remove TF-IDF/sklearn
apps/api/app/services/indexer.py      → call embedder after chunk creation
apps/api/app/services/team_leader.py  → inject memory_context into planner prompt
apps/api/app/api/v1/__init__.py        → register memory router
apps/api/app/api/v1/runs.py            → pass user_id, thread_id, gate_route to Run ORM
apps/web/lib/api.ts                    → add memory API functions
apps/web/components/Sidebar.tsx        → add History, Sources, Memory nav items
apps/web/components/ReportViewer.tsx   → add confidence score display at top
apps/web/components/TraceTimeline.tsx  → add progress bar
```

---

## 11. IMPLEMENTATION RULES FOR THE AGENT

1. **Read before editing**: Always read the full content of a file before modifying it. Never guess at existing code structure.

2. **Never break existing functionality**: The orchestrator, SSE streaming, Tavily search, Groq LLM calls, WorkOS auth, and all existing UI all work. Your job is to add, not replace.

3. **Graceful degradation on all new features**: Every new service (embedder, reranker, memory) must catch exceptions and log warnings. If fastembed fails, retrieval falls back to BM25. If flashrank fails, chunks are returned in original order. If memory fails, research continues without context.

4. **Alembic migrations**: Never edit existing migration files. Always create new numbered files. Ensure `down_revision` chains correctly: `001 → 002 → 003 → 004`.

5. **No scikit-learn**: When removing TF-IDF from retriever.py, verify sklearn is not imported anywhere else before removing the package from requirements.txt.

6. **fastembed model download**: The BAAI/bge-small-en-v1.5 model downloads on first use (~130MB ONNX file). This is normal. It caches to `EMBEDDING_CACHE_DIR`. In production (Leapcell), use a persistent volume mount for this directory.

7. **flashrank model download**: ms-marco-MiniLM-L-12-v2 downloads on first use (~80MB). Cache to `.flashrank_cache`.

8. **pgvector must be enabled**: Migration 003 runs `CREATE EXTENSION IF NOT EXISTS vector`. This requires the PostgreSQL instance to have pgvector installed. Neon, Supabase, Railway, and most managed Postgres providers have it pre-installed. Verify before running migrations.

9. **State machine order matters**: In orchestrator.py, the state sequence after your changes should be:
   `INTAKE → PLAN → WAIT_FOR_USER → RESEARCH_LOOP → RETRIEVE_EVIDENCE → RERANK → KG_EXTRACT → SYNTHESIZE → VERIFY → [REFINE] → FINALIZE`

10. **Memory in INTAKE only**: Do not call `retrieve_context` in PLAN, VERIFY, or any other state. Only in INTAKE. Only store in FINALIZE.

11. **Frontend consistency**: Match the existing design language exactly — use the same Tailwind classes, same glass-panel styling, same dark: prefix pattern, same border colors (`border-black/[0.06] dark:border-white/[0.06]`), same orange accent color (`text-orange-500`, `bg-orange-500/10`).

12. **TypeScript types**: When adding new API response types (memory entries, trusted sources, stats), add them to `apps/web/lib/types.ts`.

---

## 12. VERIFICATION CHECKLIST

After implementation, verify each of these manually:

### Backend
- [ ] `alembic upgrade head` runs without errors through all 4 migrations
- [ ] `POST /v1/runs` with `{"query": "test"}` → response has `run_id`
- [ ] `GET /v1/runs/{id}/stream` → SSE events stream in with all states including `retrieve` and `rerank`
- [ ] After a FULL_RESEARCH run completes: `SELECT embedding FROM chunks WHERE run_id='...' LIMIT 1` → non-null vector
- [ ] `GET /v1/memory/sources` → returns JSON `{"sources": [...]}`
- [ ] `GET /v1/memory/stats` → returns `{"total_memory_entries": 0, ...}` on fresh DB
- [ ] Complete 1 full research run → `GET /v1/memory/entries` → returns at least 1 entry
- [ ] Complete 2 runs on same topic → second run's planner prompt contains memory context
- [ ] `requirements.txt` installs without error on Python 3.11: `pip install -r requirements.txt`
- [ ] Total installed size after `pip install`: `du -sh $(pip show fastembed | grep Location | awk '{print $2}')/../` < 500MB

### Frontend
- [ ] `/history` page loads and shows list of past runs
- [ ] `/sources` page loads without 500 error
- [ ] `/memory` page shows "sign in" message if not authenticated
- [ ] ReportViewer shows confidence score badge for completed research runs
- [ ] TraceTimeline shows a progress bar that fills as states advance
- [ ] Sidebar has History, Sources, Memory links that navigate correctly

---

## 13. WHAT NOT TO IMPLEMENT (Out of Scope)

Do not implement these in this session — they require infrastructure decisions beyond the current stack:

- Celery / ARQ worker queue (requires Redis broker setup)
- Playwright scraping (adds ~300MB chromium binary — Leapcell budget exceeded)
- BrightData integration (no API key)
- OpenTelemetry tracing (infra tooling concern)
- MongoDB Atlas Vector Search (pgvector covers memory search; Atlas Vector Search needs index setup in Atlas UI)
- LangGraph migration (custom FSM works fine; migration is a refactor not a feature)
- IndexedDB chat persistence (depends on WorkOS user object; auth flow needs audit first)

---

## 14. TECH REFERENCES

| Library | Docs | Notes |
|---------|------|-------|
| fastembed | `from fastembed import TextEmbedding` | `model.embed(texts)` returns generator of np.ndarray |
| pgvector SQLAlchemy | `from pgvector.sqlalchemy import Vector` | cosine_distance() method on column |
| flashrank | `from flashrank import Ranker, RerankRequest` | `ranker.rerank(request)` returns `[{"index": int, "score": float, "text": str}]` |
| WorkOS JWT user_id | `apps/api/app/auth.py` → `get_current_user()` → returns `str` user_id or raises 401 |
| Async SQLAlchemy session | `from app.db.database import get_session` → `AsyncSession` dependency |
| MongoDB client | `from app.db.mongo import MongoStore` → `store.runs` collection |
| SSE event emission | `await event_callback(state_name, message, payload_dict)` |
| Groq LLM call | `await self.llm.complete_json(prompt, task_type="memory")` |
| Orchestrator state dict | `TypedDict` — add new keys freely, they persist across state transitions |

---

## 15. CRITICAL ADDITION — Full User Context & Memory (The Main Purpose)

> **This section is the primary goal of the memory system.** The brief above covers the scaffolding, but the actual requirement is deeper: when a user returns and asks a follow-up or related question, the agent must behave as if it *remembers everything it has ever researched for that user*. This section specifies what was missing.

### What Was Missing from Phase 4

The original spec's critical requirement was:
> The agent must support **persistent context and memory**. Store: previous queries, research traces, retrieved documents, citations, trusted sources, reasoning outputs, agent decisions.

Phase 4 only stores individual verified facts and domain trust scores. **It does not store**:
- A summary of what was concluded in a past run (the "big picture" context)
- The agent's reasoning trace (what it planned, what failed, what was refined and why)
- Previously fetched document content (enabling deduplication — don't re-fetch the same URL)
- The full conversation context between user and agent across sessions
- MongoDB storage (spec says "memory must persist in MongoDB")

---

### 15A. Run Summary (Most Important Missing Piece)

After every FULL_RESEARCH run that passes evaluation, generate and store a 3–5 sentence human-readable summary of what was found. This is what gets injected into future runs on similar topics.

**Add to `ResearchSession` model** (`apps/api/app/db/models.py`):
```python
class ResearchSession(Base):
    __tablename__ = "research_sessions"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    user_id = Column(String(128), nullable=False, index=True)
    thread_id = Column(String(128), nullable=True, unique=True, index=True)
    title = Column(String(512), nullable=True)
    topic_tags = Column(ARRAY(String), nullable=True)
    # ADD THESE:
    summary = Column(Text, nullable=True)              # LLM-generated 3-5 sentence summary
    main_findings = Column(ARRAY(String), nullable=True)  # Bullet list of key conclusions
    key_entities = Column(ARRAY(String), nullable=True)   # People/orgs/concepts mentioned
    best_sources = Column(ARRAY(String), nullable=True)   # Top 3 most-cited URLs
    overall_score = Column(Float, nullable=True)          # Evaluator score from run
    run_count = Column(Integer, nullable=False, default=1)
    last_run_id = Column(UUID(as_uuid=True), nullable=True)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow)
    updated_at = Column(DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow)
```

**Add to Alembic migration 004** (or create 005):
```sql
ALTER TABLE research_sessions ADD COLUMN summary TEXT;
ALTER TABLE research_sessions ADD COLUMN main_findings TEXT[];
ALTER TABLE research_sessions ADD COLUMN key_entities TEXT[];
ALTER TABLE research_sessions ADD COLUMN best_sources TEXT[];
ALTER TABLE research_sessions ADD COLUMN overall_score FLOAT;
ALTER TABLE research_sessions ADD COLUMN run_count INTEGER DEFAULT 1;
ALTER TABLE research_sessions ADD COLUMN last_run_id UUID;
```

**Add `_generate_run_summary()` to `MemoryService`** (`apps/api/app/services/memory.py`):
```python
async def _generate_run_summary(self, state: dict) -> dict:
    """
    Use the fast LLM to generate a concise summary of what was researched and found.
    Called from store_run_memory() before persisting.
    """
    report_md = state.get("report_md", "")
    if not report_md or len(report_md) < 200:
        return {}

    # Truncate to first 3000 chars for efficiency
    truncated = report_md[:3000]
    query = state.get("query", "")

    prompt = f"""Summarize this research report in exactly 3 sentences.
Query researched: {query}

Report (excerpt):
{truncated}

Respond with JSON:
{{
  "summary": "3-sentence plain English summary of what was found",
  "main_findings": ["finding 1", "finding 2", "finding 3"],
  "key_entities": ["entity1", "entity2", "entity3"]
}}"""

    try:
        result = await self.llm.complete_json(prompt, task_type="memory")
        return result if isinstance(result, dict) else {}
    except Exception:
        return {}
```

**Add `_upsert_research_session()` to `MemoryService`**:
```python
async def _upsert_research_session(
    self, run_id, user_id: str, state: dict, session: AsyncSession, summary_data: dict
) -> None:
    """Create or update the ResearchSession for this thread."""
    thread_id = state.get("thread_id") or str(run_id)

    # Extract best sources (most-cited domains)
    citations = state.get("citations", [])
    from collections import Counter
    from urllib.parse import urlparse
    url_counts = Counter()
    for c in citations:
        url = c.get("url", "") if isinstance(c, dict) else getattr(c, "url", "")
        if url:
            url_counts[url] += 1
    best_sources = [url for url, _ in url_counts.most_common(3)]

    existing = await session.execute(
        select(ResearchSession).where(ResearchSession.thread_id == thread_id)
    )
    existing = existing.scalar_one_or_none()

    eval_result = state.get("eval_result", {})
    score = eval_result.get("overall", None) if isinstance(eval_result, dict) else None

    plan = state.get("plan", {})
    tags = plan.get("focus_areas", []) if isinstance(plan, dict) else []

    if existing:
        # Update existing session
        existing.run_count += 1
        existing.last_run_id = run_id
        existing.updated_at = datetime.now(timezone.utc)
        if summary_data.get("summary"):
            existing.summary = summary_data["summary"]
        if summary_data.get("main_findings"):
            existing.main_findings = summary_data["main_findings"]
        if summary_data.get("key_entities"):
            existing.key_entities = summary_data["key_entities"]
        if best_sources:
            existing.best_sources = best_sources
        if score is not None:
            existing.overall_score = score
    else:
        # Create new session
        query = state.get("query", "")
        title = query[:100] if query else "Research Session"
        session.add(ResearchSession(
            id=uuid4(),
            user_id=user_id,
            thread_id=thread_id,
            title=title,
            topic_tags=tags[:5],
            summary=summary_data.get("summary"),
            main_findings=summary_data.get("main_findings", []),
            key_entities=summary_data.get("key_entities", []),
            best_sources=best_sources,
            overall_score=score,
            run_count=1,
            last_run_id=run_id,
            created_at=datetime.now(timezone.utc),
            updated_at=datetime.now(timezone.utc),
        ))
```

**Update `store_run_memory()` to call both**:
```python
async def store_run_memory(self, run_id, user_id, state, session):
    # ... existing facts/sources/querylog code ...

    # ADD AT END (before final commit):
    summary_data = await self._generate_run_summary(state)
    await self._upsert_research_session(run_id, user_id, state, session, summary_data)
    await session.commit()
```

---

### 15B. Reasoning Trace Storage

The agent must remember WHY it made decisions — what it tried, what failed, what it refined. This is stored per-run and injected into future runs on similar topics to avoid repeating failed strategies.

**Add to `MemoryEntry` entry_type values** (no schema change needed — just document it):
```
entry_type values:
  'fact'             → a verified factual claim from a run
  'decision'         → an agent decision: "Refined query because first search returned no academic sources"
  'source_quality'   → "arxiv.org returned high-quality papers on topic X"
  'query_pattern'    → "For queries about X, sub-question decomposition Y works well"
  'contradiction'    → "Source A contradicts Source B on claim Z"
  'failure'          → "Search query X returned no useful results for topic Y"
```

**Add `_store_reasoning_trace()` to `MemoryService`**:
```python
async def _store_reasoning_trace(
    self, run_id, user_id: str, state: dict, session: AsyncSession
) -> None:
    """Store agent decisions and reasoning from this run as memory entries."""
    embedder = get_embedder()
    entries_to_embed = []

    # 1. Store refinement decisions
    iteration = state.get("iteration", 0)
    if iteration > 1:
        entries_to_embed.append({
            "entry_type": "decision",
            "content": f"For query '{state.get('query', '')[:80]}': required {iteration} refinement iterations. "
                       f"Initial evidence was insufficient; additional searches improved coverage.",
        })

    # 2. Store contradiction findings
    verification = state.get("verification_result", {})
    contradictions = verification.get("contradiction_count", 0) if isinstance(verification, dict) else 0
    if contradictions > 0:
        entries_to_embed.append({
            "entry_type": "contradiction",
            "content": f"Research on '{state.get('query', '')[:80]}' found {contradictions} contradicting claims. "
                       f"Cross-check sources carefully on this topic.",
        })

    # 3. Store failed queries
    steering_notes = state.get("steering_notes", "")
    if steering_notes and isinstance(steering_notes, str) and len(steering_notes) > 10:
        entries_to_embed.append({
            "entry_type": "decision",
            "content": f"User steering applied during research: {steering_notes[:200]}",
        })

    if not entries_to_embed:
        return

    texts = [e["content"] for e in entries_to_embed]
    try:
        embeddings = await embedder.embed_texts(texts)
        for entry_data, embedding in zip(entries_to_embed, embeddings):
            session.add(MemoryEntry(
                id=uuid4(),
                user_id=user_id,
                entry_type=entry_data["entry_type"],
                content=entry_data["content"],
                embedding=embedding,
                run_id=run_id,
                relevance_score=0.6,
                created_at=datetime.now(timezone.utc),
            ))
    except Exception as e:
        logger.warning(f"Failed to store reasoning trace: {e}")
```

Call this from `store_run_memory()` alongside the facts storage.

---

### 15C. Document Deduplication via Memory

Before fetching a URL, check if it was already fetched in a previous run for this user. This saves Tavily credits and fetch time.

**File: `apps/api/app/services/fetcher.py`**

Add a `_is_already_fetched()` check:
```python
async def is_already_fetched(self, url: str, session) -> tuple[bool, str | None]:
    """
    Check if this URL was fetched in a previous run (any user — documents are shared).
    Returns (already_fetched, clean_text).
    """
    from app.db.models import Document
    from sqlalchemy import select
    import hashlib

    # Check by URL
    result = await session.execute(
        select(Document).where(Document.url == url).limit(1)
    )
    doc = result.scalar_one_or_none()
    if doc and doc.clean_text and len(doc.clean_text) > 200:
        return True, doc.clean_text
    return False, None
```

Call this at the start of `fetch_url()` — if already fetched, return cached content immediately without HTTP request.

---

### 15D. Full Context Injection for Follow-Up Queries

The most important piece: when a user asks a follow-up or related question, the agent must inject **full session context** — not just bullet facts, but the previous run's summary, conclusions, and what was left unresolved.

**Update `retrieve_context()` in `memory.py`** — add session summary retrieval:

```python
async def retrieve_context(self, query, user_id, session, top_k=None):
    """
    Returns a rich context string containing:
    1. Relevant past run summaries (semantic similarity to current query)
    2. Individual verified facts
    3. Trusted sources
    4. Unresolved questions / gaps from past runs
    """
    if not settings.MEMORY_ENABLED or not user_id:
        return ""

    context_parts = []
    embedder = get_embedder()
    query_vec = await embedder.embed_query(query)

    # --- SECTION 1: Past research summaries (highest priority) ---
    # Find ResearchSessions whose topic is similar to current query
    # Use key_entities overlap as a proxy (no embedding on sessions yet)
    sessions_stmt = (
        select(ResearchSession)
        .where(
            ResearchSession.user_id == user_id,
            ResearchSession.summary.isnot(None),
        )
        .order_by(ResearchSession.updated_at.desc())
        .limit(3)
    )
    past_sessions = (await session.execute(sessions_stmt)).scalars().all()

    if past_sessions:
        summaries = []
        for s in past_sessions:
            if s.summary:
                summaries.append(
                    f"Topic: {s.title}\n"
                    f"Summary: {s.summary}\n"
                    f"Key findings: {'; '.join((s.main_findings or [])[:3])}\n"
                    f"Best sources: {', '.join((s.best_sources or [])[:2])}"
                )
        if summaries:
            context_parts.append(
                "PREVIOUS RESEARCH SESSIONS:\n" +
                "\n---\n".join(summaries)
            )

    # --- SECTION 2: Semantic memory facts (same as before) ---
    entries_stmt = (
        select(MemoryEntry)
        .where(
            MemoryEntry.user_id == user_id,
            MemoryEntry.embedding.isnot(None),
            MemoryEntry.entry_type == 'fact',
        )
        .order_by(MemoryEntry.embedding.cosine_distance(query_vec))
        .limit(top_k or settings.MEMORY_TOP_K)
    )
    entries = (await session.execute(entries_stmt)).scalars().all()
    if entries:
        context_parts.append(
            "RELEVANT FACTS FROM PAST RESEARCH:\n" +
            "\n".join(f"• {e.content}" for e in entries)
        )

    # --- SECTION 3: Agent decisions / reasoning patterns ---
    decisions_stmt = (
        select(MemoryEntry)
        .where(
            MemoryEntry.user_id == user_id,
            MemoryEntry.embedding.isnot(None),
            MemoryEntry.entry_type.in_(['decision', 'contradiction', 'failure']),
        )
        .order_by(MemoryEntry.embedding.cosine_distance(query_vec))
        .limit(3)
    )
    decisions = (await session.execute(decisions_stmt)).scalars().all()
    if decisions:
        context_parts.append(
            "AGENT REASONING FROM PAST RESEARCH:\n" +
            "\n".join(f"• {e.content}" for e in decisions)
        )

    # --- SECTION 4: Trusted sources ---
    trusted_stmt = (
        select(TrustedSource)
        .where(
            (TrustedSource.user_id == user_id) | (TrustedSource.user_id.is_(None))
        )
        .order_by(TrustedSource.trust_score.desc())
        .limit(8)
    )
    trusted = (await session.execute(trusted_stmt)).scalars().all()
    if trusted:
        context_parts.append(
            "TRUSTED SOURCES (prioritize these in search):\n" +
            ", ".join(f"{t.domain} ({t.times_cited} citations)" for t in trusted)
        )

    return "\n\n".join(context_parts) if context_parts else ""
```

---

### 15E. MongoDB Collections for Memory (as Originally Specified)

The original spec says "Memory must persist in MongoDB." The PostgreSQL tables in Phase 4 are fine for relational joins, but the **MongoDB store should mirror the key memory data** for fast lookups by the frontend and for eventual Atlas Vector Search upgrade.

**File: `apps/api/app/db/mongo.py`** — add these methods to `MongoStore`:

```python
# Add 4 new collections to __init__:
self.research_sessions = self.db["research_sessions"]
self.memory_entries = self.db["memory_entries"]
self.trusted_sources = self.db["trusted_sources"]
self.query_logs = self.db["query_logs"]

# Add index creation in ensure_indexes():
await self.research_sessions.create_index([("user_id", 1), ("updated_at", -1)])
await self.research_sessions.create_index([("thread_id", 1)], unique=True, sparse=True)
await self.memory_entries.create_index([("user_id", 1), ("entry_type", 1)])
await self.memory_entries.create_index([("created_at", -1)])
await self.trusted_sources.create_index([("user_id", 1), ("domain", 1)])
await self.query_logs.create_index([("user_id", 1), ("created_at", -1)])

# Add helper methods:
async def upsert_session_summary(self, user_id: str, thread_id: str, data: dict):
    """Mirror session summary to MongoDB for fast frontend reads."""
    await self.research_sessions.update_one(
        {"thread_id": thread_id},
        {"$set": {**data, "user_id": user_id, "thread_id": thread_id}},
        upsert=True,
    )

async def get_user_sessions(self, user_id: str, limit: int = 20) -> list:
    """List research sessions for a user, newest first."""
    cursor = self.research_sessions.find(
        {"user_id": user_id},
        sort=[("updated_at", -1)],
        limit=limit,
    )
    return await cursor.to_list(length=limit)
```

**In `MemoryService._upsert_research_session()`**, after the PostgreSQL commit, also mirror to MongoDB:
```python
# After session.commit():
from app.db.mongo import get_mongo_store
mongo = get_mongo_store()
await mongo.upsert_session_summary(user_id, thread_id, {
    "title": title,
    "summary": summary_data.get("summary"),
    "main_findings": summary_data.get("main_findings", []),
    "best_sources": best_sources,
    "overall_score": score,
    "updated_at": datetime.now(timezone.utc).isoformat(),
})
```

---

### 15F. New API Endpoints for Session Context

**Add to `apps/api/app/api/v1/memory.py`**:

```python
@router.get("/sessions")
async def list_research_sessions(
    limit: int = 20,
    user_id: str = Depends(get_current_user),
):
    """List past research sessions with summaries. Uses MongoDB for speed."""
    from app.db.mongo import get_mongo_store
    mongo = get_mongo_store()
    sessions = await mongo.get_user_sessions(user_id, limit=limit)
    return {"sessions": [
        {
            "thread_id": s.get("thread_id"),
            "title": s.get("title"),
            "summary": s.get("summary"),
            "main_findings": s.get("main_findings", []),
            "best_sources": s.get("best_sources", []),
            "overall_score": s.get("overall_score"),
            "updated_at": s.get("updated_at"),
        }
        for s in sessions
    ]}


@router.get("/sessions/{thread_id}/context")
async def get_session_context(
    thread_id: str,
    user_id: str = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    """
    Get the full memory context for a thread — what the agent knows from past runs.
    Used by the frontend to show 'Agent remembers from last time...' panel.
    """
    from app.services.memory import MemoryService
    memory_svc = MemoryService()
    # Find the most recent query in this thread to use as the semantic anchor
    from app.db.models import Run
    last_run = await session.execute(
        select(Run)
        .where(Run.thread_id == thread_id, Run.user_id == user_id)
        .order_by(Run.created_at.desc())
        .limit(1)
    )
    last_run = last_run.scalar_one_or_none()
    query_anchor = last_run.query if last_run else ""

    context = await memory_svc.retrieve_context(query_anchor, user_id, session)
    return {"thread_id": thread_id, "context": context, "has_memory": bool(context)}
```

---

### 15G. Frontend: "Agent Remembers" Panel

**File: `apps/web/app/page.tsx`** — when starting a new run in an existing thread, fetch session context and show it:

```typescript
// Before submitting a new query, check for existing memory:
const [sessionContext, setSessionContext] = useState<string | null>(null)

useEffect(() => {
  if (threadId && user) {
    fetch(`/v1/memory/sessions/${threadId}/context`, {
      headers: await getAuthHeader(),
    })
      .then(r => r.json())
      .then(data => {
        if (data.has_memory) setSessionContext(data.context)
      })
      .catch(() => {})
  }
}, [threadId, user])

// Render a subtle banner above the input when sessionContext exists:
{sessionContext && (
  <div className="px-4 py-2 rounded-xl bg-blue-50 dark:bg-blue-500/10 border border-blue-200/50 dark:border-blue-500/20 text-xs text-blue-700 dark:text-blue-300 mb-2">
    <span className="font-medium">Agent remembers from last time.</span>{' '}
    Building on previous research context.
  </div>
)}
```

**File: `apps/web/app/memory/page.tsx`** — add "Past Research Sessions" section at the top:

```typescript
// Call GET /v1/memory/sessions
// Show session cards: title, summary, main findings chips, overall score badge, updated_at
// Each card links to the thread: onClick → navigate to / with that thread_id
```

---

### 15H. Updated `store_run_memory()` — Complete Version

Replace the Phase 4 version in `memory.py` with this complete version that covers all of the above:

```python
async def store_run_memory(
    self, run_id, user_id: str | None, state: dict, session: AsyncSession
) -> None:
    """
    Complete memory storage after FINALIZE. Stores:
    1. Verified facts (individual claims)
    2. Trusted sources (high-citation domains)
    3. Agent reasoning trace (decisions, contradictions, failures)
    4. Query pattern log
    5. Run summary + upserts ResearchSession
    6. Mirrors session to MongoDB
    """
    if not settings.MEMORY_ENABLED or not user_id:
        return

    try:
        embedder = get_embedder()

        # 1. Store verified facts
        verification = state.get("verification_result", {})
        claims = verification.get("claims", []) if isinstance(verification, dict) else []
        facts = [
            c.get("text", "") for c in claims
            if isinstance(c, dict) and c.get("verification_status") == "VERIFIED"
        ][:5]
        if facts:
            embeddings = await embedder.embed_texts(facts)
            for content, emb in zip(facts, embeddings):
                session.add(MemoryEntry(
                    id=uuid4(), user_id=user_id, entry_type="fact",
                    content=content, embedding=emb, run_id=run_id,
                    relevance_score=0.8, created_at=datetime.now(timezone.utc),
                ))

        # 2. Store trusted sources
        citations = state.get("citations", [])
        from collections import Counter
        from urllib.parse import urlparse
        domain_counts: Counter = Counter()
        url_best: dict[str, str] = {}
        for c in citations:
            url = c.get("url", "") if isinstance(c, dict) else getattr(c, "url", "")
            if url:
                domain = urlparse(url).netloc.replace("www.", "")
                if domain:
                    domain_counts[domain] += 1
                    url_best[domain] = url
        for domain, count in domain_counts.items():
            if count >= 2:
                existing = (await session.execute(
                    select(TrustedSource).where(
                        TrustedSource.user_id == user_id,
                        TrustedSource.domain == domain,
                    )
                )).scalar_one_or_none()
                if existing:
                    existing.times_cited += count
                    existing.trust_score = min(1.0, existing.trust_score + 0.05)
                    existing.updated_at = datetime.now(timezone.utc)
                else:
                    session.add(TrustedSource(
                        id=uuid4(), user_id=user_id, domain=domain,
                        trust_score=0.65, times_cited=count,
                        created_at=datetime.now(timezone.utc),
                        updated_at=datetime.now(timezone.utc),
                    ))

        # 3. Store reasoning trace (decisions, contradictions)
        await self._store_reasoning_trace(run_id, user_id, state, session)

        # 4. Log query pattern
        eval_result = state.get("eval_result", {})
        overall = eval_result.get("overall", 0) if isinstance(eval_result, dict) else 0
        plan = state.get("plan", {})
        session.add(QueryLog(
            id=uuid4(), user_id=user_id,
            original_query=state.get("query", ""),
            sub_questions=plan.get("sub_questions", []) if isinstance(plan, dict) else [],
            search_queries=state.get("all_query_strings", [])[:10],
            success_score=overall, run_id=run_id,
            created_at=datetime.now(timezone.utc),
        ))

        # 5. Generate summary and upsert ResearchSession
        summary_data = {}
        if overall >= 0.5:  # Store summary even for mediocre runs
            summary_data = await self._generate_run_summary(state)
        await self._upsert_research_session(run_id, user_id, state, session, summary_data)

        await session.commit()
        logger.info(f"Memory stored for run {run_id}: {len(facts)} facts, "
                    f"{len(domain_counts)} domains, summary={'yes' if summary_data else 'no'}")

    except Exception as e:
        logger.warning(f"Memory storage failed for run {run_id}: {e}")
        try:
            await session.rollback()
        except Exception:
            pass
```

---

### 15I. Summary of What the Full Memory System Now Covers

| Spec Requirement | How It's Stored | Where Retrieved |
|-----------------|-----------------|-----------------|
| Previous queries | `QueryLog` table | Not injected (analytics only) |
| Research traces | `MemoryEntry` (decision/failure type) | INTAKE state → planner |
| Retrieved documents | `Document` table (existing) + URL dedup check | RESEARCH_LOOP state |
| Citations | `TrustedSource` table by domain | INTAKE state → planner |
| Trusted sources | `TrustedSource` table | INTAKE state + search filtering |
| Reasoning outputs | `MemoryEntry` (decision/contradiction type) | INTAKE state → planner |
| Agent decisions | `MemoryEntry` (decision type) | INTAKE state → planner |
| Run summaries | `ResearchSession.summary` | INTAKE state → full context |
| **MongoDB mirror** | `research_sessions` collection | Frontend `/v1/memory/sessions` |

### 15J. Updated File Change List

Add these to the existing change list:
```
# Additional new files:
apps/api/alembic/versions/005_research_session_summary_fields.py

# Additional modified files:
apps/api/app/db/mongo.py         → add 4 new collections + upsert_session_summary()
apps/api/app/services/memory.py  → complete rewrite with all 5 memory types + session summary
apps/api/app/services/fetcher.py → add is_already_fetched() deduplication
apps/api/app/api/v1/memory.py    → add /sessions and /sessions/{id}/context endpoints
apps/web/app/page.tsx            → add "Agent remembers" banner
apps/web/app/memory/page.tsx     → add Past Research Sessions section
apps/web/lib/api.ts              → add getSessionContext(), listResearchSessions()
apps/web/lib/types.ts            → add ResearchSession, MemoryEntry TypeScript types
```

---

*End of implementation brief. Total scope: 11 new files, 20 modified files, 5 database migrations, 3 new frontend pages.*
