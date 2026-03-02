"""Fetcher service – downloads and extracts clean text from web pages and PDFs.

Includes SSRF protection to block requests to private/internal IP ranges.
"""

import asyncio
import ipaddress
import logging
import socket
from datetime import datetime, timezone
from io import BytesIO
from typing import Any
from urllib.parse import urlparse

import httpx
import trafilatura

logger = logging.getLogger(__name__)

# Allowed URL schemes
_ALLOWED_SCHEMES = {"http", "https"}

# User-Agent header
_USER_AGENT = "ResearchAgent/1.0"

# Private / reserved IPv4 networks that must be blocked
_BLOCKED_NETWORKS = [
    ipaddress.ip_network("10.0.0.0/8"),
    ipaddress.ip_network("172.16.0.0/12"),
    ipaddress.ip_network("192.168.0.0/16"),
    ipaddress.ip_network("127.0.0.0/8"),
    ipaddress.ip_network("169.254.0.0/16"),
    ipaddress.ip_network("0.0.0.0/8"),
    # IPv6 loopback
    ipaddress.ip_network("::1/128"),
    # IPv6 link-local
    ipaddress.ip_network("fe80::/10"),
    # IPv6 unique-local
    ipaddress.ip_network("fc00::/7"),
]


def _is_private_ip(host: str) -> bool:
    """Resolve *host* and return True if any resolved address is private/blocked."""
    try:
        addr_infos = socket.getaddrinfo(host, None)
    except socket.gaierror:
        # Cannot resolve – treat as blocked to be safe
        return True

    for family, _, _, _, sockaddr in addr_infos:
        ip_str = sockaddr[0]
        try:
            addr = ipaddress.ip_address(ip_str)
        except ValueError:
            continue
        for net in _BLOCKED_NETWORKS:
            if addr in net:
                return True
    return False


class FetcherService:
    """Download URLs and extract clean text + metadata.

    - HTML pages are cleaned with *trafilatura*.
    - PDFs are read with *pypdf*.
    - SSRF protection blocks private/internal IPs.
    """

    async def fetch_and_parse(
        self,
        urls: list[str],
        timeout: int = 15,
    ) -> list[dict[str, Any]]:
        """Fetch and parse a batch of URLs concurrently.

        Parameters
        ----------
        urls:
            List of URLs to fetch.
        timeout:
            Per-request timeout in seconds.

        Returns
        -------
        list of dicts with keys:
            ``url``, ``title``, ``domain``, ``published_at``, ``clean_text``,
            ``content_type``, ``fetched_at``
        Failed URLs are silently skipped (logged as warnings).
        """
        tasks = [self._fetch_single(url, timeout) for url in urls]
        results = await asyncio.gather(*tasks, return_exceptions=True)

        documents: list[dict[str, Any]] = []
        for url, result in zip(urls, results):
            if isinstance(result, Exception):
                logger.warning("Fetch failed for %s: %s", url, result)
                continue
            if result is not None:
                documents.append(result)

        logger.info("Fetched %d / %d URLs successfully", len(documents), len(urls))
        return documents

    async def _fetch_single(
        self,
        url: str,
        timeout: int,
    ) -> dict[str, Any] | None:
        """Fetch and parse a single URL."""
        parsed = urlparse(url)

        # --- scheme check ---
        if parsed.scheme not in _ALLOWED_SCHEMES:
            logger.warning("Blocked non-HTTP(S) scheme: %s", url)
            return None

        # --- SSRF check ---
        hostname = parsed.hostname or ""
        if _is_private_ip(hostname):
            logger.warning("Blocked private/reserved IP for URL: %s", url)
            return None

        domain = parsed.netloc.lower()
        fetched_at = datetime.now(timezone.utc).isoformat()

        async with httpx.AsyncClient(
            timeout=timeout,
            follow_redirects=True,
            headers={"User-Agent": _USER_AGENT},
        ) as client:
            response = await client.get(url)
            response.raise_for_status()

        content_type = response.headers.get("content-type", "")

        # ----- PDF handling -----
        if "application/pdf" in content_type or url.lower().endswith(".pdf"):
            return await asyncio.to_thread(
                self._parse_pdf, url, domain, response.content, fetched_at
            )

        # ----- HTML handling -----
        html = response.text
        return await asyncio.to_thread(
            self._parse_html, url, domain, html, fetched_at
        )

    # ------------------------------------------------------------------ #
    # Parsing helpers (run in thread to avoid blocking event loop)
    # ------------------------------------------------------------------ #

    @staticmethod
    def _parse_html(
        url: str,
        domain: str,
        html: str,
        fetched_at: str,
    ) -> dict[str, Any] | None:
        """Extract clean text from HTML using trafilatura."""
        result = trafilatura.extract(
            html,
            include_comments=False,
            include_tables=True,
            output_format="txt",
            with_metadata=True,
            url=url,
        )

        if not result:
            logger.warning("Trafilatura returned empty result for %s", url)
            return None

        # trafilatura bare_extraction gives us metadata
        metadata = trafilatura.bare_extraction(html, url=url) or {}

        title = metadata.get("title", "") or ""
        published_at = metadata.get("date") or None

        clean_text = result.strip()
        if not clean_text:
            return None

        return {
            "url": url,
            "title": title,
            "domain": domain,
            "published_at": published_at,
            "clean_text": clean_text,
            "content_type": "html",
            "fetched_at": fetched_at,
        }

    @staticmethod
    def _parse_pdf(
        url: str,
        domain: str,
        content: bytes,
        fetched_at: str,
    ) -> dict[str, Any] | None:
        """Extract text from a PDF using pypdf."""
        try:
            from pypdf import PdfReader
        except ImportError:
            logger.error("pypdf not installed – cannot parse PDF: %s", url)
            return None

        try:
            reader = PdfReader(BytesIO(content))
        except Exception:
            logger.warning("Could not parse PDF: %s", url, exc_info=True)
            return None

        pages_text: list[str] = []
        for page in reader.pages:
            text = page.extract_text()
            if text:
                pages_text.append(text.strip())

        full_text = "\n\n".join(pages_text)
        if not full_text:
            return None

        # Use first non-empty line as title
        title = ""
        for line in full_text.split("\n"):
            stripped = line.strip()
            if stripped:
                title = stripped[:200]
                break

        return {
            "url": url,
            "title": title,
            "domain": domain,
            "published_at": None,
            "clean_text": full_text,
            "content_type": "pdf",
            "fetched_at": fetched_at,
        }
