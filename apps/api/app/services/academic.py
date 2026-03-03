"""Academic API integrations – Semantic Scholar + arXiv.

Provides structured access to academic papers with routing logic
to automatically query these APIs for scholarly queries.
"""

import asyncio
import logging
import re
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any
from xml.etree import ElementTree

import httpx

logger = logging.getLogger(__name__)

# Keywords that trigger academic routing
SCHOLARLY_KEYWORDS = {
    "paper", "papers", "methodology", "review", "systematic",
    "research study", "meta-analysis", "clinical trial", "peer-reviewed",
    "journal", "dissertation", "thesis", "scholarly", "academic",
    "hypothesis", "experiment", "empirical", "literature review",
    "citation", "doi", "arxiv", "pubmed", "conference",
}


@dataclass
class AcademicPaper:
    """Structured representation of an academic paper."""

    title: str
    authors: list[str]
    abstract: str
    year: int | None = None
    citation_count: int = 0
    url: str = ""
    pdf_url: str | None = None
    doi: str | None = None
    source: str = "unknown"  # semantic_scholar | arxiv
    venue: str = ""
    fields_of_study: list[str] = field(default_factory=list)


def is_scholarly_query(query: str) -> bool:
    """Check if a query has scholarly intent based on keyword matching."""
    query_lower = query.lower()
    return any(keyword in query_lower for keyword in SCHOLARLY_KEYWORDS)


class AcademicService:
    """Unified interface for Semantic Scholar and arXiv APIs.

    Provides:
    - Semantic Scholar search with citation counts and metadata
    - arXiv search via Atom feed parsing
    - Automatic routing based on query intent
    - Results tagged with source_type = "academic"
    """

    def __init__(
        self,
        semantic_scholar_key: str = "",
        semantic_scholar_endpoint: str = "https://api.semanticscholar.org/graph/v1",
        arxiv_endpoint: str = "http://export.arxiv.org/api",
        timeout: int = 20,
    ) -> None:
        self._ss_key = semantic_scholar_key
        self._ss_endpoint = semantic_scholar_endpoint
        self._arxiv_endpoint = arxiv_endpoint
        self._timeout = timeout

    # ------------------------------------------------------------------ #
    # Semantic Scholar
    # ------------------------------------------------------------------ #

    async def search_semantic_scholar(
        self,
        query: str,
        limit: int = 5,
    ) -> list[AcademicPaper]:
        """Search Semantic Scholar for papers matching the query.

        Returns
        -------
        List of AcademicPaper objects sorted by relevance + citation count.
        """
        papers: list[AcademicPaper] = []

        try:
            headers: dict[str, str] = {}
            if self._ss_key:
                headers["x-api-key"] = self._ss_key

            params = {
                "query": query,
                "limit": str(limit),
                "fields": "title,authors,abstract,year,citationCount,url,externalIds,venue,s2FieldsOfStudy",
            }

            async with httpx.AsyncClient(timeout=self._timeout, follow_redirects=True) as client:
                response = await client.get(
                    f"{self._ss_endpoint}/paper/search",
                    headers=headers,
                    params=params,
                )
                response.raise_for_status()
                data = response.json()

            for item in data.get("data", []):
                authors = [
                    a.get("name", "")
                    for a in item.get("authors", [])
                    if a.get("name")
                ]

                external_ids = item.get("externalIds", {}) or {}
                doi = external_ids.get("DOI")
                arxiv_id = external_ids.get("ArXiv")

                pdf_url = None
                if arxiv_id:
                    pdf_url = f"https://arxiv.org/pdf/{arxiv_id}.pdf"

                fields = [
                    f.get("category", "")
                    for f in item.get("s2FieldsOfStudy", [])
                    if f.get("category")
                ]

                papers.append(AcademicPaper(
                    title=item.get("title", ""),
                    authors=authors,
                    abstract=item.get("abstract", "") or "",
                    year=item.get("year"),
                    citation_count=item.get("citationCount", 0) or 0,
                    url=item.get("url", ""),
                    pdf_url=pdf_url,
                    doi=doi,
                    source="semantic_scholar",
                    venue=item.get("venue", "") or "",
                    fields_of_study=fields,
                ))

            # Sort by citation count (higher is better)
            papers.sort(key=lambda p: p.citation_count, reverse=True)
            logger.info(
                "Semantic Scholar: %d results for %r",
                len(papers), query[:60],
            )

        except httpx.HTTPStatusError as exc:
            logger.error(
                "Semantic Scholar API error: %s %s",
                exc.response.status_code, exc.response.text[:200],
            )
        except Exception:
            logger.exception("Semantic Scholar search failed for: %s", query)

        return papers

    # ------------------------------------------------------------------ #
    # arXiv
    # ------------------------------------------------------------------ #

    async def search_arxiv(
        self,
        query: str,
        limit: int = 5,
    ) -> list[AcademicPaper]:
        """Search arXiv for papers via the Atom feed API.

        Returns
        -------
        List of AcademicPaper objects from arXiv.
        """
        papers: list[AcademicPaper] = []

        try:
            params = {
                "search_query": f"all:{query}",
                "start": "0",
                "max_results": str(limit),
                "sortBy": "relevance",
                "sortOrder": "descending",
            }

            async with httpx.AsyncClient(timeout=self._timeout, follow_redirects=True) as client:
                response = await client.get(
                    f"{self._arxiv_endpoint}/query",
                    params=params,
                )
                response.raise_for_status()

            # Parse Atom XML feed
            ns = {
                "atom": "http://www.w3.org/2005/Atom",
                "arxiv": "http://arxiv.org/schemas/atom",
            }

            root = ElementTree.fromstring(response.text)

            for entry in root.findall("atom:entry", ns):
                title_el = entry.find("atom:title", ns)
                summary_el = entry.find("atom:summary", ns)

                title = (title_el.text or "").strip() if title_el is not None else ""
                abstract = (summary_el.text or "").strip() if summary_el is not None else ""

                authors = []
                for author_el in entry.findall("atom:author", ns):
                    name_el = author_el.find("atom:name", ns)
                    if name_el is not None and name_el.text:
                        authors.append(name_el.text.strip())

                # Get URL and PDF link
                url = ""
                pdf_url = None
                for link_el in entry.findall("atom:link", ns):
                    href = link_el.get("href", "")
                    link_type = link_el.get("type", "")
                    link_title = link_el.get("title", "")

                    if link_title == "pdf" or link_type == "application/pdf":
                        pdf_url = href
                    elif not url and href:
                        url = href

                # Extract year from published date
                published_el = entry.find("atom:published", ns)
                year = None
                if published_el is not None and published_el.text:
                    try:
                        year = int(published_el.text[:4])
                    except (ValueError, IndexError):
                        pass

                # Extract arXiv categories
                categories = []
                for cat_el in entry.findall("atom:category", ns):
                    term = cat_el.get("term", "")
                    if term:
                        categories.append(term)

                papers.append(AcademicPaper(
                    title=title,
                    authors=authors,
                    abstract=abstract,
                    year=year,
                    citation_count=0,  # arXiv doesn't provide this
                    url=url,
                    pdf_url=pdf_url,
                    source="arxiv",
                    fields_of_study=categories,
                ))

            logger.info(
                "arXiv: %d results for %r",
                len(papers), query[:60],
            )

        except Exception:
            logger.exception("arXiv search failed for: %s", query)

        return papers

    # ------------------------------------------------------------------ #
    # Unified search
    # ------------------------------------------------------------------ #

    async def search(
        self,
        query: str,
        limit: int = 5,
        event_callback: Any = None,
    ) -> list[AcademicPaper]:
        """Search academic sources (arXiv always; Semantic Scholar only if API key set).

        Returns merged, deduplicated results sorted by relevance.
        """
        if event_callback:
            await event_callback(
                "academic_search_started",
                f"Searching academic sources: {query[:60]}",
                {"query": query},
            )

        ss_papers: list[AcademicPaper] = []
        arxiv_papers: list[AcademicPaper] = []

        # Only query Semantic Scholar if an API key is configured
        if self._ss_key:
            ss_task = self.search_semantic_scholar(query, limit=limit)
            arxiv_task = self.search_arxiv(query, limit=limit)
            ss_result, arxiv_result = await asyncio.gather(
                ss_task, arxiv_task, return_exceptions=True
            )
            if isinstance(ss_result, Exception):
                logger.error("Semantic Scholar search error: %s", ss_result)
            else:
                ss_papers = ss_result
            if isinstance(arxiv_result, Exception):
                logger.error("arXiv search error: %s", arxiv_result)
            else:
                arxiv_papers = arxiv_result
        else:
            # No Semantic Scholar key — only search arXiv
            try:
                arxiv_papers = await self.search_arxiv(query, limit=limit)
            except Exception as exc:
                logger.error("arXiv search error: %s", exc)

        # Merge and deduplicate by title similarity
        all_papers = list(ss_papers)
        seen_titles = {_normalize_title(p.title) for p in ss_papers}

        for paper in arxiv_papers:
            norm_title = _normalize_title(paper.title)
            if norm_title not in seen_titles:
                all_papers.append(paper)
                seen_titles.add(norm_title)

        # Sort: prioritize by citation count, then by source (SS > arXiv)
        all_papers.sort(
            key=lambda p: (p.citation_count, 1 if p.source == "semantic_scholar" else 0),
            reverse=True,
        )

        if event_callback:
            await event_callback(
                "academic_search_completed",
                f"Found {len(all_papers)} academic papers",
                {"paper_count": len(all_papers), "query": query[:60]},
            )

        return all_papers[:limit * 2]  # Return up to 2x limit

    def papers_to_documents(
        self,
        papers: list[AcademicPaper],
    ) -> list[dict[str, Any]]:
        """Convert AcademicPaper objects to document dicts for ingestion.

        These documents are tagged with source_type = "academic".
        """
        documents: list[dict[str, Any]] = []

        for paper in papers:
            if not paper.abstract:
                continue

            # Build rich text from abstract + metadata
            text_parts = [paper.title, ""]
            if paper.authors:
                text_parts.append(f"Authors: {', '.join(paper.authors[:10])}")
            if paper.year:
                text_parts.append(f"Year: {paper.year}")
            if paper.venue:
                text_parts.append(f"Venue: {paper.venue}")
            if paper.citation_count:
                text_parts.append(f"Citations: {paper.citation_count}")
            text_parts.append("")
            text_parts.append("Abstract:")
            text_parts.append(paper.abstract)

            clean_text = "\n".join(text_parts)

            documents.append({
                "url": paper.url or f"academic://{paper.source}/{paper.title[:100]}",
                "title": paper.title,
                "domain": paper.source,
                "source_type": "academic",
                "published_at": f"{paper.year}-01-01" if paper.year else None,
                "clean_text": clean_text,
                "content_type": "academic",
                "fetched_at": datetime.now(timezone.utc).isoformat(),
                "metadata": {
                    "authors": paper.authors,
                    "citation_count": paper.citation_count,
                    "doi": paper.doi,
                    "pdf_url": paper.pdf_url,
                    "venue": paper.venue,
                    "fields_of_study": paper.fields_of_study,
                    "source": paper.source,
                },
            })

        return documents


def _normalize_title(title: str) -> str:
    """Normalize a paper title for deduplication."""
    return re.sub(r"\s+", " ", title.lower().strip())
