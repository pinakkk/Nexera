"""Retriever service – hybrid BM25 + dense retrieval with Reciprocal Rank Fusion."""

import logging
from collections import defaultdict
from typing import Any

import numpy as np
from rank_bm25 import BM25Okapi

from app.services.embedder import get_embedder

logger = logging.getLogger(__name__)

# --------------------------------------------------------------------------- #
# Text helpers
# --------------------------------------------------------------------------- #


def _tokenize(text: str) -> list[str]:
    """Lowercase whitespace tokenisation with basic punctuation stripping."""
    import re
    return re.findall(r"[a-z0-9]+", text.lower())


def _cosine_similarity(vec_a: np.ndarray, vec_b: np.ndarray) -> float:
    """Compute cosine similarity between two vectors."""
    norm_a = np.linalg.norm(vec_a)
    norm_b = np.linalg.norm(vec_b)
    if norm_a == 0 or norm_b == 0:
        return 0.0
    return float(np.dot(vec_a, vec_b) / (norm_a * norm_b))


def _rrf_fuse(
    rankings: list[list[int]],
    n_docs: int,
    k: int = 60,
) -> list[float]:
    """Reciprocal Rank Fusion over multiple ranked lists.

    Parameters
    ----------
    rankings:
        Each element is a list of document indices sorted by relevance
        (best first).
    n_docs:
        Total number of documents.
    k:
        RRF smoothing constant (default 60).

    Returns
    -------
    List of RRF scores indexed by document position.
    """
    scores = [0.0] * n_docs
    for ranking in rankings:
        for rank, doc_idx in enumerate(ranking):
            scores[doc_idx] += 1.0 / (k + rank + 1)
    return scores


# --------------------------------------------------------------------------- #
# Retriever
# --------------------------------------------------------------------------- #


class RetrieverService:
    """Hybrid retriever combining BM25 and dense (embedding) retrieval.

    - BM25 provides exact-term matching.
    - Dense retrieval provides semantic similarity via embeddings.
    - Results are fused using Reciprocal Rank Fusion (RRF, k=60).
    - Source diversity is enforced (max 3 chunks per domain).
    """

    async def retrieve(
        self,
        sub_questions: list[str],
        chunks: list[dict[str, Any]],
        top_n: int | None = None,
    ) -> list[dict[str, Any]]:
        """Retrieve the most relevant evidence chunks for each sub-question.

        Parameters
        ----------
        sub_questions:
            The sub-questions from the planner.
        chunks:
            Flat list of chunk dicts (output of :class:`IndexerService`).
        top_n:
            Maximum evidence chunks per sub-question (clamped to 3-8).
            Defaults to 5.

        Returns
        -------
        list of dicts with keys:
            ``sub_question``, ``evidence`` (list of evidence dicts)
        """
        top_k = max(3, min(top_n or 5, 8))

        if not chunks:
            logger.warning("No chunks available for retrieval")
            return [
                {"sub_question": q, "evidence": []} for q in sub_questions
            ]

        # Tokenise all chunks once
        chunk_texts = [c["chunk_text"] for c in chunks]
        corpus_tokens = [_tokenize(t) for t in chunk_texts]
        n_docs = len(chunks)

        # Build BM25 index
        bm25 = BM25Okapi(corpus_tokens)

        # Check if chunks have precomputed embeddings
        has_embeddings = all("embedding" in c and c["embedding"] for c in chunks)

        # Build dense embedding matrix from precomputed chunk embeddings
        chunk_embeddings: np.ndarray | None = None
        use_dense = False

        if has_embeddings:
            try:
                chunk_embeddings = np.array(
                    [c["embedding"] for c in chunks], dtype=np.float32
                )
                use_dense = True
            except Exception:
                logger.warning("Failed to build embedding matrix from chunks, falling back to BM25 only")

        # If no precomputed embeddings, try to compute them on the fly
        if not use_dense:
            try:
                embedder = get_embedder()
                raw_embeddings = await embedder.embed_texts(chunk_texts)
                if raw_embeddings and len(raw_embeddings) == n_docs:
                    chunk_embeddings = np.array(raw_embeddings, dtype=np.float32)
                    use_dense = True
            except Exception:
                logger.warning(
                    "Embedder unavailable, falling back to BM25-only retrieval"
                )

        results: list[dict[str, Any]] = []

        for question in sub_questions:
            q_tokens = _tokenize(question)

            # --- BM25 ranking ---
            bm25_scores = list(bm25.get_scores(q_tokens))
            bm25_ranking = sorted(
                range(n_docs), key=lambda i: bm25_scores[i], reverse=True
            )

            rankings = [bm25_ranking]

            # --- Dense ranking ---
            if use_dense and chunk_embeddings is not None:
                try:
                    embedder = get_embedder()
                    query_emb = await embedder.embed_query(question)
                    query_vec = np.array(query_emb, dtype=np.float32)

                    dense_scores = [
                        _cosine_similarity(query_vec, chunk_embeddings[i])
                        for i in range(n_docs)
                    ]
                    dense_ranking = sorted(
                        range(n_docs),
                        key=lambda i: dense_scores[i],
                        reverse=True,
                    )
                    rankings.append(dense_ranking)
                except Exception:
                    logger.warning(
                        "Dense retrieval failed for question, using BM25 only: %s",
                        question[:80],
                    )

            # --- RRF Fusion ---
            fused_scores = _rrf_fuse(rankings, n_docs, k=60)

            # Rank by fused score
            ranked_indices = sorted(
                range(n_docs), key=lambda i: fused_scores[i], reverse=True
            )

            # Deduplicate + enforce source diversity
            seen_chunk_texts: set[str] = set()
            domain_counts: dict[str, int] = defaultdict(int)
            evidence: list[dict[str, Any]] = []

            for idx in ranked_indices:
                if len(evidence) >= top_k:
                    break

                chunk = chunks[idx]
                text = chunk["chunk_text"]
                domain = chunk.get("domain", "unknown")

                # Skip duplicate chunk text
                if text in seen_chunk_texts:
                    continue
                seen_chunk_texts.add(text)

                # Enforce source diversity: max 3 chunks from same domain
                if domain_counts[domain] >= 3:
                    continue
                domain_counts[domain] += 1

                evidence.append({
                    "chunk_text": text,
                    "document_url": chunk.get("document_url", ""),
                    "document_title": chunk.get("document_title", ""),
                    "score": round(fused_scores[idx], 4),
                    "domain": domain,
                })

            results.append({
                "sub_question": question,
                "evidence": evidence,
            })

            logger.info(
                "Retrieved %d evidence chunks for question: %s",
                len(evidence),
                question[:80],
            )

        return results
