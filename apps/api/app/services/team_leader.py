"""Team Leader – planner + delegator for full research runs.

Receives a query with complexity mode and produces a structured research plan
with delegation instructions for each sub-agent.
"""

from __future__ import annotations

import json
import logging
import re
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

_DEPTH_MAP: dict[str, tuple[int, int]] = {
    "quick": (2, 3),
    "standard": (4, 6),
    "deep": (6, 10),
}


def _load_prompt() -> str:
    path = Path(__file__).parent.parent.parent / "prompts" / "team_leader.txt"
    try:
        return path.read_text(encoding="utf-8")
    except FileNotFoundError:
        return ""


class TeamLeaderService:
    """Plans the research and delegates to sub-agents."""

    async def create_plan(
        self,
        query: str,
        depth: str,
        mode: str,
        constraints: dict[str, Any],
        llm: Any,
        recent_chat_context: str = "",
        thread_summary_context: str = "",
        long_term_memory_context: str = "",
    ) -> dict[str, Any]:
        """Create a structured research plan with delegation instructions.

        Returns dict with: sub_questions, outline, focus_areas, delegation,
        max_sources_per_question, priority_order
        """
        min_q, max_q = _DEPTH_MAP.get(depth, _DEPTH_MAP["standard"])
        system_prompt = _load_prompt()

        context_sections = [
            ("Recent conversation", recent_chat_context),
            ("Thread summary", thread_summary_context),
            ("Long-term memory", long_term_memory_context),
        ]
        context_parts = [
            f"--- {label} ---\n{value.strip()}\n--- End {label} ---"
            for label, value in context_sections
            if value and value.strip()
        ]
        memory_block = "\n".join(context_parts)

        prompt = f"""{system_prompt}
{memory_block}
Research query: "{query}"
Complexity mode: {mode}
Depth level: {depth}
Min sub-questions: {min_q}, Max sub-questions: {max_q}
Constraints: {json.dumps(constraints, default=str)}

Create a research plan. Return JSON only.
"""

        try:
            result = await llm.complete_json(prompt, task_type="smart", max_tokens=2048)
        except Exception as exc:
            logger.warning("Team leader LLM call failed: %s – using fallback plan", exc)
            result = self._fallback_plan(query, min_q)

        # Validate core fields
        sub_questions = result.get("sub_questions", [])
        if len(sub_questions) < min_q:
            logger.warning("Team leader returned %d sub-questions, expected >= %d", len(sub_questions), min_q)
        if len(sub_questions) > max_q:
            sub_questions = sub_questions[:max_q]
            result["sub_questions"] = sub_questions

        # Ensure required keys
        result.setdefault("sub_questions", [])
        result.setdefault("outline", [])
        result.setdefault("focus_areas", [])
        result.setdefault("delegation", {
            "query_gen_instructions": "Generate targeted search queries",
            "writer_instructions": "Write comprehensive report with citations",
            "evaluation_criteria": ["groundedness", "coverage", "source_diversity"],
        })
        result.setdefault("max_sources_per_question", 5)
        result.setdefault("priority_order", list(range(len(sub_questions))))

        logger.info(
            "Team leader plan: %d sub-questions, %d outline sections, mode=%s",
            len(result["sub_questions"]),
            len(result["outline"]),
            mode,
        )
        return result

    @staticmethod
    def _fallback_plan(query: str, min_q: int) -> dict[str, Any]:
        """Generate a minimal fallback plan when LLM fails."""
        return {
            "sub_questions": [query] * min(min_q, 2),
            "outline": [
                {"title": "Introduction", "description": "Overview of the topic"},
                {"title": "Analysis", "description": "Key findings"},
                {"title": "Conclusion", "description": "Summary and recommendations"},
            ],
            "focus_areas": ["comprehensive coverage"],
            "delegation": {
                "query_gen_instructions": "Generate diverse search queries",
                "writer_instructions": "Write clear report with citations",
                "evaluation_criteria": ["groundedness", "coverage"],
            },
            "max_sources_per_question": 5,
            "priority_order": [0],
        }
