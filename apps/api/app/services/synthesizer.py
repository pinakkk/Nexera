"""Synthesizer service – drafts a Markdown research report with citations."""

import logging
import re
from typing import Any

from .llm import LLMService

logger = logging.getLogger(__name__)


class SynthesizerService:
    """Uses the *smart* LLM to synthesise a structured Markdown report
    from the planner's outline and the retrieved evidence."""

    async def synthesize(
        self,
        plan: dict[str, Any],
        evidence: list[dict[str, Any]],
        citation_style: str,
        llm: LLMService,
        chat_context: str = "",
        memory_context: str = "",
    ) -> dict[str, Any]:
        """Generate a research report with inline citations.

        Parameters
        ----------
        plan:
            Output of :class:`PlannerService.plan` (contains *outline* and
            *sub_questions*).
        evidence:
            Output of :class:`RetrieverService.retrieve` (one entry per
            sub-question, each with an *evidence* list).
        citation_style:
            ``"numbered"`` for ``[1]`` style or ``"author-date"`` for
            ``(Author, Year)`` style.
        llm:
            The LLM service instance to use.

        Returns
        -------
        dict with keys:
            ``report_md``  – the full Markdown report
            ``citations``  – list of citation dicts
        """
        # ----- build the source reference list -----
        source_map: dict[str, dict[str, Any]] = {}  # url -> info
        source_index: list[dict[str, Any]] = []
        counter = 1

        for entry in evidence:
            for ev in entry.get("evidence", []):
                url = ev.get("document_url", "")
                if url and url not in source_map:
                    source_info = {
                        "id": str(counter),
                        "url": url,
                        "title": ev.get("document_title", "Untitled"),
                        "domain": ev.get("domain", ""),
                        "snippet": ev.get("chunk_text", "")[:200],
                    }
                    source_map[url] = source_info
                    source_index.append(source_info)
                    counter += 1

        # ----- build evidence section for prompt -----
        evidence_text = self._format_evidence_for_prompt(evidence, source_map)
        outline_text = self._format_outline_for_prompt(plan.get("outline", []))

        # ----- citation style instructions -----
        if citation_style == "author-date":
            cite_instructions = (
                "Use author-date citations in the format (Author, Year) inline. "
                "If the author is unknown, use (Domain, Year) or (Domain, n.d.). "
                "Include a full References section at the end."
            )
        else:
            # numbered (default)
            cite_instructions = (
                "Use numbered citations in the format [1], [2], etc. inline. "
                "Each number corresponds to a source in the Sources list. "
                "Include a numbered References section at the end."
            )

        # Build context block from chat history and memory
        context_block = ""
        if chat_context or memory_context:
            context_parts = []
            if chat_context:
                context_parts.append(chat_context)
            if memory_context:
                context_parts.append(memory_context)
            context_block = "\n".join(context_parts) + "\n\n"

        prompt = f"""You are an expert research report writer.
{context_block}Write a comprehensive research report in Markdown format based on the outline and
evidence provided below.  Every key claim MUST be supported by a citation.
If there is conversation history above, use it to understand what the user is looking for
and tailor your response accordingly. Address the user by name if known.

## Report Outline
{outline_text}

## Evidence by Sub-Question
{evidence_text}

## Source List
{self._format_sources(source_index)}

## Citation Instructions
{cite_instructions}

## Writing Guidelines
- Write clear, professional prose suitable for a research audience
- Use Markdown headings (## for sections, ### for subsections)
- Cite sources for all factual claims – do NOT fabricate information
- If evidence is conflicting, acknowledge the contradiction explicitly
- Include an executive summary at the top
- Include a Conclusion section that synthesises findings
- Include a References section listing all cited sources
- Be thorough and comprehensive – cover all sections from the outline

Write the report now:
"""

        report_md = await llm.complete(
            prompt=prompt,
            task_type="smart",
            temperature=0.3,
            max_tokens=4096,
        )

        # ----- extract citations from generated text -----
        citations = self._extract_citations(report_md, source_index, citation_style)

        logger.info(
            "Synthesized report: %d chars, %d citations",
            len(report_md),
            len(citations),
        )

        return {
            "report_md": report_md,
            "citations": citations,
        }

    # ------------------------------------------------------------------ #
    # Formatting helpers
    # ------------------------------------------------------------------ #

    @staticmethod
    def _format_evidence_for_prompt(
        evidence: list[dict[str, Any]],
        source_map: dict[str, dict[str, Any]],
    ) -> str:
        """Format evidence chunks grouped by sub-question for the prompt."""
        parts: list[str] = []
        for entry in evidence:
            sq = entry.get("sub_question", "")
            parts.append(f"\n### Sub-Question: {sq}")
            for ev in entry.get("evidence", []):
                url = ev.get("document_url", "")
                src = source_map.get(url, {})
                ref_id = src.get("id", "?")
                title = ev.get("document_title", "")
                snippet = ev.get("chunk_text", "")
                parts.append(
                    f"  [Source {ref_id}] ({title})\n  {snippet}\n"
                )
        return "\n".join(parts)

    @staticmethod
    def _format_outline_for_prompt(outline: list[dict[str, Any]]) -> str:
        """Format the report outline for the prompt."""
        lines: list[str] = []
        for i, section in enumerate(outline, 1):
            title = section.get("title", f"Section {i}")
            desc = section.get("description", "")
            lines.append(f"{i}. **{title}**: {desc}")
        return "\n".join(lines)

    @staticmethod
    def _format_sources(sources: list[dict[str, Any]]) -> str:
        """Format the source list for the prompt."""
        lines: list[str] = []
        for src in sources:
            lines.append(
                f"[{src['id']}] {src['title']} – {src['url']}"
            )
        return "\n".join(lines)

    @staticmethod
    def _extract_citations(
        report_md: str,
        source_index: list[dict[str, Any]],
        citation_style: str,
    ) -> list[dict[str, Any]]:
        """Extract citation objects from the generated report text."""
        citations: list[dict[str, Any]] = []
        seen_ids: set[str] = set()

        if citation_style == "author-date":
            # Match (Author, Year) or (Domain, n.d.)
            matches = re.finditer(r"\(([^)]+?,\s*(?:\d{4}|n\.d\.))\)", report_md)
            for match in matches:
                claim_ref = match.group(1).strip()
                if claim_ref not in seen_ids:
                    seen_ids.add(claim_ref)
                    # Try to match to a source
                    for src in source_index:
                        if src["domain"] in claim_ref or src["title"] in claim_ref:
                            citations.append({
                                "id": claim_ref,
                                "claim_text": _surrounding_text(report_md, match.start(), 100),
                                "snippet": src.get("snippet", ""),
                                "url": src["url"],
                                "title": src["title"],
                            })
                            break
        else:
            # numbered references: [1], [2], ...
            matches = re.finditer(r"\[(\d+)\]", report_md)
            for match in matches:
                ref_id = match.group(1)
                if ref_id not in seen_ids:
                    seen_ids.add(ref_id)
                    # Look up the source by id
                    src = next(
                        (s for s in source_index if s["id"] == ref_id),
                        None,
                    )
                    if src:
                        citations.append({
                            "id": ref_id,
                            "claim_text": _surrounding_text(report_md, match.start(), 100),
                            "snippet": src.get("snippet", ""),
                            "url": src["url"],
                            "title": src["title"],
                        })

        return citations


def _surrounding_text(text: str, pos: int, window: int) -> str:
    """Return a snippet of *text* around position *pos*."""
    start = max(0, pos - window)
    end = min(len(text), pos + window)
    return text[start:end].strip()
