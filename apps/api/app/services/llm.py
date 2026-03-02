"""LLM service wrapping Groq API with retry logic and JSON parsing."""

import asyncio
import json
import logging
import re
from typing import Any

import groq
from tenacity import (
    retry,
    stop_after_attempt,
    wait_exponential,
    retry_if_exception_type,
)

logger = logging.getLogger(__name__)


class LLMService:
    """Thin async wrapper around the Groq chat-completion API.

    Supports two model tiers:
      - *fast*  – cheap, low-latency model for planning / query generation
      - *smart* – larger model for synthesis / evaluation
    """

    def __init__(
        self,
        fast_model: str,
        smart_model: str,
        api_key: str,
        auto_select_best_llama: bool = True,
    ) -> None:
        self.fast_model = fast_model
        self.smart_model = smart_model
        self._client = groq.AsyncGroq(api_key=api_key)
        self._auto_select_best_llama = auto_select_best_llama
        self._models_resolved = False
        self._models_lock = asyncio.Lock()
        self._run_model_override: str | None = None

    def set_run_model_override(self, model_id: str | None) -> None:
        """Set per-run model override (applies to fast/smart tasks for that run)."""
        self._run_model_override = model_id.strip() if isinstance(model_id, str) and model_id.strip() else None

    async def _resolve_models_once(self) -> None:
        if self._models_resolved or not self._auto_select_best_llama:
            return

        async with self._models_lock:
            if self._models_resolved:
                return

            try:
                response = await self._client.models.list()
                model_ids = [
                    m.id for m in getattr(response, "data", [])
                    if isinstance(getattr(m, "id", None), str)
                ]
                best_llama = _pick_best_llama_model(model_ids)
                if best_llama:
                    fast_candidate = _pick_fast_llama_model(model_ids) or best_llama
                    if fast_candidate != self.fast_model or best_llama != self.smart_model:
                        logger.info(
                            "Auto-selected Groq llama models fast=%s smart=%s",
                            fast_candidate,
                            best_llama,
                        )
                    self.fast_model = fast_candidate
                    self.smart_model = best_llama
                else:
                    logger.warning(
                        "Groq model list returned no llama models; keeping configured defaults"
                    )
            except Exception as exc:
                logger.warning(
                    "Failed to auto-select Groq llama model; using configured defaults. error=%s",
                    exc,
                )
            finally:
                self._models_resolved = True

    # --------------------------------------------------------------------- #
    # Core completion with retry
    # --------------------------------------------------------------------- #

    @retry(
        retry=retry_if_exception_type(
            (groq.APITimeoutError, groq.RateLimitError, groq.APIConnectionError)
        ),
        wait=wait_exponential(multiplier=1, min=1, max=10),
        stop=stop_after_attempt(3),
        reraise=True,
    )
    async def complete(
        self,
        prompt: str,
        task_type: str = "fast",
        temperature: float = 0.3,
        max_tokens: int = 2048,
    ) -> str:
        """Return a plain-text completion from the Groq API.

        Parameters
        ----------
        prompt:
            The user/system prompt to send.
        task_type:
            ``"fast"`` selects the fast model, ``"smart"`` the smart model.
        temperature:
            Sampling temperature.
        max_tokens:
            Maximum tokens in the response.
        """
        await self._resolve_models_once()

        model = (
            self._run_model_override
            or (self.smart_model if task_type == "smart" else self.fast_model)
        )
        logger.debug("LLM request  model=%s  task=%s  tokens=%d", model, task_type, max_tokens)

        response = await self._client.chat.completions.create(
            model=model,
            messages=[{"role": "user", "content": prompt}],
            temperature=temperature,
            max_tokens=max_tokens,
        )

        text: str = response.choices[0].message.content or ""
        logger.debug("LLM response length=%d chars", len(text))
        return text

    # --------------------------------------------------------------------- #
    # JSON completion (parses response into dict)
    # --------------------------------------------------------------------- #

    async def complete_json(
        self,
        prompt: str,
        task_type: str = "fast",
        temperature: float = 0.3,
        max_tokens: int = 2048,
    ) -> dict[str, Any]:
        """Call :meth:`complete` and parse the result as JSON.

        If the model wraps its JSON in a Markdown code block (```json ...```),
        the wrapper is stripped before parsing.
        """
        raw = await self.complete(
            prompt=prompt,
            task_type=task_type,
            temperature=temperature,
            max_tokens=max_tokens,
        )

        # First try direct parse
        try:
            return json.loads(raw)
        except json.JSONDecodeError:
            pass

        # Fallback: extract from markdown code fence
        match = re.search(r"```(?:json)?\s*\n?(.*?)```", raw, re.DOTALL)
        if match:
            try:
                return json.loads(match.group(1).strip())
            except json.JSONDecodeError:
                pass

        # Last resort: find first { ... } block
        brace_match = re.search(r"\{.*\}", raw, re.DOTALL)
        if brace_match:
            try:
                return json.loads(brace_match.group(0))
            except json.JSONDecodeError:
                pass

        logger.error("Failed to parse LLM response as JSON. Raw response:\n%s", raw[:500])
        raise ValueError("LLM did not return valid JSON")


# ---------------------------------------------------------------------- #
# Factory
# ---------------------------------------------------------------------- #


def get_llm_service(settings: Any) -> LLMService:
    """Create an :class:`LLMService` from application settings.

    ``settings`` is expected to expose ``GROQ_FAST_MODEL`` and ``GROQ_SMART_MODEL``
    string attributes (e.g. ``"llama-3.1-8b-instant"`` / ``"llama-3.3-70b-versatile"``).
    """
    return LLMService(
        fast_model=getattr(settings, "GROQ_FAST_MODEL", "llama-3.1-8b-instant"),
        smart_model=getattr(settings, "GROQ_SMART_MODEL", "llama-3.3-70b-versatile"),
        api_key=getattr(settings, "GROQ_API_KEY", ""),
        auto_select_best_llama=getattr(settings, "GROQ_AUTO_SELECT_BEST_LLAMA", True),
    )


def _pick_best_llama_model(model_ids: list[str]) -> str | None:
    """Pick the strongest/latest llama model from a model list."""
    llamas = [m for m in model_ids if "llama" in m.lower()]
    if not llamas:
        return None

    def score(model_id: str) -> tuple[int, int, int, int]:
        lower = model_id.lower()
        major = 0
        minor = 0
        match = re.search(r"llama[-_/ ]?(\d+)(?:[._-](\d+))?", lower)
        if match:
            major = int(match.group(1))
            minor = int(match.group(2) or 0)

        size_b = 0
        size_match = re.search(r"(\d+)b", lower)
        if size_match:
            size_b = int(size_match.group(1))

        quality = 0
        if "versatile" in lower or "instruct" in lower:
            quality += 2
        if "reason" in lower or "thinking" in lower:
            quality += 1
        if "instant" in lower:
            quality -= 1
        return (major, minor, size_b, quality)

    return max(llamas, key=score)


def _pick_fast_llama_model(model_ids: list[str]) -> str | None:
    """Pick a lower-latency llama model when available."""
    llamas = [m for m in model_ids if "llama" in m.lower()]
    if not llamas:
        return None

    instant = [m for m in llamas if "instant" in m.lower()]
    if instant:
        return sorted(instant)[-1]

    small = [m for m in llamas if re.search(r"\b([1-9]|1[0-9]|2[0-9]|3[0-2])b\b", m.lower())]
    if small:
        return sorted(small)[-1]

    return None
