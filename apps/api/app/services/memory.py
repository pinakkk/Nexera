"""
Memory service for persistent cross-session learning.

Stores and retrieves user memories with semantic search capabilities,
enabling the research agent to learn from past interactions.
"""

import uuid
from datetime import datetime, timezone
from functools import lru_cache
from typing import Optional

import numpy as np
from app.config import get_settings
from app.db.mongo import get_mongo_store
from app.services.embedder import get_embedder


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
    """Persistent memory service backed by MongoDB with semantic search."""

    MEMORIES_COLLECTION = "memories"
    TRUSTED_SOURCES_COLLECTION = "trusted_sources"
    FETCHED_URLS_COLLECTION = "fetched_urls"

    def __init__(self):
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

    async def store_memory(
        self,
        user_id: str,
        category: str,
        content: str,
        source_run_id: Optional[str] = None,
        confidence: float = 1.0,
    ) -> dict:
        """Store a memory entry with its embedding vector."""
        if not self.enabled:
            return {}

        embedding = await self._embedder.embed_query(content)
        now = datetime.now(timezone.utc)

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
            "created_at": now,
            "updated_at": now,
        }

        await self._db[self.MEMORIES_COLLECTION].insert_one(doc)
        return {k: v for k, v in doc.items() if k != "embedding"}

    async def recall(
        self,
        user_id: str,
        query: str,
        top_k: int = 5,
    ) -> list[dict]:
        """Semantic search over a user's memories. Returns the most relevant entries."""
        if not self.enabled:
            return []

        query_embedding = await self._embedder.embed_query(query)

        cursor = self._db[self.MEMORIES_COLLECTION].find(
            {"user_id": user_id, "is_active": True}
        )
        memories = await cursor.to_list(length=None)

        if not memories:
            return []

        scored = []
        for mem in memories:
            sim = _cosine_similarity(query_embedding, mem.get("embedding", []))
            scored.append((sim, mem))

        scored.sort(key=lambda x: x[0], reverse=True)
        top = scored[:top_k]

        results = []
        for score, mem in top:
            # Bump access count
            await self._db[self.MEMORIES_COLLECTION].update_one(
                {"id": mem["id"]},
                {"$inc": {"access_count": 1}, "$set": {"updated_at": datetime.now(timezone.utc)}},
            )
            results.append({
                "id": mem["id"],
                "category": mem["category"],
                "content": mem["content"],
                "confidence": mem.get("confidence", 1.0),
                "access_count": mem.get("access_count", 0) + 1,
                "source_run_id": mem.get("source_run_id"),
                "score": score,
                "created_at": mem.get("created_at"),
            })

        return results

    async def store_run_summary(
        self,
        user_id: str,
        run_id: str,
        query: str,
        report_summary: str,
    ) -> dict:
        """Convenience method to store a run summary as a memory."""
        content = f"Research query: {query}\n\nSummary: {report_summary}"
        return await self.store_memory(
            user_id=user_id,
            category="run_summary",
            content=content,
            source_run_id=run_id,
            confidence=1.0,
        )

    async def get_memory_context(self, user_id: str, query: str) -> str:
        """Return a formatted string of relevant memories for prompt injection."""
        if not self.enabled:
            return ""

        memories = await self.recall(user_id, query, top_k=5)
        if not memories:
            return ""

        lines = ["## Relevant memories from previous sessions\n"]
        for i, mem in enumerate(memories, 1):
            lines.append(
                f"{i}. [{mem['category']}] (confidence: {mem['confidence']:.2f}, "
                f"relevance: {mem['score']:.2f})\n   {mem['content']}\n"
            )
        return "\n".join(lines)

    async def list_memories(
        self,
        user_id: str,
        category: Optional[str] = None,
        limit: int = 50,
    ) -> list[dict]:
        """List memories for a user, optionally filtered by category."""
        query_filter: dict = {"user_id": user_id, "is_active": True}
        if category:
            query_filter["category"] = category

        cursor = (
            self._db[self.MEMORIES_COLLECTION]
            .find(query_filter, {"embedding": 0, "_id": 0})
            .sort("created_at", -1)
            .limit(limit)
        )
        return await cursor.to_list(length=limit)

    async def delete_memory(self, user_id: str, memory_id: str) -> bool:
        """Soft-delete a specific memory by marking it inactive."""
        result = await self._db[self.MEMORIES_COLLECTION].update_one(
            {"id": memory_id, "user_id": user_id},
            {"$set": {"is_active": False, "updated_at": datetime.now(timezone.utc)}},
        )
        return result.modified_count > 0

    async def get_stats(self, user_id: str) -> dict:
        """Return memory stats grouped by category."""
        pipeline = [
            {"$match": {"user_id": user_id, "is_active": True}},
            {"$group": {"_id": "$category", "count": {"$sum": 1}}},
        ]
        cursor = self._db[self.MEMORIES_COLLECTION].aggregate(pipeline)
        groups = await cursor.to_list(length=None)

        by_category = {g["_id"]: g["count"] for g in groups}
        total = sum(by_category.values())
        return {"total": total, "by_category": by_category}

    # ------------------------------------------------------------------ #
    # Trusted sources
    # ------------------------------------------------------------------ #

    async def add_trusted_source(
        self,
        user_id: str,
        domain: str,
        label: Optional[str] = None,
        trust_level: float = 1.0,
    ) -> dict:
        """Add a trusted source domain for a user."""
        now = datetime.now(timezone.utc)
        doc = {
            "id": str(uuid.uuid4()),
            "user_id": user_id,
            "domain": domain,
            "label": label,
            "trust_level": trust_level,
            "created_at": now,
        }
        await self._db[self.TRUSTED_SOURCES_COLLECTION].insert_one(doc)
        return {k: v for k, v in doc.items() if k != "_id"}

    async def list_trusted_sources(self, user_id: str) -> list[dict]:
        """List all trusted sources for a user."""
        cursor = self._db[self.TRUSTED_SOURCES_COLLECTION].find(
            {"user_id": user_id}, {"_id": 0}
        )
        return await cursor.to_list(length=None)

    async def remove_trusted_source(self, user_id: str, source_id: str) -> bool:
        """Remove a trusted source by id."""
        result = await self._db[self.TRUSTED_SOURCES_COLLECTION].delete_one(
            {"id": source_id, "user_id": user_id}
        )
        return result.deleted_count > 0

    # ------------------------------------------------------------------ #
    # URL dedup
    # ------------------------------------------------------------------ #

    async def is_url_already_fetched(self, user_id: str, url: str) -> bool:
        """Check whether a URL has already been fetched for this user."""
        doc = await self._db[self.FETCHED_URLS_COLLECTION].find_one(
            {"user_id": user_id, "url": url}
        )
        return doc is not None


@lru_cache(maxsize=1)
def get_memory_service() -> MemoryService:
    """Singleton getter for the MemoryService."""
    return MemoryService()
