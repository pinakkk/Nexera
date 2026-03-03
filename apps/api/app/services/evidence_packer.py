"""Evidence Packer – selects, deduplicates, and summarises evidence for the writer.

Enforces source diversity and packs evidence within token budgets.
"""

from __future__ import annotations

import logging
from collections import defaultdict
from typing import Any

logger = logging.getLogger(__name__)

# Max chunks per sub-question
_MAX_CHUNKS = 8
_MIN_CHUNKS = 3
# Max share of chunks from a single domain
_MAX_DOMAIN_SHARE = 0.4


class EvidencePackerService:
    """Pack evidence chunks for optimal report writing."""

    async def pack(
        self,
        evidence: list[dict[str, Any]],
        llm: Any | None = None,
    ) -> dict[str, Any]:
        """Pack evidence with deduplication, diversity enforcement, and summarisation.

        Parameters
        ----------
        evidence:
            Output of RetrieverService.retrieve — list of dicts with
            sub_question and evidence list.
        llm:
            Optional LLM for summarisation (not yet used for cost reasons).

        Returns
        -------
        Dict with packed_evidence, source_diversity_score, total_unique_sources.
        """
        packed: list[dict[str, Any]] = []
        all_sources: set[str] = set()
        domain_counts: defaultdict[str, int] = defaultdict(int)
        total_chunks = 0

        for entry in evidence:
            sq = entry.get("sub_question", "")
            chunks = entry.get("evidence", [])

            # Deduplicate by chunk text
            seen_texts: set[str] = set()
            deduped: list[dict[str, Any]] = []
            for chunk in chunks:
                text = chunk.get("chunk_text", "")
                text_key = text[:200].lower().strip()
                if text_key in seen_texts:
                    continue
                seen_texts.add(text_key)
                deduped.append(chunk)

            # Enforce source diversity
            sq_domain_counts: defaultdict[str, int] = defaultdict(int)
            diverse_chunks: list[dict[str, Any]] = []

            for chunk in deduped:
                domain = chunk.get("domain", "unknown")
                max_per_domain = max(2, int(len(deduped) * _MAX_DOMAIN_SHARE))
                if sq_domain_counts[domain] >= max_per_domain:
                    continue
                sq_domain_counts[domain] += 1
                diverse_chunks.append(chunk)

            # Limit to budget
            selected = diverse_chunks[:_MAX_CHUNKS]

            # Track metrics
            for c in selected:
                url = c.get("document_url", "")
                if url:
                    all_sources.add(url)
                domain = c.get("domain", "unknown")
                domain_counts[domain] += 1
                total_chunks += 1

            # Build key findings (lightweight summary without LLM)
            key_findings = []
            for c in selected[:3]:
                text = c.get("chunk_text", "")
                if text:
                    key_findings.append(text[:150].strip())

            # Check for contradictions (basic heuristic)
            contradictions = self._detect_contradictions(selected)

            packed.append({
                "sub_question": sq,
                "key_findings": key_findings,
                "supporting_chunks": [
                    {
                        "chunk_id": str(i),
                        "summary": c.get("chunk_text", "")[:200],
                        "source_url": c.get("document_url", ""),
                        "relevance": c.get("score", 0.0),
                    }
                    for i, c in enumerate(selected)
                ],
                "contradictions": contradictions,
                "confidence": min(1.0, len(selected) / _MIN_CHUNKS),
                "evidence": selected,  # Pass through for downstream
            })

        # Source diversity score
        unique_domains = len(domain_counts)
        total_domain_entries = sum(domain_counts.values()) or 1
        max_domain_share = max(domain_counts.values()) / total_domain_entries if domain_counts else 0
        diversity_score = min(1.0, unique_domains / 5) * (1 - max_domain_share * 0.5)

        result = {
            "packed_evidence": packed,
            "source_diversity_score": round(diversity_score, 3),
            "total_unique_sources": len(all_sources),
            "total_chunks_packed": total_chunks,
        }

        logger.info(
            "Evidence packed: %d sub-questions, %d unique sources, diversity=%.2f",
            len(packed), len(all_sources), diversity_score,
        )
        return result

    @staticmethod
    def _detect_contradictions(chunks: list[dict[str, Any]]) -> list[str]:
        """Basic contradiction detection via keyword/negation heuristics."""
        contradictions: list[str] = []
        negation_words = {"not", "no", "never", "neither", "however", "but", "although", "contrary", "opposite", "unlike", "disagree", "incorrect", "false"}

        texts = [c.get("chunk_text", "").lower() for c in chunks]
        for i, t1 in enumerate(texts):
            for t2 in texts[i + 1:]:
                t1_words = set(t1.split())
                t2_words = set(t2.split())
                shared = t1_words & t2_words
                neg_in_t1 = t1_words & negation_words
                neg_in_t2 = t2_words & negation_words

                if len(shared) > 5 and (neg_in_t1 ^ neg_in_t2):
                    contradictions.append(
                        f"Possible contradiction between sources on: {' '.join(list(shared)[:5])}"
                    )
                    break
            if contradictions:
                break

        return contradictions
