"""Research Gate – cost-control classifier that routes queries before heavy processing.

Deterministic heuristics run FIRST (no model calls).
If heuristics are inconclusive, uses llama-3.1-8b-instant for classification.

Routes: CHAT_ONLY, DIRECT_ANSWER, LIGHT_LOOKUP, FULL_RESEARCH
"""

from __future__ import annotations

import json
import logging
import re
import time
from collections import defaultdict
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

# ─── Route constants ──────────────────────────────────────────────────────────
CHAT_ONLY = "CHAT_ONLY"
DIRECT_ANSWER = "DIRECT_ANSWER"
LIGHT_LOOKUP = "LIGHT_LOOKUP"
FULL_RESEARCH = "FULL_RESEARCH"

VALID_ROUTES = {CHAT_ONLY, DIRECT_ANSWER, LIGHT_LOOKUP, FULL_RESEARCH}

# ─── Metrics (in-memory counters) ─────────────────────────────────────────────
_route_metrics: dict[str, int] = defaultdict(int)


def get_gate_metrics() -> dict[str, Any]:
    """Return current gate routing metrics."""
    total = sum(_route_metrics.values()) or 1
    return {
        "total_classified": sum(_route_metrics.values()),
        "counts": dict(_route_metrics),
        "percentages": {k: round(v / total * 100, 1) for k, v in _route_metrics.items()},
    }


# ─── Heuristic patterns ──────────────────────────────────────────────────────
_GREETING_PATTERNS = re.compile(
    r"^(hi|hello|hey|yo|sup|howdy|good\s*(morning|afternoon|evening|night)|"
    r"what'?s\s*up|hola|namaste|thanks?|thank\s*you|bye|goodbye|"
    r"ok|okay|sur|yes|no|yep|nope|cool|great|nice|got\s*it|"
    r"hmm+|huh|lol|haha|xd|wow|bruh|bro|dude|man|"
    r"good|bad|fine|alright|sure|right|yea|yeah|nah|"
    r"how\s*are\s*you|how'?s\s*it\s*going|what'?s\s*good|"
    r"gm|gn|morning|night|evening|afternoon)[\s!@#$%^&*,.?]*$",
    re.IGNORECASE,
)

_PROFANITY_ONLY = re.compile(
    r"^[\s!@#$%^&*()_+=\-\[\]{};:\'\"<>,.?/\\|`~]*$"
)

_RESEARCH_KEYWORDS = re.compile(
    r"\b(research|analyze|analyse|compare|contrast|comprehensive|in[- ]depth|"
    r"report|investigation|study|evaluate|assessment|review\s+of|"
    r"multi[- ]?part|detailed|thorough|explore)\b",
    re.IGNORECASE,
)

_FRESHNESS_KEYWORDS = re.compile(
    r"\b(latest|recent|current|today|now|2024|2025|2026|this\s+year|"
    r"this\s+month|this\s+week|breaking|update|news)\b",
    re.IGNORECASE,
)

_SIMPLE_KNOWLEDGE = re.compile(
    r"^(what\s+is|define|explain|how\s+to|what\s+does|who\s+is|"
    r"when\s+was|where\s+is|why\s+is|how\s+do\s+you)\b",
    re.IGNORECASE,
)


def _estimate_tokens(text: str) -> int:
    """Rough token count."""
    return max(1, len(text.split()))


def _heuristic_classify(query: str) -> tuple[str | None, str, list[str]]:
    """Run deterministic heuristics. Returns (route, reason, signals) or (None, ...) if inconclusive."""
    stripped = query.strip()
    signals: list[str] = []

    # Empty input
    if not stripped:
        return CHAT_ONLY, "empty input", ["empty"]

    # Profanity / symbols only
    if _PROFANITY_ONLY.match(stripped):
        return CHAT_ONLY, "symbols/punctuation only", ["symbols_only"]

    # Relaxed greeting test to match casual phrases
    lower_stripped = stripped.lower().rstrip("!.,? ")
    casual_phrases = {
        "hi", "hello", "hi hello", "hi, hello", "hello there", "testing", "test",
        "hi,", "hey there", "what's up", "yo", "sup", "howdy", "hey hey",
        "good morning", "good night", "good evening", "good afternoon",
        "how are you", "how are you doing", "how's it going", "what's good",
        "hi there", "hello there", "hey there", "thanks", "thank you",
        "bye", "goodbye", "see you", "see ya", "later", "peace",
        "ok", "okay", "sure", "right", "yes", "no", "yep", "nope",
        "cool", "nice", "great", "awesome", "good", "fine", "alright",
        "lol", "haha", "lmao", "bruh", "bro", "dude",
    }
    if lower_stripped in casual_phrases:
        return CHAT_ONLY, "greeting or acknowledgement", ["greeting"]

    if _GREETING_PATTERNS.match(stripped):
        return CHAT_ONLY, "greeting or acknowledgement", ["greeting"]

    token_count = _estimate_tokens(stripped)

    # Very short casual (<=5 tokens, no question mark)
    if token_count <= 5 and "?" not in stripped:
        signals.append("very_short")
        if not _SIMPLE_KNOWLEDGE.match(stripped):
            return CHAT_ONLY, "very short casual input", signals

    # Check for explicit research intent
    has_research = bool(_RESEARCH_KEYWORDS.search(stripped))
    has_freshness = bool(_FRESHNESS_KEYWORDS.search(stripped))
    has_simple = bool(_SIMPLE_KNOWLEDGE.match(stripped))
    has_question_mark = "?" in stripped
    multi_sentence = stripped.count(".") >= 2 or stripped.count("?") >= 2

    if has_research:
        signals.append("research_keywords")
    if has_freshness:
        signals.append("freshness_keywords")
    if has_simple:
        signals.append("simple_knowledge_pattern")
    if multi_sentence:
        signals.append("multi_sentence")

    # Explicit research intent + long query
    if has_research and token_count > 15:
        return FULL_RESEARCH, "explicit research keywords + long query", signals

    # Multi-sentence with research keywords
    if multi_sentence and has_research:
        return FULL_RESEARCH, "multi-part research request", signals

    # Simple knowledge question (short, no freshness needed)
    if has_simple and token_count < 15 and not has_freshness and not has_research:
        return DIRECT_ANSWER, "simple knowledge question", signals

    # Short query needing fresh info
    if has_freshness and token_count < 20 and not has_research:
        return LIGHT_LOOKUP, "needs fresh/current information", signals

    # Inconclusive – need LLM
    return None, "", signals


def _load_system_prompt() -> str:
    """Load the research gate system prompt."""
    prompt_path = Path(__file__).parent.parent.parent / "prompts" / "research_gate.txt"
    try:
        return prompt_path.read_text(encoding="utf-8")
    except FileNotFoundError:
        logger.warning("research_gate.txt prompt not found, using inline fallback")
        return (
            "Classify the user query into one of: CHAT_ONLY, DIRECT_ANSWER, LIGHT_LOOKUP, FULL_RESEARCH. "
            'Return JSON: {"route": "...", "reason": "...", "signals": [...]}'
        )


async def classify_query(query: str, llm: Any) -> dict[str, Any]:
    """Classify a query through the research gate.

    Returns
    -------
    dict with keys: route, reason, signals, method (heuristic|llm), latency_ms
    """
    start = time.monotonic()

    # Step 1: Deterministic heuristics (no model call)
    route, reason, signals = _heuristic_classify(query)
    if route is not None:
        latency = round((time.monotonic() - start) * 1000, 1)
        result = {
            "route": route,
            "reason": reason,
            "signals": signals,
            "method": "heuristic",
            "latency_ms": latency,
        }
        _route_metrics[route] += 1
        logger.info("Research gate [heuristic]: %s – %s", route, reason)
        return result

    # Step 2: LLM classification (llama-3.1-8b-instant)
    system_prompt = _load_system_prompt()
    prompt = f"{system_prompt}\n\nUser query: {query}"

    try:
        raw = await llm.complete(
            prompt=prompt,
            task_type="fast",  # Uses fast model (llama-3.1-8b-instant)
            temperature=0.1,
            max_tokens=256,
        )

        # Parse JSON response
        try:
            parsed = json.loads(raw)
        except json.JSONDecodeError:
            # Try extracting JSON from response
            match = re.search(r"\{.*\}", raw, re.DOTALL)
            if match:
                parsed = json.loads(match.group(0))
            else:
                parsed = {"route": DIRECT_ANSWER, "reason": "LLM parse failure, defaulting", "signals": []}

        route = parsed.get("route", DIRECT_ANSWER)
        if route not in VALID_ROUTES:
            route = DIRECT_ANSWER

        reason = parsed.get("reason", "LLM classification")
        signals = parsed.get("signals", [])

    except Exception as exc:
        logger.warning("Research gate LLM call failed: %s – defaulting to DIRECT_ANSWER", exc)
        route = DIRECT_ANSWER
        reason = f"LLM classification failed: {exc}"
        signals = ["llm_error"]

    latency = round((time.monotonic() - start) * 1000, 1)
    result = {
        "route": route,
        "reason": reason,
        "signals": signals,
        "method": "llm",
        "latency_ms": latency,
    }
    _route_metrics[route] += 1
    logger.info("Research gate [LLM]: %s – %s (%.1fms)", route, reason, latency)
    return result


def _context_preamble(
    recent_chat_context: str = "",
    thread_summary_context: str = "",
    long_term_memory_context: str = "",
) -> str:
    """Assemble prior-conversation context so quick replies stay coherent.

    Without this, short follow-ups (which classify as non-research routes)
    were answered with zero memory of the ongoing thread.
    """
    blocks = [
        b.strip()
        for b in (recent_chat_context, thread_summary_context, long_term_memory_context)
        if b and b.strip()
    ]
    if not blocks:
        return ""
    return (
        "Use the following context from the ongoing conversation to stay "
        "consistent and avoid contradicting earlier answers. Treat it as "
        "established unless the user corrects it.\n\n"
        + "\n\n".join(blocks)
        + "\n\n---\n\n"
    )


async def generate_quick_response(
    query: str,
    llm: Any,
    route: str,
    *,
    recent_chat_context: str = "",
    thread_summary_context: str = "",
    long_term_memory_context: str = "",
) -> str:
    """Generate a quick response for non-research routes (CHAT_ONLY, DIRECT_ANSWER, LIGHT_LOOKUP).

    Prior-conversation context is injected so follow-up turns remain coherent
    instead of being answered in isolation.
    """
    context = _context_preamble(
        recent_chat_context, thread_summary_context, long_term_memory_context
    )

    if route == CHAT_ONLY:
        prompt = (
            "You are a friendly AI assistant. Respond naturally to this casual message. "
            "Keep it brief and warm.\n\n"
            f"{context}User: {query}"
        )
        return await llm.complete(prompt=prompt, task_type="fast", temperature=0.7, max_tokens=256)

    elif route == DIRECT_ANSWER:
        prompt = (
            "You are a knowledgeable assistant. Give a clear, concise, and accurate answer. "
            "If you're not certain, say so. No need for citations.\n\n"
            f"{context}Question: {query}"
        )
        return await llm.complete(prompt=prompt, task_type="fast", temperature=0.3, max_tokens=512)

    elif route == LIGHT_LOOKUP:
        prompt = (
            "You are a research assistant. Give a brief, factual answer with key information. "
            "Mention if the information might need verification from current sources.\n\n"
            f"{context}Question: {query}"
        )
        return await llm.complete(prompt=prompt, task_type="smart", temperature=0.3, max_tokens=768)

    return ""
