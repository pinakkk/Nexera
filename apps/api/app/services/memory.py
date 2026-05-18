"""Memory service for thread summaries and signed-in long-term recall.

Backed by Supabase Postgres. Semantic recall uses pgvector's cosine distance
operator (``embedding <=> query``) for an indexed ANN search instead of the
previous in-Python full-scan cosine.
"""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone
from functools import lru_cache
from typing import Any, Optional

from sqlalchemy import delete, func, select, update

from app.config import get_settings
from app.db.database import get_db
from app.db.models import (
    FetchedUrl,
    MemoryEntry,
    ThreadSummary,
    TrustedSource,
)
from app.services.embedder import get_embedder

logger = logging.getLogger(__name__)


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _str_id(value: Any) -> str:
    return str(value) if value is not None else ""


class MemoryService:
    """Persistent memory service backed by Supabase Postgres + pgvector."""

    def __init__(self) -> None:
        self._embedder_ref = None
        self._settings = get_settings()

    @property
    def _embedder(self):
        if self._embedder_ref is None:
            self._embedder_ref = get_embedder()
        return self._embedder_ref

    @property
    def enabled(self) -> bool:
        return self._settings.MEMORY_ENABLED

    # ------------------------------------------------------------------ #
    # Scoping
    # ------------------------------------------------------------------ #
    @staticmethod
    def _has_actor(user_id: str | None, session_id: str | None) -> bool:
        return bool(user_id or session_id)

    # ------------------------------------------------------------------ #
    # Long-term memory (signed-in only)
    # ------------------------------------------------------------------ #
    async def store_memory(
        self,
        user_id: str,
        category: str,
        content: str,
        source_run_id: Optional[str] = None,
        confidence: float = 1.0,
        metadata: Optional[dict[str, Any]] = None,
    ) -> dict[str, Any]:
        """Store a signed-in user's reusable memory entry with an embedding."""
        if not self.enabled or not user_id:
            return {}

        embedding = await self._embedder.embed_query(content)
        now = _utcnow()
        entry = MemoryEntry(
            id=uuid.uuid4(),
            user_id=user_id,
            category=category,
            content=content,
            embedding=embedding or None,
            source_run_id=source_run_id,
            confidence=confidence,
            access_count=0,
            is_active=True,
            created_at=now,
            updated_at=now,
        )
        async with get_db() as session:
            session.add(entry)

        return {
            "id": _str_id(entry.id),
            "user_id": user_id,
            "category": category,
            "content": content,
            "source_run_id": source_run_id,
            "confidence": confidence,
            "access_count": 0,
            "is_active": True,
            "created_at": now,
            "updated_at": now,
        }

    async def recall(
        self,
        user_id: str,
        query: str,
        top_k: int = 5,
    ) -> list[dict[str, Any]]:
        """Semantic search over a signed-in user's long-term memories.

        Uses pgvector cosine distance (``embedding <=> :q``) with an ANN index
        on ``memory_entries.embedding``. ``1 - distance`` is the cosine
        similarity reported as ``score``.
        """
        if not self.enabled or not user_id:
            return []

        query_embedding = await self._embedder.embed_query(query)
        if not query_embedding:
            return []

        async with get_db() as session:
            distance = MemoryEntry.embedding.cosine_distance(query_embedding)
            stmt = (
                select(MemoryEntry, distance.label("distance"))
                .where(
                    MemoryEntry.user_id == user_id,
                    MemoryEntry.is_active.is_(True),
                    MemoryEntry.embedding.isnot(None),
                )
                .order_by(distance)
                .limit(top_k)
            )
            rows = (await session.execute(stmt)).all()

            results: list[dict[str, Any]] = []
            recalled_ids: list[uuid.UUID] = []
            for mem, dist in rows:
                recalled_ids.append(mem.id)
                results.append(
                    {
                        "id": _str_id(mem.id),
                        "category": mem.category,
                        "content": mem.content,
                        "confidence": mem.confidence,
                        "access_count": (mem.access_count or 0) + 1,
                        "source_run_id": mem.source_run_id,
                        "score": float(1.0 - float(dist)) if dist is not None else 0.0,
                        "created_at": mem.created_at,
                        "metadata_json": {},
                    }
                )

            if recalled_ids:
                await session.execute(
                    update(MemoryEntry)
                    .where(MemoryEntry.id.in_(recalled_ids))
                    .values(
                        access_count=MemoryEntry.access_count + 1,
                        updated_at=_utcnow(),
                    )
                )

        return results

    # ------------------------------------------------------------------ #
    # Thread summary (rolling per-thread memory; signed-in OR anonymous)
    # ------------------------------------------------------------------ #
    @staticmethod
    def _thread_scope(stmt, *, thread_id: str, user_id: str | None, session_id: str | None):
        stmt = stmt.where(ThreadSummary.thread_id == thread_id)
        if user_id:
            return stmt.where(ThreadSummary.user_id == user_id)
        return stmt.where(ThreadSummary.session_id == session_id)

    async def upsert_thread_summary(
        self,
        *,
        thread_id: str,
        query: str,
        summary: str,
        user_id: str | None = None,
        session_id: str | None = None,
        source_run_id: str | None = None,
        open_follow_ups: list[str] | None = None,
        recent_queries: list[str] | None = None,
    ) -> dict[str, Any]:
        """Store or update the rolling summary for a thread."""
        if not self.enabled or not thread_id:
            return {}
        if not self._has_actor(user_id, session_id):
            return {}

        now = _utcnow()
        async with get_db() as session:
            existing = (
                await session.execute(
                    self._thread_scope(
                        select(ThreadSummary),
                        thread_id=thread_id,
                        user_id=user_id,
                        session_id=session_id,
                    )
                )
            ).scalar_one_or_none()

            if existing is None:
                existing = ThreadSummary(
                    id=uuid.uuid4(),
                    thread_id=thread_id,
                    user_id=user_id,
                    session_id=session_id,
                    created_at=now,
                )
                session.add(existing)

            existing.summary = summary
            existing.last_query = query
            existing.source_run_id = source_run_id
            existing.open_follow_ups = open_follow_ups or []
            existing.recent_queries = recent_queries or [query]
            existing.updated_at = now

            await session.flush()
            return self._thread_to_dict(existing)

    async def get_thread_summary(
        self,
        *,
        thread_id: str,
        user_id: str | None = None,
        session_id: str | None = None,
    ) -> dict[str, Any] | None:
        """Fetch the rolling summary for a thread."""
        if not self.enabled or not thread_id:
            return None
        if not self._has_actor(user_id, session_id):
            return None

        async with get_db() as session:
            row = (
                await session.execute(
                    self._thread_scope(
                        select(ThreadSummary),
                        thread_id=thread_id,
                        user_id=user_id,
                        session_id=session_id,
                    )
                )
            ).scalar_one_or_none()
            return self._thread_to_dict(row) if row else None

    @staticmethod
    def _thread_to_dict(row: ThreadSummary) -> dict[str, Any]:
        return {
            "id": _str_id(row.id),
            "thread_id": row.thread_id,
            "user_id": row.user_id,
            "session_id": row.session_id,
            "summary": row.summary or "",
            "last_query": row.last_query,
            "source_run_id": row.source_run_id,
            "open_follow_ups": list(row.open_follow_ups or []),
            "recent_queries": list(row.recent_queries or []),
            "created_at": row.created_at,
            "updated_at": row.updated_at,
        }

    # ------------------------------------------------------------------ #
    # Combined context bundle (consumed by orchestrator + gate paths)
    # ------------------------------------------------------------------ #
    async def get_context_bundle(
        self,
        *,
        query: str,
        thread_id: str | None,
        user_id: str | None = None,
        session_id: str | None = None,
        recent_chat_history: list[dict[str, str]] | None = None,
    ) -> dict[str, Any]:
        """Build separated context blocks for the planner/query-writer stack."""
        empty = {
            "recent_chat_context": "",
            "thread_summary_context": "",
            "long_term_memory_context": "",
            "counts": {"recent_turns": 0, "thread_summary": 0, "long_term_memories": 0},
        }
        if not self.enabled:
            return empty

        recent_chat_history = recent_chat_history or []
        recent_turns = recent_chat_history[-6:]

        recent_chat_context = ""
        if recent_turns:
            lines = ["## Recent conversation context\n"]
            for msg in recent_turns:
                role = str(msg.get("role", "user")).capitalize()
                content = str(msg.get("content", "")).strip()[:1200]
                if content:
                    lines.append(f"**{role}**: {content}\n")
            recent_chat_context = "\n".join(lines)

        thread_summary_context = ""
        thread_doc = None
        if thread_id:
            thread_doc = await self.get_thread_summary(
                thread_id=thread_id,
                user_id=user_id,
                session_id=session_id,
            )
            if thread_doc and thread_doc.get("summary"):
                lines = ["## Thread summary\n", str(thread_doc["summary"]).strip()]
                follow_ups = thread_doc.get("open_follow_ups") or []
                if follow_ups:
                    lines.append("\nOpen follow-ups:")
                    lines.extend(f"- {item}" for item in follow_ups[:5])
                thread_summary_context = "\n".join(lines)

        long_term_memory_context = ""
        recalled: list[dict[str, Any]] = []
        if user_id:
            recalled = await self.recall(user_id, query, top_k=self._settings.MEMORY_TOP_K)
            if recalled:
                lines = ["## Relevant long-term memory\n"]
                for idx, mem in enumerate(recalled, start=1):
                    lines.append(
                        f"{idx}. [{mem['category']}] confidence={mem['confidence']:.2f} "
                        f"relevance={mem['score']:.2f}\n   {mem['content']}\n"
                    )
                long_term_memory_context = "\n".join(lines)

        return {
            "recent_chat_context": recent_chat_context,
            "thread_summary_context": thread_summary_context,
            "long_term_memory_context": long_term_memory_context,
            "counts": {
                "recent_turns": len(recent_turns),
                "thread_summary": 1 if thread_doc else 0,
                "long_term_memories": len(recalled),
            },
        }

    async def store_run_memory_bundle(
        self,
        *,
        user_id: str | None,
        run_id: str,
        query: str,
        constraints: dict[str, Any],
        report_summary: str,
        steering_notes: list[str] | None = None,
    ) -> list[dict[str, Any]]:
        """Persist reusable signed-in memories from a completed run."""
        if not self.enabled or not user_id:
            return []

        created: list[dict[str, Any]] = []
        created.append(
            await self.store_memory(
                user_id=user_id,
                category="run_summary",
                content=f"Research query: {query}\n\nSummary: {report_summary}",
                source_run_id=run_id,
                confidence=1.0,
            )
        )

        allowed_domains = constraints.get("allowed_domains") or []
        if allowed_domains:
            created.append(
                await self.store_memory(
                    user_id=user_id,
                    category="source_pref",
                    content=f"Preferred source domains: {', '.join(allowed_domains[:8])}",
                    source_run_id=run_id,
                    confidence=0.8,
                )
            )

        timeframe = constraints.get("timeframe")
        if timeframe:
            created.append(
                await self.store_memory(
                    user_id=user_id,
                    category="fact",
                    content=f"Preferred research timeframe: {timeframe}",
                    source_run_id=run_id,
                    confidence=0.7,
                )
            )

        steering = [note.strip() for note in (steering_notes or []) if note.strip()]
        if steering:
            created.append(
                await self.store_memory(
                    user_id=user_id,
                    category="fact",
                    content=f"Open follow-up preferences: {'; '.join(steering[-3:])}",
                    source_run_id=run_id,
                    confidence=0.75,
                )
            )

        return [entry for entry in created if entry]

    async def list_memories(
        self,
        user_id: str,
        category: Optional[str] = None,
        limit: int = 50,
    ) -> list[dict[str, Any]]:
        """List memories for a signed-in user, optionally filtered by category."""
        if not user_id:
            return []
        async with get_db() as session:
            stmt = select(MemoryEntry).where(
                MemoryEntry.user_id == user_id,
                MemoryEntry.is_active.is_(True),
            )
            if category:
                stmt = stmt.where(MemoryEntry.category == category)
            stmt = stmt.order_by(MemoryEntry.created_at.desc()).limit(limit)
            rows = (await session.execute(stmt)).scalars().all()
            return [
                {
                    "id": _str_id(m.id),
                    "user_id": m.user_id,
                    "category": m.category,
                    "content": m.content,
                    "source_run_id": m.source_run_id,
                    "confidence": m.confidence,
                    "access_count": m.access_count,
                    "is_active": m.is_active,
                    "created_at": m.created_at,
                    "updated_at": m.updated_at,
                }
                for m in rows
            ]

    async def delete_memory(self, user_id: str, memory_id: str) -> bool:
        """Soft-delete a specific signed-in user's memory."""
        if not user_id:
            return False
        async with get_db() as session:
            result = await session.execute(
                update(MemoryEntry)
                .where(
                    MemoryEntry.id == uuid.UUID(str(memory_id)),
                    MemoryEntry.user_id == user_id,
                )
                .values(is_active=False, updated_at=_utcnow())
            )
            return (result.rowcount or 0) > 0

    async def get_stats(self, user_id: str) -> dict[str, Any]:
        """Return memory stats grouped by category for a signed-in user."""
        if not user_id:
            return {"total": 0, "by_category": {}}
        async with get_db() as session:
            rows = (
                await session.execute(
                    select(MemoryEntry.category, func.count())
                    .where(
                        MemoryEntry.user_id == user_id,
                        MemoryEntry.is_active.is_(True),
                    )
                    .group_by(MemoryEntry.category)
                )
            ).all()
        by_category = {category: count for category, count in rows}
        return {"total": sum(by_category.values()), "by_category": by_category}

    # ------------------------------------------------------------------ #
    # Trusted sources
    # ------------------------------------------------------------------ #
    async def add_trusted_source(
        self,
        user_id: str,
        domain: str,
        label: Optional[str] = None,
        trust_level: float = 1.0,
    ) -> dict[str, Any]:
        """Add a trusted source domain for a signed-in user."""
        now = _utcnow()
        src = TrustedSource(
            id=uuid.uuid4(),
            user_id=user_id,
            domain=domain,
            label=label,
            trust_level=trust_level,
            created_at=now,
        )
        async with get_db() as session:
            session.add(src)
        return {
            "id": _str_id(src.id),
            "user_id": user_id,
            "domain": domain,
            "label": label,
            "trust_level": trust_level,
            "created_at": now,
        }

    async def list_trusted_sources(self, user_id: str) -> list[dict[str, Any]]:
        """List all trusted sources for a signed-in user."""
        if not user_id:
            return []
        async with get_db() as session:
            rows = (
                await session.execute(
                    select(TrustedSource).where(TrustedSource.user_id == user_id)
                )
            ).scalars().all()
            return [
                {
                    "id": _str_id(s.id),
                    "user_id": s.user_id,
                    "domain": s.domain,
                    "label": s.label,
                    "trust_level": s.trust_level,
                    "created_at": s.created_at,
                }
                for s in rows
            ]

    async def remove_trusted_source(self, user_id: str, source_id: str) -> bool:
        """Remove a trusted source by id for a signed-in user."""
        if not user_id:
            return False
        async with get_db() as session:
            result = await session.execute(
                delete(TrustedSource).where(
                    TrustedSource.id == uuid.UUID(str(source_id)),
                    TrustedSource.user_id == user_id,
                )
            )
            return (result.rowcount or 0) > 0

    # ------------------------------------------------------------------ #
    # Fetched-URL dedup
    # ------------------------------------------------------------------ #
    async def is_url_already_fetched(self, actor_id: str, url: str) -> bool:
        """Check whether a URL has already been fetched for this actor.

        Records the (actor, url) pair on first sight so subsequent calls
        within and across runs return True (parity with prior Mongo behavior
        which only *read* — here we also persist to make dedup effective).
        """
        if not actor_id or not url:
            return False
        async with get_db() as session:
            exists = (
                await session.execute(
                    select(FetchedUrl.id).where(
                        FetchedUrl.actor_id == actor_id,
                        FetchedUrl.url == url,
                    )
                )
            ).first()
            if exists is not None:
                return True
            session.add(
                FetchedUrl(
                    id=uuid.uuid4(),
                    actor_id=actor_id,
                    url=url,
                    created_at=_utcnow(),
                )
            )
            return False


@lru_cache(maxsize=1)
def get_memory_service() -> MemoryService:
    """Singleton getter for the MemoryService."""
    return MemoryService()
