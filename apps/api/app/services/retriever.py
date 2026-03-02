"""Retriever service – hybrid BM25 + TF-IDF retrieval with source diversity."""

import logging
import math
from collections import Counter, defaultdict
from typing import Any

from rank_bm25 import BM25Okapi

logger = logging.getLogger(__name__)

# --------------------------------------------------------------------------- #
# Text helpers
# --------------------------------------------------------------------------- #


def _tokenize(text: str) -> list[str]:
    """Lowercase whitespace tokenisation with basic punctuation stripping."""
    import re
    return re.findall(r"[a-z0-9]+", text.lower())


def _tfidf_vectors(corpus_tokens: list[list[str]]) -> tuple[list[Counter], Counter]:
    """Build per-document TF vectors and a corpus-wide DF counter."""
    df: Counter = Counter()
    tf_list: list[Counter] = []
    for tokens in corpus_tokens:
        tf = Counter(tokens)
        tf_list.append(tf)
        df.update(set(tokens))
    return tf_list, df


def _tfidf_score(
    query_tokens: list[str],
    tf: Counter,
    df: Counter,
    n_docs: int,
) -> float:
    """Compute a simple TF-IDF cosine-like score between a query and a document."""
    if not query_tokens or not tf:
        return 0.0

    score = 0.0
    for token in query_tokens:
        if token not in tf:
            continue
        # TF component (log-normalised)
        tf_val = 1 + math.log(tf[token])
        # IDF component
        doc_freq = df.get(token, 0)
        idf_val = math.log((n_docs + 1) / (doc_freq + 1)) + 1
        score += tf_val * idf_val
    return score


def _normalize_scores(scores: list[float]) -> list[float]:
    """Min-max normalise a list of scores to [0, 1]."""
    if not scores:
        return scores
    lo = min(scores)
    hi = max(scores)
    rng = hi - lo
    if rng == 0:
        return [1.0] * len(scores)
    return [(s - lo) / rng for s in scores]


# --------------------------------------------------------------------------- #
# Retriever
# --------------------------------------------------------------------------- #


class RetrieverService:
    """Hybrid retriever combining BM25 and TF-IDF scoring.

    - BM25 provides exact-term matching.
    - TF-IDF provides a simple vector similarity fallback.
    - Scores are combined:  ``0.6 * BM25_norm + 0.4 * TFIDF_norm``.
    - Source diversity is enforced (max 3 chunks per domain).
    """

    async def retrieve(
        self,
        sub_questions: list[str],
        chunks: list[dict[str, Any]],
        top_k: int = 5,
    ) -> list[dict[str, Any]]:
        """Retrieve the most relevant evidence chunks for each sub-question.

        Parameters
        ----------
        sub_questions:
            The sub-questions from the planner.
        chunks:
            Flat list of chunk dicts (output of :class:`IndexerService`).
        top_k:
            Maximum evidence chunks per sub-question (clamped to 3-8).

        Returns
        -------
        list of dicts with keys:
            ``sub_question``, ``evidence`` (list of evidence dicts)
        """
        top_k = max(3, min(top_k, 8))

        if not chunks:
            logger.warning("No chunks available for retrieval")
            return [
                {"sub_question": q, "evidence": []} for q in sub_questions
            ]

        # Tokenise all chunks once
        chunk_texts = [c["chunk_text"] for c in chunks]
        corpus_tokens = [_tokenize(t) for t in chunk_texts]

        # Build BM25 index
        bm25 = BM25Okapi(corpus_tokens)

        # Build TF-IDF components
        tf_list, df = _tfidf_vectors(corpus_tokens)
        n_docs = len(chunks)

        results: list[dict[str, Any]] = []

        for question in sub_questions:
            q_tokens = _tokenize(question)

            # BM25 scores
            bm25_scores = list(bm25.get_scores(q_tokens))

            # TF-IDF scores
            tfidf_scores = [
                _tfidf_score(q_tokens, tf_list[i], df, n_docs)
                for i in range(n_docs)
            ]

            # Normalise
            bm25_norm = _normalize_scores(bm25_scores)
            tfidf_norm = _normalize_scores(tfidf_scores)

            # Fuse
            fused = [
                0.6 * bm25_norm[i] + 0.4 * tfidf_norm[i]
                for i in range(n_docs)
            ]

            # Rank
            ranked_indices = sorted(range(n_docs), key=lambda i: fused[i], reverse=True)

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
                    "score": round(fused[idx], 4),
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
