"""Evaluator service – scores a research report on 4 quality dimensions."""

import logging
from typing import Any

from .llm import LLMService

logger = logging.getLogger(__name__)


class EvaluatorService:
    """Evaluate a synthesised report against the original plan and evidence.

    Scores four dimensions on a 0-1 scale:

    1. **Groundedness** – are claims supported by cited evidence?
    2. **Coverage** – are all sub-questions from the plan addressed?
    3. **Contradictions** – are conflicts between sources acknowledged?
    4. **Source diversity** – is the report drawing from diverse domains?

    The evaluator uses the *smart* LLM to judge quality.
    """

    async def evaluate(
        self,
        report_md: str,
        evidence: list[dict[str, Any]],
        plan: dict[str, Any],
        llm: LLMService,
    ) -> dict[str, Any]:
        """Evaluate the report and return scores plus actionable feedback.

        Parameters
        ----------
        report_md:
            The Markdown research report.
        evidence:
            The evidence list from the retriever (per sub-question).
        plan:
            The plan dict from the planner (contains sub_questions, outline).
        llm:
            The LLM service instance to use.

        Returns
        -------
        dict with keys:
            ``scores``        – dict of float (groundedness, coverage, contradictions, source_diversity)
            ``passed``        – bool
            ``feedback``      – str (explanation of scores)
            ``missing_areas`` – list[str] (sub-questions or topics not covered)
        """
        sub_questions = plan.get("sub_questions", [])

        # Build a concise evidence summary for the eval prompt
        evidence_summary = self._build_evidence_summary(evidence)

        # Compute source diversity heuristically
        domains = self._collect_domains(evidence)
        heuristic_diversity = self._compute_diversity_score(domains)

        prompt = f"""You are a research quality evaluator.  Evaluate the following
research report against the plan and evidence provided.

## Original Sub-Questions
{chr(10).join(f"- {q}" for q in sub_questions)}

## Evidence Summary (what the retriever found)
{evidence_summary}

## Report to Evaluate
{report_md[:6000]}

---

Score the report on these four dimensions (each 0.0 to 1.0):

1. **groundedness**: What fraction of key factual claims in the report are
   backed by an inline citation that matches evidence?  1.0 = all claims cited
   and supported; 0.0 = no citations at all.

2. **coverage**: What fraction of the original sub-questions are adequately
   answered in the report?  1.0 = all answered; 0.0 = none addressed.

3. **contradictions**: Are conflicting pieces of evidence acknowledged?
   1.0 = all contradictions noted or no contradictions exist;
   0.0 = contradictions silently ignored.

4. **source_diversity**: {heuristic_diversity:.2f} (pre-computed from domain distribution).

For each dimension, also provide a brief explanation.

List any sub-questions or areas that are NOT adequately covered.

Return ONLY valid JSON in this exact format:
{{
  "groundedness": 0.85,
  "groundedness_explanation": "...",
  "coverage": 0.9,
  "coverage_explanation": "...",
  "contradictions": 1.0,
  "contradictions_explanation": "...",
  "missing_areas": ["area 1", "area 2"],
  "overall_feedback": "..."
}}
"""

        result = await llm.complete_json(prompt, task_type="smart", max_tokens=1500)

        # Extract scores
        groundedness = float(result.get("groundedness", 0.5))
        coverage = float(result.get("coverage", 0.5))
        contradictions = float(result.get("contradictions", 0.5))
        source_diversity = heuristic_diversity  # use our computed value

        scores = {
            "groundedness": _clamp(groundedness),
            "coverage": _clamp(coverage),
            "contradictions": _clamp(contradictions),
            "source_diversity": _clamp(source_diversity),
        }

        # Pass/fail logic
        all_above_min = all(s > 0.6 for s in scores.values())
        avg_score = sum(scores.values()) / len(scores)
        passed = all_above_min and avg_score > 0.7

        feedback_parts: list[str] = []
        feedback_parts.append(result.get("overall_feedback", ""))
        if result.get("groundedness_explanation"):
            feedback_parts.append(f"Groundedness: {result['groundedness_explanation']}")
        if result.get("coverage_explanation"):
            feedback_parts.append(f"Coverage: {result['coverage_explanation']}")
        if result.get("contradictions_explanation"):
            feedback_parts.append(f"Contradictions: {result['contradictions_explanation']}")

        missing_areas = result.get("missing_areas", [])

        eval_result = {
            "scores": scores,
            "passed": passed,
            "feedback": "\n".join(feedback_parts),
            "missing_areas": missing_areas,
        }

        logger.info(
            "Evaluation: groundedness=%.2f  coverage=%.2f  contradictions=%.2f  "
            "diversity=%.2f  passed=%s",
            scores["groundedness"],
            scores["coverage"],
            scores["contradictions"],
            scores["source_diversity"],
            passed,
        )

        return eval_result

    # ------------------------------------------------------------------ #
    # Helpers
    # ------------------------------------------------------------------ #

    @staticmethod
    def _build_evidence_summary(evidence: list[dict[str, Any]]) -> str:
        """Build a concise evidence summary for the evaluation prompt."""
        lines: list[str] = []
        for entry in evidence:
            sq = entry.get("sub_question", "")
            ev_count = len(entry.get("evidence", []))
            sources = [e.get("domain", "?") for e in entry.get("evidence", [])]
            unique_sources = list(set(sources))
            lines.append(
                f"- **{sq}**: {ev_count} evidence chunks from {', '.join(unique_sources)}"
            )
        return "\n".join(lines) or "No evidence available."

    @staticmethod
    def _collect_domains(evidence: list[dict[str, Any]]) -> list[str]:
        """Collect all unique domains from evidence."""
        domains: list[str] = []
        for entry in evidence:
            for ev in entry.get("evidence", []):
                d = ev.get("domain", "")
                if d:
                    domains.append(d)
        return domains

    @staticmethod
    def _compute_diversity_score(domains: list[str]) -> float:
        """Compute source diversity score.

        Uses inverse Herfindahl-Hirschman index normalised to [0, 1].
        A single domain yields 0.0; perfectly uniform distribution yields 1.0.
        """
        if not domains:
            return 0.0

        from collections import Counter

        counts = Counter(domains)
        total = sum(counts.values())
        n = len(counts)

        if n <= 1:
            return 0.3  # single source penalty

        # HHI ranges from 1/n (equal) to 1 (monopoly)
        hhi = sum((c / total) ** 2 for c in counts.values())
        # Normalise: 0 when hhi=1 (bad), 1 when hhi=1/n (good)
        if n == 1:
            return 0.3
        normalised = (1.0 - hhi) / (1.0 - 1.0 / n)
        return max(0.3, min(1.0, normalised))


def _clamp(value: float, lo: float = 0.0, hi: float = 1.0) -> float:
    """Clamp *value* to [*lo*, *hi*]."""
    return max(lo, min(hi, value))
