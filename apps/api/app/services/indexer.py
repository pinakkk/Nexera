"""Indexer service – chunks documents and stores them with content-hash dedup."""

import hashlib
import logging
import re
from typing import Any
from uuid import uuid4

logger = logging.getLogger(__name__)

# Chunk parameters
_TARGET_CHUNK_TOKENS = 500
_OVERLAP_TOKENS = 50


def _count_tokens(text: str) -> int:
    """Return an approximate token count using word/punctuation splitting."""
    # We avoid hard dependency on `tiktoken` to keep local setup simple on
    # newer Python versions (e.g., 3.14).
    return len(re.findall(r"\w+|[^\w\s]", text, flags=re.UNICODE))


def _chunk_text(text: str, target: int = _TARGET_CHUNK_TOKENS, overlap: int = _OVERLAP_TOKENS) -> list[str]:
    """Split *text* into chunks of approximately *target* tokens with *overlap*.

    Strategy:
    1. Split text into paragraphs (double newline).
    2. Greedily merge paragraphs until the token budget is reached.
    3. If a single paragraph exceeds *target*, split it by sentences,
       then by fixed token windows as a last resort.
    """
    paragraphs = [p.strip() for p in text.split("\n\n") if p.strip()]
    if not paragraphs:
        return [text] if text.strip() else []

    chunks: list[str] = []
    current_parts: list[str] = []
    current_tokens = 0

    for para in paragraphs:
        para_tokens = _count_tokens(para)

        # If a single paragraph is over budget, split it further
        if para_tokens > target:
            # Flush current accumulator first
            if current_parts:
                chunks.append("\n\n".join(current_parts))
                # keep overlap from the end
                current_parts, current_tokens = _keep_overlap(current_parts, overlap)

            sub_chunks = _split_large_paragraph(para, target, overlap)
            chunks.extend(sub_chunks)
            continue

        if current_tokens + para_tokens > target and current_parts:
            chunks.append("\n\n".join(current_parts))
            current_parts, current_tokens = _keep_overlap(current_parts, overlap)

        current_parts.append(para)
        current_tokens += para_tokens

    if current_parts:
        chunks.append("\n\n".join(current_parts))

    return chunks


def _keep_overlap(parts: list[str], overlap_tokens: int) -> tuple[list[str], int]:
    """Return the tail of *parts* that fits within *overlap_tokens*."""
    kept: list[str] = []
    total = 0
    for p in reversed(parts):
        t = _count_tokens(p)
        if total + t > overlap_tokens:
            break
        kept.insert(0, p)
        total += t
    return kept, total


def _split_large_paragraph(text: str, target: int, overlap: int) -> list[str]:
    """Split a large paragraph first by sentences, then by token windows."""
    import re

    sentences = re.split(r"(?<=[.!?])\s+", text)
    if len(sentences) <= 1:
        # Fall back to fixed-window splitting
        return _split_by_token_window(text, target, overlap)

    chunks: list[str] = []
    current: list[str] = []
    current_tokens = 0

    for sent in sentences:
        sent_tokens = _count_tokens(sent)
        if current_tokens + sent_tokens > target and current:
            chunks.append(" ".join(current))
            current, current_tokens = _keep_overlap_sentences(current, overlap)
        current.append(sent)
        current_tokens += sent_tokens

    if current:
        chunks.append(" ".join(current))

    return chunks


def _keep_overlap_sentences(sentences: list[str], overlap_tokens: int) -> tuple[list[str], int]:
    """Keep tail sentences within overlap budget."""
    kept: list[str] = []
    total = 0
    for s in reversed(sentences):
        t = _count_tokens(s)
        if total + t > overlap_tokens:
            break
        kept.insert(0, s)
        total += t
    return kept, total


def _split_by_token_window(text: str, target: int, overlap: int) -> list[str]:
    """Last-resort: split by token-level window."""
    tokens = re.findall(r"\w+|[^\w\s]", text, flags=re.UNICODE)
    chunks: list[str] = []
    start = 0
    while start < len(tokens):
        end = min(start + target, len(tokens))
        chunk_tokens = tokens[start:end]
        chunks.append(" ".join(chunk_tokens))
        start += target - overlap
    return chunks


def _content_hash(text: str) -> str:
    """SHA-256 hex digest of *text*."""
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


class IndexerService:
    """Chunk documents and produce indexable records.

    If a database session is provided, records are also persisted to
    the ``documents`` and ``chunks`` tables (via SQLAlchemy models).
    """

    async def index_documents(
        self,
        documents: list[dict[str, Any]],
        db_session: Any | None = None,
    ) -> list[dict[str, Any]]:
        """Index a batch of fetched documents.

        Parameters
        ----------
        documents:
            Output of :class:`FetcherService.fetch_and_parse`.
        db_session:
            Optional async SQLAlchemy session for persistence.

        Returns
        -------
        Flat list of chunk dicts, each with:
            ``chunk_id``, ``document_url``, ``document_title``, ``domain``,
            ``chunk_index``, ``chunk_text``, ``token_count``, ``content_hash``
        """
        all_chunks: list[dict[str, Any]] = []
        seen_hashes: set[str] = set()

        for doc in documents:
            text = doc.get("clean_text", "")
            if not text:
                continue

            doc_hash = _content_hash(text)
            if doc_hash in seen_hashes:
                logger.debug("Skipping duplicate document (hash): %s", doc.get("url"))
                continue
            seen_hashes.add(doc_hash)

            # Persist Document record if DB session available
            doc_id = str(uuid4())
            if db_session is not None:
                await self._persist_document(db_session, doc_id, doc, doc_hash)

            # Chunk the text
            chunk_texts = _chunk_text(text)

            for idx, chunk_text in enumerate(chunk_texts):
                chunk_id = str(uuid4())
                token_count = _count_tokens(chunk_text)
                chunk_hash = _content_hash(chunk_text)

                chunk_record: dict[str, Any] = {
                    "chunk_id": chunk_id,
                    "document_id": doc_id,
                    "document_url": doc.get("url", ""),
                    "document_title": doc.get("title", ""),
                    "domain": doc.get("domain", ""),
                    "published_at": doc.get("published_at"),
                    "chunk_index": idx,
                    "chunk_text": chunk_text,
                    "token_count": token_count,
                    "content_hash": chunk_hash,
                }
                all_chunks.append(chunk_record)

                if db_session is not None:
                    await self._persist_chunk(db_session, doc_id, chunk_record)

        if db_session is not None:
            await db_session.flush()

        logger.info(
            "Indexed %d documents -> %d chunks", len(documents), len(all_chunks)
        )
        return all_chunks

    # ------------------------------------------------------------------ #
    # DB persistence helpers
    # ------------------------------------------------------------------ #

    @staticmethod
    async def _persist_document(
        db_session: Any,
        doc_id: str,
        doc: dict[str, Any],
        doc_hash: str,
    ) -> None:
        """Insert a Document row (soft-skip on hash collision)."""
        from sqlalchemy import text as sa_text

        # Check if this content_hash already exists
        result = await db_session.execute(
            sa_text("SELECT id FROM documents WHERE content_hash = :h"),
            {"h": doc_hash},
        )
        if result.first() is not None:
            logger.debug("Document already indexed (hash match): %s", doc.get("url"))
            return

        await db_session.execute(
            sa_text(
                "INSERT INTO documents (id, url, title, domain, published_at, "
                "fetched_at, raw_text, clean_text, content_hash, metadata_json) "
                "VALUES (:id, :url, :title, :domain, :pub, :fetched, :raw_text, :text, :hash, :meta)"
            ),
            {
                "id": doc_id,
                "url": doc.get("url", ""),
                "title": doc.get("title", ""),
                "domain": doc.get("domain", ""),
                "pub": doc.get("published_at"),
                "fetched": doc.get("fetched_at"),
                "raw_text": doc.get("raw_text") or doc.get("clean_text", ""),
                "text": doc.get("clean_text", ""),
                "hash": doc_hash,
                "meta": "{}",
            },
        )

    @staticmethod
    async def _persist_chunk(
        db_session: Any,
        doc_id: str,
        chunk: dict[str, Any],
    ) -> None:
        """Insert a Chunk row."""
        from sqlalchemy import text as sa_text

        await db_session.execute(
            sa_text(
                "INSERT INTO chunks (id, document_id, chunk_index, chunk_text, "
                "token_count, metadata_json) "
                "VALUES (:id, :doc_id, :idx, :text, :tokens, :meta)"
            ),
            {
                "id": chunk["chunk_id"],
                "doc_id": doc_id,
                "idx": chunk["chunk_index"],
                "text": chunk["chunk_text"],
                "tokens": chunk["token_count"],
                "meta": "{}",
            },
        )
