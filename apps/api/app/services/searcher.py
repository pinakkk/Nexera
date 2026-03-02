"""Search service – executes web searches via the Tavily API with caching and dedup."""

import logging
from typing import Any
from urllib.parse import urlparse, urlunparse, urlencode, parse_qs

from tavily import TavilyClient

logger = logging.getLogger(__name__)


def _canonicalize_url(url: str) -> str:
    """Normalise a URL for deduplication.

    - Strip trailing slashes from the path.
    - Remove fragment.
    - Sort query parameters alphabetically.
    """
    parsed = urlparse(url)
    path = parsed.path.rstrip("/") or "/"
    query_params = parse_qs(parsed.query, keep_blank_values=True)
    sorted_query = urlencode(
        sorted(
            ((k, v[0]) for k, v in query_params.items()),
            key=lambda pair: pair[0],
        )
    ) if query_params else ""
    return urlunparse((
        parsed.scheme,
        parsed.netloc.lower(),
        path,
        parsed.params,
        sorted_query,
        "",  # no fragment
    ))


class SearchService:
    """Execute web searches via the Tavily REST API.

    Features:
    - Per-run query cache (avoids duplicate API calls for the same query text).
    - URL deduplication across all results within a run.
    - Optional domain allow-list and timeframe filtering.
    """

    def __init__(self, api_key: str, max_results_per_query: int = 5) -> None:
        self._client = TavilyClient(api_key=api_key)
        self._max_results = max_results_per_query
        self._cache: dict[str, list[dict[str, Any]]] = {}
        self._seen_urls: set[str] = set()

    def reset(self) -> None:
        """Clear per-run caches (call at the start of each new run)."""
        self._cache.clear()
        self._seen_urls.clear()

    async def search(
        self,
        queries: list[dict[str, Any]],
        allowed_domains: list[str] | None = None,
        timeframe: str | None = None,
    ) -> list[dict[str, Any]]:
        """Execute one or more search queries and return deduplicated results.

        Parameters
        ----------
        queries:
            List of dicts, each with ``sub_question`` and ``queries`` keys.
        allowed_domains:
            Optional list of domains to restrict results to.
        timeframe:
            Optional recency filter string (e.g. ``"month"``, ``"week"``).

        Returns
        -------
        list of dicts with keys:
            ``sub_question``, ``query``, ``results``
        where each result is:
            ``{"url": str, "title": str, "snippet": str, "score": float}``
        """
        all_results: list[dict[str, Any]] = []

        for entry in queries:
            sub_question = entry.get("sub_question", "")
            query_strings = entry.get("queries", [])

            for q in query_strings:
                # ----- cache check -----
                if q in self._cache:
                    logger.debug("Cache hit for query: %s", q)
                    all_results.append({
                        "sub_question": sub_question,
                        "query": q,
                        "results": self._cache[q],
                    })
                    continue

                # ----- build search kwargs -----
                search_kwargs: dict[str, Any] = {
                    "query": q,
                    "max_results": self._max_results,
                    "search_depth": "basic",
                }
                if allowed_domains:
                    search_kwargs["include_domains"] = allowed_domains
                # Tavily supports "day", "week", "month", "year" as topic timeframes
                if timeframe:
                    search_kwargs["topic"] = "news"
                    search_kwargs["days"] = _timeframe_to_days(timeframe)

                # ----- execute search (sync client, run in thread) -----
                error_message: str | None = None
                try:
                    import asyncio
                    raw = await asyncio.to_thread(
                        self._client.search, **search_kwargs
                    )
                except Exception as exc:
                    logger.exception("Tavily search failed for query: %s", q)
                    error_message = str(exc)
                    raw = {"results": []}

                raw_results: list[dict[str, Any]] = raw.get("results", [])

                # ----- dedup + normalise -----
                deduped: list[dict[str, Any]] = []
                for r in raw_results:
                    url = r.get("url", "")
                    canonical = _canonicalize_url(url)
                    if canonical in self._seen_urls:
                        continue
                    self._seen_urls.add(canonical)

                    # Apply domain filter (safety net in case Tavily doesn't enforce)
                    if allowed_domains:
                        domain = urlparse(url).netloc.lower()
                        if not any(d.lower() in domain for d in allowed_domains):
                            continue

                    deduped.append({
                        "url": url,
                        "title": r.get("title", ""),
                        "snippet": r.get("content", ""),
                        "score": r.get("score", 0.0),
                    })

                self._cache[q] = deduped
                result_entry: dict[str, Any] = {
                    "sub_question": sub_question,
                    "query": q,
                    "results": deduped,
                }
                if error_message:
                    result_entry["error"] = error_message
                all_results.append(result_entry)

                logger.info(
                    "Search query=%r  raw=%d  deduped=%d",
                    q,
                    len(raw_results),
                    len(deduped),
                )

        return all_results


# ---------------------------------------------------------------------- #
# Helpers
# ---------------------------------------------------------------------- #


def _timeframe_to_days(timeframe: str) -> int:
    """Convert a human-readable timeframe string to a number of days."""
    mapping: dict[str, int] = {
        "day": 1,
        "past_day": 1,
        "week": 7,
        "past_week": 7,
        "month": 30,
        "past_month": 30,
        "year": 365,
        "past_year": 365,
    }
    return mapping.get(timeframe.lower(), 30)
