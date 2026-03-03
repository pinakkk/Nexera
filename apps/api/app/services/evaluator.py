"""Evaluator service – structured evaluation of research reports.

Scores: groundedness, coverage, contradictions, source_diversity.
Uses the evaluator system prompt for LLM-based scoring.
"""

from __future__ import annotations

import json
import logging
import re
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

_PASS_THRESHOLD = 0.65


def _load_prompt() -> str:
    path = Path(__file__).parent.parent.parent / "prompts" / "evaluator.txt"
    try:
        return path.read_text(encoding="utf-8")
    except FileNotFoundError:
        return ""


def _clamp(v: float, lo: float = 0.0, hi: float = 1.0) -> float:
    return max(lo, min(hi, v))


class EvaluatorService:
    """Evaluate report quality and decide pass/fail."""

    async def evaluate(
        self,
        report_md: str,
        plan: dict[str, Any],
        evidence: list[dict[str, Any]],
        llm: Any,
    ) -> dict[str, Any]:
        """Evaluate a report against the plan and evidence.

        Returns dict with: scores, passed, missing_topics,
        unsupported_claims, revision_suggestions, contradiction_notes.
        """
        system_prompt = _load_prompt()

        # Build concise evidence summary for prompt
        evidence_summary = self._summarise_evidence(evidence)
        sub_questions = plan.get("sub_questions", [])

        prompt = f"""{system_prompt}

## Report to Evaluate
{report_md[:3000]}

## Plan Sub-Questions
{chr(10).join(f"- {q}" for q in sub_questions)}

## Available Evidence Sources
{evidence_summary}

Evaluate the report and return JSON only.
"""

        try:
            raw = await llm.complete(
                prompt=prompt,
                task_type="smart",
                temperature=0.2,
                max_tokens=1024,
            )

            # Parse JSON
            try:
                result = json.loads(raw)
            except json.JSONDecodeError:
                match = re.search(r"\{.*\}", raw, re.DOTALL)
                if match:
                    result = json.loads(match.group(0))
                else:
                    result = self._fallback_result(report_md, sub_questions, evidence)

        except Exception as exc:
            logger.warning("Evaluator LLM call failed: %s", exc)
            result = self._fallback_result(report_md, sub_questions, evidence)

        # Normalise scores
        scores = result.get("scores", {})
        for key in ["groundedness", "coverage", "contradictions", "source_diversity"]:
            scores[key] = _clamp(float(scores.get(key, 0.5)))

        # Calculate overall
        scores["overall"] = _clamp(
            0.35 * scores["groundedness"]
            + 0.30 * scores["coverage"]
            + 0.20 * scores["contradictions"]
            + 0.15 * scores["source_diversity"]
        )
        result["scores"] = scores

        # Determine pass/fail
        passed = scores["overall"] >= _PASS_THRESHOLD
        result["passed"] = passed

        # Ensure all keys exist
        result.setdefault("missing_topics", [])
        result.setdefault("unsupported_claims", [])
        result.setdefault("revision_suggestions", [])
        result.setdefault("contradiction_notes", [])

        logger.info(
            "Evaluation: overall=%.2f passed=%s (G=%.2f C=%.2f X=%.2f D=%.2f)",
            scores["overall"], passed,
            scores["groundedness"], scores["coverage"],
            scores["contradictions"], scores["source_diversity"],
        )
        return result

    @staticmethod
    def _summarise_evidence(evidence: list[dict[str, Any]]) -> str:
        """Build a concise evidence summary for the evaluation prompt."""
        lines: list[str] = []
        for entry in evidence[:10]:
            sq = entry.get("sub_question", "")
            chunks = entry.get("evidence", [])
            sources = set()
            for c in chunks:
                url = c.get("document_url", "")
                if url:
                    sources.add(url)
            lines.append(f"- {sq}: {len(chunks)} chunks from {len(sources)} sources")
        return "\n".join(lines) or "No evidence available"

    @staticmethod
    def _fallback_result(
        report_md: str,
        sub_questions: list[str],
        evidence: list[dict[str, Any]],
    ) -> dict[str, Any]:
        """Heuristic-based fallback when LLM evaluation fails."""
        # Basic heuristic scoring
        has_citations = bool(re.findall(r"\[\d+\]", report_md))
        word_count = len(report_md.split())
        unique_sources = set()
        for entry in evidence:
            for c in entry.get("evidence", []):
                url = c.get("document_url", "")
                if url:
                    unique_sources.add(url)

        groundedness = 0.6 if has_citations else 0.3
        coverage = min(1.0, word_count / 500)
        source_div = min(1.0, len(unique_sources) / 5)

        return {
            "scores": {
                "groundedness": groundedness,
                "coverage": coverage,
                "contradictions": 0.5,
                "source_diversity": source_div,
            },
            "passed": False,
            "missing_topics": [],
            "unsupported_claims": [],
            "revision_suggestions": ["LLM evaluation unavailable – review manually"],
            "contradiction_notes": [],
        }
