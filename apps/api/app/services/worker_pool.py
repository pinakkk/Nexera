"""Parallel async worker pool for research sub-questions.

Each worker independently:
  query_gen → search → dedupe → extract → parse → store → chunk → embed → retrieve

Workers share a URL dedup set and evidence pool via the concurrency manager.
"""

import asyncio
import logging
from dataclasses import dataclass, field
from typing import Any
from uuid import uuid4

logger = logging.getLogger(__name__)


@dataclass
class WorkerResult:
    """Result from a single research worker."""

    worker_id: str
    sub_question: str
    queries_executed: list[str] = field(default_factory=list)
    documents_fetched: int = 0
    chunks_produced: int = 0
    evidence: list[dict[str, Any]] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)
    source_type: str = "web"


class URLDeduplicator:
    """Thread-safe URL deduplication across all workers.

    Strategy:
    - Canonical normalize URLs (strip fragment, trailing slash, sort params)
    - Track content hashes to catch mirror sites
    - Per-domain caps to enforce diversity
    """

    def __init__(self, max_per_domain: int = 5) -> None:
        self._seen_urls: set[str] = set()
        self._content_hashes: set[str] = set()
        self._domain_counts: dict[str, int] = {}
        self._max_per_domain = max_per_domain
        self._lock = asyncio.Lock()

    async def try_claim(self, url: str, domain: str = "") -> bool:
        """Try to claim a URL for processing. Returns True if allowed."""
        async with self._lock:
            canonical = self._normalize(url)

            if canonical in self._seen_urls:
                return False

            if domain and self._domain_counts.get(domain, 0) >= self._max_per_domain:
                return False

            self._seen_urls.add(canonical)
            if domain:
                self._domain_counts[domain] = self._domain_counts.get(domain, 0) + 1
            return True

    async def register_content_hash(self, content_hash: str) -> bool:
        """Register a content hash. Returns True if new (not duplicate)."""
        async with self._lock:
            if content_hash in self._content_hashes:
                return False
            self._content_hashes.add(content_hash)
            return True

    @staticmethod
    def _normalize(url: str) -> str:
        from urllib.parse import urlparse, urlunparse
        parsed = urlparse(url)
        path = parsed.path.rstrip("/") or "/"
        return urlunparse((
            parsed.scheme,
            parsed.netloc.lower(),
            path,
            "", "", "",
        ))


class EvidenceMerger:
    """Merge evidence from multiple workers with diversity enforcement.

    Policy:
    - Deduplicate by chunk text similarity (exact match)
    - Enforce source diversity: max N chunks per domain
    - Rank by relevance score
    - Cap total evidence per sub-question
    """

    def __init__(
        self,
        max_per_domain: int = 3,
        max_per_subquestion: int = 8,
    ) -> None:
        self._max_per_domain = max_per_domain
        self._max_per_sq = max_per_subquestion

    def merge(self, worker_results: list[WorkerResult]) -> list[dict[str, Any]]:
        """Merge evidence from all workers into a unified evidence pool.

        Returns
        -------
        List of evidence dicts, one per sub-question, with diverse sources.
        """
        # Group evidence by sub-question
        by_sq: dict[str, list[dict[str, Any]]] = {}
        for result in worker_results:
            sq = result.sub_question
            if sq not in by_sq:
                by_sq[sq] = []
            by_sq[sq].extend(result.evidence)

        merged: list[dict[str, Any]] = []
        for sq, evidence_list in by_sq.items():
            # Dedup by exact text
            seen_texts: set[str] = set()
            domain_counts: dict[str, int] = {}
            filtered: list[dict[str, Any]] = []

            # Sort by score descending
            evidence_list.sort(
                key=lambda e: e.get("score", 0.0), reverse=True,
            )

            for ev in evidence_list:
                text = ev.get("chunk_text", ev.get("text", "")).strip()
                if text in seen_texts:
                    continue
                seen_texts.add(text)

                domain = ev.get("domain", "unknown")
                if domain_counts.get(domain, 0) >= self._max_per_domain:
                    continue
                domain_counts[domain] = domain_counts.get(domain, 0) + 1

                filtered.append(ev)
                if len(filtered) >= self._max_per_sq:
                    break

            merged.append({
                "sub_question": sq,
                "evidence": filtered,
            })

        return merged


class WorkerPool:
    """Manages parallel research workers for sub-questions.

    Each worker runs the full research pipeline independently:
    query generation → search → dedup → extract → parse → chunk → retrieve

    Coordination:
    - asyncio.Semaphore for bounded concurrency
    - Shared URL deduplicator across all workers
    - Evidence merger with diversity enforcement
    """

    def __init__(
        self,
        max_concurrency: int = 5,
        max_per_domain: int = 5,
    ) -> None:
        self._semaphore = asyncio.Semaphore(max_concurrency)
        self._url_dedup = URLDeduplicator(max_per_domain=max_per_domain)
        self._merger = EvidenceMerger()

    async def run_workers(
        self,
        sub_questions: list[str],
        worker_fn: Any,
        event_callback: Any = None,
    ) -> tuple[list[WorkerResult], list[dict[str, Any]]]:
        """Spawn workers for each sub-question and merge results.

        Parameters
        ----------
        sub_questions:
            List of sub-questions to research.
        worker_fn:
            Async function: (sub_question, worker_id, url_dedup, semaphore) -> WorkerResult
        event_callback:
            Optional SSE callback.

        Returns
        -------
        Tuple of (all worker results, merged evidence pool).
        """
        tasks = []
        for i, sq in enumerate(sub_questions):
            worker_id = f"w-{i}-{uuid4().hex[:6]}"
            tasks.append(
                self._run_single_worker(
                    worker_fn=worker_fn,
                    sub_question=sq,
                    worker_id=worker_id,
                    event_callback=event_callback,
                )
            )

        if event_callback:
            await event_callback(
                "workers_started",
                f"Spawned {len(tasks)} parallel research workers",
                {"worker_count": len(tasks)},
            )

        # Run all workers with error isolation
        results = await asyncio.gather(*tasks, return_exceptions=True)

        worker_results: list[WorkerResult] = []
        for i, result in enumerate(results):
            if isinstance(result, Exception):
                logger.error("Worker %d failed: %s", i, result)
                worker_results.append(WorkerResult(
                    worker_id=f"w-{i}-failed",
                    sub_question=sub_questions[i] if i < len(sub_questions) else "",
                    errors=[str(result)],
                ))
            else:
                worker_results.append(result)

        # Merge evidence with diversity enforcement
        merged_evidence = self._merger.merge(worker_results)

        total_docs = sum(w.documents_fetched for w in worker_results)
        total_chunks = sum(w.chunks_produced for w in worker_results)
        total_evidence = sum(len(e.get("evidence", [])) for e in merged_evidence)

        if event_callback:
            await event_callback(
                "workers_completed",
                f"Workers complete: {total_docs} docs, {total_chunks} chunks, {total_evidence} evidence pieces",
                {
                    "total_documents": total_docs,
                    "total_chunks": total_chunks,
                    "total_evidence": total_evidence,
                    "worker_count": len(worker_results),
                },
            )

        return worker_results, merged_evidence

    async def _run_single_worker(
        self,
        worker_fn: Any,
        sub_question: str,
        worker_id: str,
        event_callback: Any = None,
    ) -> WorkerResult:
        """Run a single worker within the semaphore bounds."""
        async with self._semaphore:
            if event_callback:
                await event_callback(
                    "worker_started",
                    f"[{worker_id}] Researching: {sub_question[:60]}",
                    {"worker_id": worker_id, "sub_question": sub_question},
                )

            try:
                result = await worker_fn(
                    sub_question=sub_question,
                    worker_id=worker_id,
                    url_dedup=self._url_dedup,
                )

                if event_callback:
                    await event_callback(
                        "worker_completed",
                        f"[{worker_id}] Done: {result.documents_fetched} docs, "
                        f"{len(result.evidence)} evidence",
                        {
                            "worker_id": worker_id,
                            "documents_fetched": result.documents_fetched,
                            "evidence_count": len(result.evidence),
                        },
                    )

                return result

            except Exception as exc:
                logger.exception("Worker %s failed for: %s", worker_id, sub_question)
                if event_callback:
                    await event_callback(
                        "worker_failed",
                        f"[{worker_id}] Failed: {exc}",
                        {"worker_id": worker_id, "error": str(exc)},
                    )
                return WorkerResult(
                    worker_id=worker_id,
                    sub_question=sub_question,
                    errors=[str(exc)],
                )
