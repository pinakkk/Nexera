"""Safety Guard – prompt injection detection and content safety.

Uses lightweight heuristics first, then LLM-based guards.
Always active regardless of complexity mode.
"""

from __future__ import annotations

import logging
import re
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

# ─── Prompt injection patterns ────────────────────────────────────────────────
_INJECTION_PATTERNS = [
    re.compile(r"ignore\s+(all\s+)?(previous|prior|above)\s+(instructions?|prompts?|rules?)", re.I),
    re.compile(r"(forget|disregard|override)\s+(your|all|the)\s+(instructions?|rules?|prompts?)", re.I),
    re.compile(r"you\s+are\s+now\s+(a|an)\s+", re.I),
    re.compile(r"pretend\s+(you\s+are|to\s+be)\s+", re.I),
    re.compile(r"(reveal|show|print|output)\s+(your|the)\s+(system|original|initial)\s+(prompt|instructions?)", re.I),
    re.compile(r"act\s+as\s+(if\s+)?(you\s+)?(are|were)\s+", re.I),
    re.compile(r"(jailbreak|DAN|do\s+anything\s+now)", re.I),
    re.compile(r"\[SYSTEM\]|\[INST\]|\<\|system\|\>", re.I),
]

# Content safety patterns
_UNSAFE_CONTENT_PATTERNS = [
    re.compile(r"how\s+to\s+(make|build|create)\s+(a\s+)?(bomb|explosive|weapon)", re.I),
    re.compile(r"(synthesize|manufacture)\s+(drugs?|meth|fentanyl)", re.I),
]


class SafetyGuardService:
    """Prompt injection and content safety guard."""

    def check_prompt_injection(self, query: str) -> dict[str, Any]:
        """Check for prompt injection attacks using heuristics.

        Returns dict with: safe, threat_type, confidence, reason.
        """
        if not query or not query.strip():
            return {"safe": True, "threat_type": "none", "confidence": 1.0, "reason": "empty input"}

        for pattern in _INJECTION_PATTERNS:
            match = pattern.search(query)
            if match:
                logger.warning("Prompt injection detected: %s", match.group(0)[:50])
                return {
                    "safe": False,
                    "threat_type": "injection",
                    "confidence": 0.9,
                    "reason": f"Matched injection pattern: {match.group(0)[:30]}",
                }

        # Check for encoded payloads (base64-like strings)
        base64_like = re.findall(r"[A-Za-z0-9+/]{40,}={0,2}", query)
        if base64_like:
            return {
                "safe": False,
                "threat_type": "data_extraction",
                "confidence": 0.7,
                "reason": "Suspicious encoded payload detected",
            }

        return {"safe": True, "threat_type": "none", "confidence": 1.0, "reason": "no threats detected"}

    def check_content_safety(self, text: str) -> dict[str, Any]:
        """Check fetched content for safety issues.

        Returns dict with: safe, categories, confidence, action.
        """
        if not text or not text.strip():
            return {"safe": True, "categories": ["safe"], "confidence": 1.0, "action": "allow"}

        for pattern in _UNSAFE_CONTENT_PATTERNS:
            if pattern.search(text):
                return {
                    "safe": False,
                    "categories": ["harmful_instructions"],
                    "confidence": 0.85,
                    "action": "block",
                }

        return {"safe": True, "categories": ["safe"], "confidence": 1.0, "action": "allow"}

    async def guard_prompt(self, query: str, llm: Any | None = None) -> dict[str, Any]:
        """Full prompt guard: heuristics first, then optional LLM.

        For cost efficiency, LLM guard is only called when heuristics are uncertain.
        """
        # Step 1: Heuristic check
        result = self.check_prompt_injection(query)
        if not result["safe"]:
            return result

        # Step 2: Only use LLM for edge cases (long or complex queries)
        if llm and len(query.split()) > 50:
            try:
                prompt_path = Path(__file__).parent.parent.parent / "prompts" / "prompt_guard.txt"
                system_prompt = prompt_path.read_text(encoding="utf-8") if prompt_path.exists() else ""
                raw = await llm.complete(
                    prompt=f"{system_prompt}\n\nUser input: {query[:500]}",
                    task_type="fast",
                    temperature=0.1,
                    max_tokens=128,
                )
                import json
                parsed = json.loads(raw) if raw.strip().startswith("{") else {"safe": True}
                if not parsed.get("safe", True) and parsed.get("confidence", 0) > 0.7:
                    return parsed
            except Exception as exc:
                logger.debug("LLM prompt guard check failed (non-fatal): %s", exc)

        return result

    async def guard_content(self, text: str, llm: Any | None = None) -> dict[str, Any]:
        """Full content guard: heuristics first, then optional LLM."""
        result = self.check_content_safety(text)
        if not result["safe"]:
            return result

        # LLM check is skipped for cost efficiency in most cases
        return result
