"""Model Router – complexity-based model selection for each agent role.

Scores query complexity (0-10) and selects appropriate models per role.
Three modes: FAST (0-3), BALANCED (4-6), DEEP (7-10).
All routing is configurable via environment variables.
"""

from __future__ import annotations

import json
import logging
import re
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

# ─── Mode constants ───────────────────────────────────────────────────────────
MODE_FAST = "FAST"
MODE_BALANCED = "BALANCED"
MODE_DEEP = "DEEP"

# ─── Default routing tables ──────────────────────────────────────────────────

_DEFAULT_ROUTING: dict[str, dict[str, str]] = {
    MODE_FAST: {
        "team_leader": "llama-3.3-70b-versatile",
        "writer": "llama-3.3-70b-versatile",
        "evaluator": "llama-3.3-70b-versatile",
        "refiner": "llama-3.3-70b-versatile",
        "query_gen": "llama-3.1-8b-instant",
        "summarizer": "llama-3.1-8b-instant",
        "rerank": "qwen/qwen3-32b",
    },
    MODE_BALANCED: {
        "team_leader": "llama-3.3-70b-versatile",
        "writer": "llama-3.3-70b-versatile",
        "evaluator": "openai/gpt-oss-120b",
        "refiner": "openai/gpt-oss-120b",
        "query_gen": "llama-3.1-8b-instant",
        "summarizer": "qwen/qwen3-32b",
        "rerank": "qwen/qwen3-32b",
    },
    MODE_DEEP: {
        "team_leader": "openai/gpt-oss-120b",
        "writer": "openai/gpt-oss-120b",
        "evaluator": "openai/gpt-oss-120b",
        "refiner": "openai/gpt-oss-120b",
        "query_gen": "llama-3.1-8b-instant",
        "summarizer": "qwen/qwen3-32b",
        "rerank": "qwen/qwen3-32b",
    },
}

# Safety models (always active)
_SAFETY_MODELS = {
    "prompt_guard": "meta-llama/llama-prompt-guard-2-86m",
    "content_guard": "meta-llama/llama-guard-4-12b",
}

# Voice models
_VOICE_MODELS = {
    "stt_primary": "whisper-large-v3-turbo",
    "stt_fallback": "whisper-large-v3",
}


def _load_system_prompt(role: str) -> str:
    """Load a system prompt file for the given role."""
    prompt_path = Path(__file__).parent.parent.parent / "prompts" / f"{role}.txt"
    try:
        return prompt_path.read_text(encoding="utf-8")
    except FileNotFoundError:
        logger.warning("Prompt file not found for role: %s", role)
        return ""


def score_to_mode(score: int) -> str:
    """Convert complexity score (0-10) to mode."""
    if score <= 3:
        return MODE_FAST
    elif score <= 6:
        return MODE_BALANCED
    return MODE_DEEP


class ModelRouter:
    """Complexity-based model router.

    1. Scores query complexity (0-10) via LLM.
    2. Maps score to mode (FAST/BALANCED/DEEP).
    3. Returns model assignments for each agent role.
    """

    def __init__(self, settings: Any | None = None) -> None:
        self._routing = dict(_DEFAULT_ROUTING)
        self._safety = dict(_SAFETY_MODELS)
        self._voice = dict(_VOICE_MODELS)

        # Override from settings/env if provided
        if settings:
            self._apply_env_overrides(settings)

    def _apply_env_overrides(self, settings: Any) -> None:
        """Apply environment variable overrides for model routing."""
        # Pattern: MODEL_ROUTER_<MODE>_<ROLE> e.g. MODEL_ROUTER_FAST_WRITER
        for mode in [MODE_FAST, MODE_BALANCED, MODE_DEEP]:
            for role in self._routing[mode]:
                env_key = f"MODEL_ROUTER_{mode}_{role.upper()}"
                val = getattr(settings, env_key, None)
                if val and isinstance(val, str) and val.strip():
                    self._routing[mode][role] = val.strip()
                    logger.info("Model override from env: %s=%s", env_key, val.strip())

        # Safety model overrides
        for key in self._safety:
            env_key = f"MODEL_SAFETY_{key.upper()}"
            val = getattr(settings, env_key, None)
            if val and isinstance(val, str) and val.strip():
                self._safety[key] = val.strip()

    async def score_complexity(self, query: str, llm: Any) -> dict[str, Any]:
        """Score the complexity of a query using the manager LLM.

        Returns dict with: complexity_score, mode, signals, reason
        """
        system_prompt = _load_system_prompt("manager")
        prompt = f"{system_prompt}\n\nUser query: {query}"

        try:
            raw = await llm.complete(
                prompt=prompt,
                task_type="fast",
                temperature=0.1,
                max_tokens=256,
            )

            # Parse response
            try:
                parsed = json.loads(raw)
            except json.JSONDecodeError:
                match = re.search(r"\{.*\}", raw, re.DOTALL)
                if match:
                    parsed = json.loads(match.group(0))
                else:
                    parsed = {}

            score = int(parsed.get("complexity_score", 5))
            score = max(0, min(10, score))
            mode = score_to_mode(score)

            return {
                "complexity_score": score,
                "mode": parsed.get("mode", mode),
                "signals": parsed.get("signals", []),
                "reason": parsed.get("reason", "LLM scoring"),
            }

        except Exception as exc:
            logger.warning("Complexity scoring failed: %s – defaulting to BALANCED", exc)
            return {
                "complexity_score": 5,
                "mode": MODE_BALANCED,
                "signals": ["scoring_error"],
                "reason": f"Scoring failed: {exc}",
            }

    def get_models(self, mode: str) -> dict[str, str]:
        """Get model assignments for a specific mode."""
        models = dict(self._routing.get(mode, self._routing[MODE_BALANCED]))
        models.update(self._safety)
        models.update(self._voice)
        return models

    def get_model_for_role(self, mode: str, role: str) -> str:
        """Get the model for a specific role in a given mode."""
        models = self.get_models(mode)
        return models.get(role, "llama-3.3-70b-versatile")

    def get_routing_plan(self, mode: str) -> dict[str, Any]:
        """Return the full routing plan for a given mode."""
        return {
            "mode": mode,
            "models": self.get_models(mode),
            "safety_models": dict(self._safety),
            "voice_models": dict(self._voice),
        }
