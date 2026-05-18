"""Query generator – converts sub-questions into optimised search queries."""

import logging
from typing import Any

from .llm import LLMService

logger = logging.getLogger(__name__)


class QueryGeneratorService:
    """Takes the planner's sub-questions and produces 1-2 web-search
    queries per sub-question, optionally constrained by timeframe."""

    async def generate_queries(
        self,
        sub_questions: list[str],
        constraints: dict[str, Any],
        llm: LLMService,
        recent_chat_context: str = "",
        thread_summary_context: str = "",
        long_term_memory_context: str = "",
    ) -> list[dict[str, Any]]:
        """Generate search queries for every sub-question.

        Parameters
        ----------
        sub_questions:
            List of sub-questions from the planner.
        constraints:
            User-supplied constraints.  Recognised keys:
            ``timeframe`` (e.g. ``"past_month"``), ``allowed_domains``.
        llm:
            The LLM service instance to use.

        Returns
        -------
        list of dicts, each with:
            - ``sub_question`` – the originating sub-question
            - ``queries``      – list[str] of 1-2 search queries
        """
        timeframe = constraints.get("timeframe", "")
        allowed_domains = constraints.get("allowed_domains", [])

        timeframe_instruction = ""
        if timeframe:
            timeframe_instruction = (
                f"\n- Add temporal qualifiers appropriate for the timeframe: {timeframe}"
            )

        domain_instruction = ""
        if allowed_domains:
            domain_instruction = (
                f"\n- Prefer queries that would surface results from: {', '.join(allowed_domains)}"
            )

        context_sections = [
            section
            for section in (
                recent_chat_context.strip(),
                thread_summary_context.strip(),
                long_term_memory_context.strip(),
            )
            if section
        ]
        context_block = ""
        if context_sections:
            context_block = "\n\nContext to respect while generating queries:\n" + "\n\n".join(
                context_sections
            )

        numbered_questions = "\n".join(
            f"  {i + 1}. {q}" for i, q in enumerate(sub_questions)
        )

        prompt = f"""You are a search-query optimisation assistant.

For each sub-question below, generate 1 to 2 concise, effective web-search
queries that are likely to surface high-quality, relevant results.

Sub-questions:
{numbered_questions}

Constraints:{timeframe_instruction}{domain_instruction}
{context_block}

Return ONLY valid JSON in this exact format:
{{
  "queries": [
    {{
      "sub_question": "The original sub-question text",
      "queries": ["search query 1", "search query 2"]
    }}
  ]
}}

Guidelines:
- Use specific keywords and phrases
- Avoid vague or overly broad terms
- Include technical terms where appropriate
- Each query should approach the sub-question from a slightly different angle
- Keep queries concise (3-10 words)
"""

        result = await llm.complete_json(prompt, task_type="fast", max_tokens=1500)

        queries_list: list[dict[str, Any]] = result.get("queries", [])

        # Fallback: if the LLM returned an unexpected shape, build manually
        if not queries_list:
            logger.warning("Query generator returned empty list; building fallback queries")
            queries_list = [
                {"sub_question": q, "queries": [q]} for q in sub_questions
            ]

        logger.info(
            "Generated %d query groups with %d total queries",
            len(queries_list),
            sum(len(g.get("queries", [])) for g in queries_list),
        )
        return queries_list
