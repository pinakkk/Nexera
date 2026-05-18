"""Memory service for thread summaries and signed-in long-term recall."""

from __future__ import annotations

import asyncio
import uuid
from datetime import datetime, timezone
from functools import lru_cache
from typing import Any, Optional

import numpy as np

from app.config import get_settings
from app.db.mongo import get_mongo_store
from app.services.embedder import get_embedder


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _cosine_similarity(a: list[float], b: list[float]) -> float:
    """Compute cosine similarity between two vectors."""
    a_arr = np.array(a, dtype=np.float32)
    b_arr = np.array(b, dtype=np.float32)
    dot = np.dot(a_arr, b_arr)
    norm_a = np.linalg.norm(a_arr)
    norm_b = np.linalg.norm(b_arr)
    if norm_a == 0 or norm_b == 0:
        return 0.0
    return float(dot / (norm_a * norm_b))


class MemoryService:
    """Persistent memory service backed by MongoDB collections."""

    MEMORIES_COLLECTION = "memory_entries"
    THREAD_SUMMARIES_COLLECTION = "research_sessions"
    TRUSTED_SOURCES_COLLECTION = "trusted_sources"
    FETCHED_URLS_COLLECTION = "fetched_urls"

    def __init__(self) -> None:
        self._store = None
        self._db_ref = None
        self._embedder_ref = None
        self._settings = get_settings()

    @property
    def _db(self):
        if self._db_ref is None:
            self._store = get_mongo_store()
            self._db_ref = self._store._db
        return self._db_ref

    @property
    def _embedder(self):
        if self._embedder_ref is None:
            self._embedder_ref = get_embedder()
        return self._embedder_ref

    @property
    def enabled(self) -> bool:
        return self._settings.MEMORY_ENABLED

    @staticmethod
    def _actor_filter(
        *,
        user_id: str | None = None,
        session_id: str | None = None,
    ) -> dict[str, Any]:
        if user_id:
            return {"user_id": user_id}
        if session_id:
            return {"session_id": session_id}
        return {"_id": "__no_actor__"}

    async def _insert_one(self, collection: str, doc: dict[str, Any]) -> None:
        await asyncio.to_thread(self._db[collection].insert_one, doc)

    async def _find_one(
        self,
        collection: str,
        query: dict[str, Any],
        projection: dict[str, int] | None = None,
    ) -> dict[str, Any] | None:
        return await asyncio.to_thread(self._db[collection].find_one, query, projection)

    async def _find_many(
        self,
        collection: str,
        query: dict[str, Any],
        projection: dict[str, int] | None = None,
        *,
        sort: list[tuple[str, int]] | None = None,
        limit: int | None = None,
    ) -> list[dict[str, Any]]:
        def _run() -> list[dict[str, Any]]:
            cursor = self._db[collection].find(query, projection)
            if sort:
                cursor = cursor.sort(sort)
            if limit is not None:
                cursor = cursor.limit(limit)
            return list(cursor)

        return await asyncio.to_thread(_run)

    async def _update_one(
        self,
        collection: str,
        query: dict[str, Any],
        update: dict[str, Any],
        *,
        upsert: bool = False,
    ) -> Any:
        return await asyncio.to_thread(
            self._db[collection].update_one,
            query,
            update,
            upsert,
        )

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
        doc = {
            "id": str(uuid.uuid4()),
            "user_id": user_id,
            "category": category,
            "content": content,
            "embedding": embedding,
            "source_run_id": source_run_id,
            "confidence": confidence,
            "access_count": 0,
            "is_active": True,
            "metadata_json": metadata or {},
            "created_at": now,
            "updated_at": now,
        }
        await self._insert_one(self.MEMORIES_COLLECTION, doc)
        return {k: v for k, v in doc.items() if k != "embedding"}

    async def recall(
        self,
        user_id: str,
        query: str,
        top_k: int = 5,
    ) -> list[dict[str, Any]]:
        """Semantic search over a signed-in user's long-term memories."""
        if not self.enabled or not user_id:
            return []

        query_embedding = await self._embedder.embed_query(query)
        memories = await self._find_many(
            self.MEMORIES_COLLECTION,
            {"user_id": user_id, "is_active": True},
        )
        if not memories:
            return []

        scored: list[tuple[float, dict[str, Any]]] = []
        for mem in memories:
            sim = _cosine_similarity(query_embedding, mem.get("embedding", []))
            scored.append((sim, mem))

        scored.sort(key=lambda item: item[0], reverse=True)
        top = scored[:top_k]
        results: list[dict[str, Any]] = []
        for score, mem in top:
            await self._update_one(
                self.MEMORIES_COLLECTION,
                {"id": mem["id"], "user_id": user_id},
                {"$inc": {"access_count": 1}, "$set": {"updated_at": _utcnow()}},
            )
            results.append(
                {
                    "id": mem["id"],
                    "category": mem["category"],
                    "content": mem["content"],
                    "confidence": mem.get("confidence", 1.0),
                    "access_count": mem.get("access_count", 0) + 1,
                    "source_run_id": mem.get("source_run_id"),
                    "score": score,
                    "created_at": mem.get("created_at"),
                    "metadata_json": mem.get("metadata_json", {}),
                }
            )
        return results

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

        actor_filter = self._actor_filter(user_id=user_id, session_id=session_id)
        if "_id" in actor_filter:
            return {}

        now = _utcnow()
        update = {
            "$set": {
                "thread_id": thread_id,
                "summary": summary,
                "last_query": query,
                "source_run_id": source_run_id,
                "open_follow_ups": open_follow_ups or [],
                "recent_queries": recent_queries or [query],
                "updated_at": now,
                **actor_filter,
            },
            "$setOnInsert": {
                "id": str(uuid.uuid4()),
                "created_at": now,
            },
        }
        await self._update_one(
            self.THREAD_SUMMARIES_COLLECTION,
            {"thread_id": thread_id, **actor_filter},
            update,
            upsert=True,
        )
        doc = await self._find_one(
            self.THREAD_SUMMARIES_COLLECTION,
            {"thread_id": thread_id, **actor_filter},
            {"_id": 0},
        )
        return doc or {}

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
        actor_filter = self._actor_filter(user_id=user_id, session_id=session_id)
        if "_id" in actor_filter:
            return None
        return await self._find_one(
            self.THREAD_SUMMARIES_COLLECTION,
            {"thread_id": thread_id, **actor_filter},
            {"_id": 0},
        )

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
        if not self.enabled:
            return {
                "recent_chat_context": "",
                "thread_summary_context": "",
                "long_term_memory_context": "",
                "counts": {"recent_turns": 0, "thread_summary": 0, "long_term_memories": 0},
            }

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
        query_filter: dict[str, Any] = {"user_id": user_id, "is_active": True}
        if category:
            query_filter["category"] = category
        return await self._find_many(
            self.MEMORIES_COLLECTION,
            query_filter,
            {"embedding": 0, "_id": 0},
            sort=[("created_at", -1)],
            limit=limit,
        )

    async def delete_memory(self, user_id: str, memory_id: str) -> bool:
        """Soft-delete a specific signed-in user's memory."""
        if not user_id:
            return False
        result = await self._update_one(
            self.MEMORIES_COLLECTION,
            {"id": memory_id, "user_id": user_id},
            {"$set": {"is_active": False, "updated_at": _utcnow()}},
        )
        return result.modified_count > 0

    async def get_stats(self, user_id: str) -> dict[str, Any]:
        """Return memory stats grouped by category for a signed-in user."""
        if not user_id:
            return {"total": 0, "by_category": {}}

        def _aggregate() -> list[dict[str, Any]]:
            pipeline = [
                {"$match": {"user_id": user_id, "is_active": True}},
                {"$group": {"_id": "$category", "count": {"$sum": 1}}},
            ]
            return list(self._db[self.MEMORIES_COLLECTION].aggregate(pipeline))

        groups = await asyncio.to_thread(_aggregate)
        by_category = {g["_id"]: g["count"] for g in groups}
        return {"total": sum(by_category.values()), "by_category": by_category}

    async def add_trusted_source(
        self,
        user_id: str,
        domain: str,
        label: Optional[str] = None,
        trust_level: float = 1.0,
    ) -> dict[str, Any]:
        """Add a trusted source domain for a signed-in user."""
        now = _utcnow()
        doc = {
            "id": str(uuid.uuid4()),
            "user_id": user_id,
            "domain": domain,
            "label": label,
            "trust_level": trust_level,
            "created_at": now,
        }
        await self._insert_one(self.TRUSTED_SOURCES_COLLECTION, doc)
        return {k: v for k, v in doc.items() if k != "_id"}

    async def list_trusted_sources(self, user_id: str) -> list[dict[str, Any]]:
        """List all trusted sources for a signed-in user."""
        if not user_id:
            return []
        return await self._find_many(
            self.TRUSTED_SOURCES_COLLECTION,
            {"user_id": user_id},
            {"_id": 0},
        )

    async def remove_trusted_source(self, user_id: str, source_id: str) -> bool:
        """Remove a trusted source by id for a signed-in user."""
        if not user_id:
            return False

        def _delete():
            return self._db[self.TRUSTED_SOURCES_COLLECTION].delete_one(
                {"id": source_id, "user_id": user_id}
            )

        result = await asyncio.to_thread(_delete)
        return result.deleted_count > 0

    async def is_url_already_fetched(self, actor_id: str, url: str) -> bool:
        """Check whether a URL has already been fetched for this actor."""
        doc = await self._find_one(
            self.FETCHED_URLS_COLLECTION,
            {"actor_id": actor_id, "url": url},
        )
        return doc is not None


@lru_cache(maxsize=1)
def get_memory_service() -> MemoryService:
    """Singleton getter for the MemoryService."""
    return MemoryService()
