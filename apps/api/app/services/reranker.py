"""
RerankerService — ONNX cross-encoder reranker via flashrank.
No API key. No PyTorch. Model downloaded once, cached locally.
Model: ms-marco-MiniLM-L-12-v2 (~80MB ONNX)
"""
from __future__ import annotations

import asyncio
import logging
from functools import lru_cache

logger = logging.getLogger(__name__)


class RerankerService:
    _ranker = None

    def _get_ranker(self):
        if self._ranker is None:
            from flashrank import Ranker
            from app.config import get_settings
            settings = get_settings()
            model_name = getattr(settings, "RERANKER_MODEL", "ms-marco-MiniLM-L-12-v2")
            self._ranker = Ranker(
                model_name=model_name,
                cache_dir=".flashrank_cache",
            )
            logger.info("Loaded reranker model: %s", model_name)
        return self._ranker

    async def rerank(
        self,
        query: str,
        chunks: list,
        top_n: int | None = None,
    ) -> list:
        """
        Rerank chunks by cross-encoder relevance to query.
        Returns top_n chunks ordered by relevance.
        Falls back to original order if reranker fails.

        Accepts chunks as either:
        - list of dicts with 'chunk_text' key
        - list of ORM objects with .chunk_text attribute
        """
        from app.config import get_settings
        settings = get_settings()

        if not chunks or not getattr(settings, "RERANKER_ENABLED", True):
            return chunks

        top_n = top_n or getattr(settings, "RERANKER_TOP_N", 10)

        try:
            from flashrank import RerankRequest
            ranker = self._get_ranker()

            def _get_text(c) -> str:
                if isinstance(c, dict):
                    return str(c.get("chunk_text", ""))[:512]
                return str(getattr(c, "chunk_text", ""))[:512]

            passages = [{"text": _get_text(c)} for c in chunks]
            request = RerankRequest(query=query, passages=passages)

            loop = asyncio.get_event_loop()
            results = await loop.run_in_executor(
                None, lambda: ranker.rerank(request)
            )

            reranked = sorted(results, key=lambda r: r["score"], reverse=True)
            return [chunks[r["index"]] for r in reranked[:top_n]]

        except Exception as e:
            logger.warning("Reranker failed, using original order: %s", e)
            return chunks[:top_n]


@lru_cache(maxsize=1)
def get_reranker() -> RerankerService:
    return RerankerService()
