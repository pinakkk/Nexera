"""
EmbedderService — ONNX-based dense embeddings via fastembed.
No PyTorch. Runs on CPU. Model: BAAI/bge-small-en-v1.5 (384 dims).
Model is downloaded once on first use, cached to EMBEDDING_CACHE_DIR.
"""
from __future__ import annotations

import asyncio
import logging
from functools import lru_cache
from typing import List

logger = logging.getLogger(__name__)


class EmbedderService:
    _model = None

    def __init__(self, model_name: str = "", cache_dir: str = ".fastembed_cache"):
        self._model_name = model_name
        self._cache_dir = cache_dir

    def _get_model(self):
        if self._model is None:
            try:
                from fastembed import TextEmbedding
                from app.config import get_settings
                settings = get_settings()
                model_name = self._model_name or getattr(settings, "EMBEDDING_MODEL", "BAAI/bge-small-en-v1.5")
                cache_dir = self._cache_dir or getattr(settings, "EMBEDDING_CACHE_DIR", ".fastembed_cache")
                self._model = TextEmbedding(
                    model_name=model_name,
                    cache_dir=cache_dir,
                )
                logger.info("Loaded embedding model: %s", model_name)
            except Exception as e:
                logger.warning("Failed to load embedding model: %s", e)
                raise
        return self._model

    async def embed_texts(self, texts: List[str]) -> List[List[float]]:
        """Embed a batch of texts. Returns list of 384-dim vectors."""
        if not texts:
            return []
        loop = asyncio.get_event_loop()
        model = self._get_model()
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
    from app.config import get_settings
    settings = get_settings()
    return EmbedderService(
        model_name=getattr(settings, "EMBEDDING_MODEL", "BAAI/bge-small-en-v1.5"),
        cache_dir=getattr(settings, "EMBEDDING_CACHE_DIR", ".fastembed_cache"),
    )
