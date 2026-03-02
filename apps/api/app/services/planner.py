"""Planner service – decomposes a user query into sub-questions and a report outline."""

import logging
from typing import Any

from .llm import LLMService

logger = logging.getLogger(__name__)

# Depth presets: (min sub-questions, max sub-questions)
_DEPTH_MAP: dict[str, tuple[int, int]] = {
    "quick": (2, 3),
    "standard": (4, 6),
    "deep": (6, 10),
}


class PlannerService:
    """Uses the LLM to break a research query into actionable sub-questions
    and produce a report outline."""

    async def plan(
        self,
        query: str,
        depth: str,
        llm: LLMService,
    ) -> dict[str, Any]:
        """Decompose *query* into sub-questions, an outline, and focus areas.

        Parameters
        ----------
        query:
            The original user research question.
        depth:
            One of ``"quick"``, ``"standard"``, or ``"deep"``.
        llm:
            The LLM service instance to use.

        Returns
        -------
        dict with keys:
            - ``sub_questions``  – list[str]
            - ``outline``        – list[dict] (section title + description)
            - ``focus_areas``    – list[str]
        """
        min_q, max_q = _DEPTH_MAP.get(depth, _DEPTH_MAP["standard"])

        prompt = f"""You are a research planning assistant.

Given the following research question, decompose it into {min_q} to {max_q} specific
sub-questions that together will comprehensively answer the original question.
Also produce a report outline (sections) and key focus areas.

Research question: "{query}"
Depth level: {depth}

Return ONLY valid JSON in this exact format:
{{
  "sub_questions": [
    "Sub-question 1",
    "Sub-question 2"
  ],
  "outline": [
    {{"title": "Section Title", "description": "What this section covers"}},
    {{"title": "Section Title 2", "description": "What this section covers"}}
  ],
  "focus_areas": [
    "Area of particular importance 1",
    "Area of particular importance 2"
  ]
}}

Guidelines:
- Sub-questions should be specific, measurable, and non-overlapping
- The outline should form a logical flow for a research report
- Always include an Introduction section and a Conclusion section in the outline
- Focus areas highlight the most critical aspects that need strong evidence
- Generate between {min_q} and {max_q} sub-questions
"""

        result = await llm.complete_json(prompt, task_type="fast", max_tokens=1500)

        # Validate and enforce bounds
        sub_questions = result.get("sub_questions", [])
        if len(sub_questions) < min_q:
            logger.warning(
                "Planner returned %d sub-questions, expected at least %d",
                len(sub_questions),
                min_q,
            )
        if len(sub_questions) > max_q:
            sub_questions = sub_questions[:max_q]
            result["sub_questions"] = sub_questions

        # Ensure required keys exist
        result.setdefault("sub_questions", [])
        result.setdefault("outline", [])
        result.setdefault("focus_areas", [])

        logger.info(
            "Plan created: %d sub-questions, %d outline sections, %d focus areas",
            len(result["sub_questions"]),
            len(result["outline"]),
            len(result["focus_areas"]),
        )
        return result
