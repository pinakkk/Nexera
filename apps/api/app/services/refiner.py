"""Refiner service – generates improvement actions when evaluation fails."""

import logging
from typing import Any

from .llm import LLMService

logger = logging.getLogger(__name__)


class RefinerService:
    """Based on evaluation feedback, produce new sub-questions, queries,
    and instructions so the orchestrator can loop back and improve the report."""

    async def refine(
        self,
        eval_result: dict[str, Any],
        plan: dict[str, Any],
        previous_queries: list[str],
        llm: LLMService,
    ) -> dict[str, Any]:
        """Generate a refinement plan to close quality gaps.

        Parameters
        ----------
        eval_result:
            Output of :class:`EvaluatorService.evaluate`.
        plan:
            The original plan from the planner.
        previous_queries:
            Flat list of all search query strings already executed (to avoid
            repeating them).
        llm:
            The LLM service instance to use.

        Returns
        -------
        dict with keys:
            ``new_sub_questions`` – list[str]
            ``new_queries``       – list[str]
            ``instructions``      – str (guidance for the next synthesis pass)
        """
        scores = eval_result.get("scores", {})
        feedback = eval_result.get("feedback", "")
        missing_areas = eval_result.get("missing_areas", [])
        original_sub_questions = plan.get("sub_questions", [])

        prev_queries_text = "\n".join(f"  - {q}" for q in previous_queries) or "  (none)"

        prompt = f"""You are a research refinement assistant.

The following research report was evaluated and did NOT meet quality thresholds.
Your job is to identify what's missing and generate specific improvement actions.

## Evaluation Scores
- Groundedness: {scores.get('groundedness', 0):.2f}
- Coverage: {scores.get('coverage', 0):.2f}
- Contradictions: {scores.get('contradictions', 0):.2f}
- Source Diversity: {scores.get('source_diversity', 0):.2f}

## Evaluator Feedback
{feedback}

## Missing Areas Identified
{chr(10).join(f"- {a}" for a in missing_areas) if missing_areas else "None explicitly listed"}

## Original Sub-Questions
{chr(10).join(f"- {q}" for q in original_sub_questions)}

## Previously Executed Queries (do NOT repeat these)
{prev_queries_text}

---

Generate a refinement plan with:
1. New sub-questions to fill gaps (focus on missing_areas and low-coverage topics)
2. New search queries (different from previous ones) targeting the gaps
3. Instructions for the report writer on what to improve

Return ONLY valid JSON in this exact format:
{{
  "new_sub_questions": [
    "New question addressing a gap"
  ],
  "new_queries": [
    "new search query 1",
    "new search query 2"
  ],
  "instructions": "Detailed instructions for improving the report..."
}}

Guidelines:
- If groundedness is low: add queries to find supporting evidence for unsubstantiated claims
- If coverage is low: add new sub-questions for uncovered areas
- If contradictions score is low: add queries to find alternative viewpoints
- If source diversity is low: add queries targeting different source types (academic, news, official)
- Generate 1-4 new sub-questions and 2-5 new search queries
- Do NOT repeat any of the previously executed queries
"""

        result = await llm.complete_json(prompt, task_type="fast", max_tokens=1500)

        new_sub_questions = result.get("new_sub_questions", [])
        new_queries = result.get("new_queries", [])
        instructions = result.get("instructions", "Improve the report based on evaluation feedback.")

        # Filter out any repeated queries
        prev_set = set(q.lower().strip() for q in previous_queries)
        new_queries = [
            q for q in new_queries if q.lower().strip() not in prev_set
        ]

        if not new_queries and missing_areas:
            # Fallback: generate basic search queries from missing areas
            new_queries = [area for area in missing_areas[:3]]
            logger.info("Refiner fallback: using missing_areas as queries")

        logger.info(
            "Refinement: %d new sub-questions, %d new queries",
            len(new_sub_questions),
            len(new_queries),
        )

        return {
            "new_sub_questions": new_sub_questions,
            "new_queries": new_queries,
            "instructions": instructions,
        }
