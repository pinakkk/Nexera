"""Text-to-Speech endpoint – POST /v1/tts.

Uses Groq's Orpheus English model (canopylabs/orpheus-v1-english)
for high-quality speech synthesis.

Note: The Orpheus model accepts a maximum of 200 characters per request.
Long inputs are automatically split at word boundaries and the resulting
WAV audio chunks are concatenated before streaming back to the client.
"""

from __future__ import annotations

import logging
import tempfile
import wave
from pathlib import Path

import groq
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)  # trigger reload

router = APIRouter(prefix="/tts", tags=["tts"])

# Available voices for canopylabs/orpheus-v1-english
ORPHEUS_VOICES = {"autumn", "diana", "hannah", "austin", "daniel", "troy"}
DEFAULT_VOICE = "troy"

# Groq Orpheus hard limit per API call
_MAX_CHARS_PER_CHUNK = 200


class TTSRequest(BaseModel):
    """Request body for text-to-speech conversion."""
    text: str = Field(..., min_length=1, max_length=10000, description="Text to convert to speech")
    voice: str = Field(
        default=DEFAULT_VOICE,
        description=f"Voice to use. Options: {', '.join(sorted(ORPHEUS_VOICES))}",
    )


def _chunk_text(text: str, max_len: int = _MAX_CHARS_PER_CHUNK) -> list[str]:
    """Split *text* into chunks of at most *max_len* characters.

    Splits at the last whitespace within the limit so words are never broken.
    """
    text = text.strip()
    if not text:
        return []
    if len(text) <= max_len:
        return [text]

    chunks: list[str] = []
    while text:
        if len(text) <= max_len:
            chunks.append(text)
            break
        cut = text.rfind(" ", 0, max_len)
        if cut <= 0:
            cut = max_len  # no space found – hard cut
        chunks.append(text[:cut].strip())
        text = text[cut:].lstrip()

    return [c for c in chunks if c]


def _concatenate_wav_files(wav_paths: list[Path]) -> Path:
    """Merge multiple same-format WAV files into a single temporary WAV file."""
    out_tmp = tempfile.NamedTemporaryFile(suffix=".wav", delete=False)
    out_path = Path(out_tmp.name)
    out_tmp.close()

    with wave.open(str(out_path), "wb") as out_wav:
        for i, path in enumerate(wav_paths):
            with wave.open(str(path), "rb") as src:
                if i == 0:
                    out_wav.setparams(src.getparams())
                out_wav.writeframes(src.readframes(src.getnframes()))

    return out_path


@router.post("")
async def text_to_speech(body: TTSRequest) -> StreamingResponse:
    """Convert text to speech using Orpheus English via Groq.

    Returns an audio/wav stream.  Long inputs are chunked automatically.
    """
    from app.user_keys import get_effective_settings

    settings = get_effective_settings()
    if not settings.GROQ_API_KEY:
        raise HTTPException(status_code=503, detail="Groq API key not configured")

    try:
        client = groq.Groq(api_key=settings.GROQ_API_KEY)

        model = getattr(settings, "TTS_MODEL", "canopylabs/orpheus-v1-english")

        # Map old voice names to new Orpheus voices for backward compat
        voice_alias_map = {
            "tara": "autumn",
            "leah": "diana",
            "jess": "hannah",
            "leo": "austin",
            "dan": "daniel",
            "mia": "diana",
            "zac": "troy",
            "zoe": "autumn",
        }
        voice = body.voice.lower()
        resolved_voice = voice_alias_map.get(voice, voice)
        if resolved_voice not in ORPHEUS_VOICES:
            resolved_voice = DEFAULT_VOICE

        # Split into ≤200-char chunks (Orpheus API limit)
        chunks = _chunk_text(body.text, max_len=_MAX_CHARS_PER_CHUNK)
        if not chunks:
            raise HTTPException(status_code=400, detail="No text to synthesise")

        logger.info(
            "TTS request: %d chars → %d chunk(s), model=%s, voice=%s",
            len(body.text),
            len(chunks),
            model,
            resolved_voice,
        )

        chunk_paths: list[Path] = []
        try:
            for chunk in chunks:
                response = client.audio.speech.create(
                    model=model,
                    voice=resolved_voice,
                    input=chunk,
                    response_format="wav",
                )
                with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
                    tmp_path = Path(tmp.name)
                # write_to_file needs the file closed first on some platforms
                response.write_to_file(str(tmp_path))
                chunk_paths.append(tmp_path)

            # Merge chunks (or use the single chunk directly)
            if len(chunk_paths) == 1:
                final_path = chunk_paths[0]
                chunk_paths = []  # don't double-delete
            else:
                final_path = _concatenate_wav_files(chunk_paths)

        finally:
            # Clean up individual chunk files
            for p in chunk_paths:
                p.unlink(missing_ok=True)

        logger.info("TTS complete: final file %s", final_path.name)

        def iter_file(path: Path):
            try:
                with open(path, "rb") as f:
                    while chunk_bytes := f.read(8192):
                        yield chunk_bytes
            finally:
                path.unlink(missing_ok=True)

        return StreamingResponse(
            iter_file(final_path),
            media_type="audio/wav",
            headers={"Content-Disposition": "inline; filename=speech.wav"},
        )

    except groq.AuthenticationError as exc:
        logger.error("TTS AuthenticationError: %s", exc)
        raise HTTPException(
            status_code=401,
            detail="Invalid Groq API key. Please check your API key in Settings.",
        )

    except groq.PermissionDeniedError as exc:
        logger.error("TTS PermissionDeniedError: %s", exc)
        raise HTTPException(
            status_code=403,
            detail="Your Groq API key does not have permission to use text-to-speech.",
        )

    except groq.NotFoundError as exc:
        logger.error("TTS NotFoundError: %s", exc)
        raise HTTPException(
            status_code=404,
            detail=(
                "TTS model not found. The Orpheus model requires terms acceptance — "
                "please visit https://console.groq.com/playground?model=canopylabs%2Forpheus-v1-english "
                "and accept the model terms to enable text-to-speech."
            ),
        )

    except groq.RateLimitError as exc:
        logger.warning("TTS RateLimitError: %s", exc)
        raise HTTPException(
            status_code=429,
            detail="Groq TTS rate limit exceeded. Please wait a moment and try again.",
        )

    except groq.BadRequestError as exc:
        logger.error("TTS BadRequestError: %s", exc)
        error_body = str(exc)
        if "model_terms_required" in error_body:
            raise HTTPException(
                status_code=503,
                detail=(
                    "The Orpheus TTS model requires terms acceptance. "
                    "Please visit https://console.groq.com/playground?model=canopylabs%2Forpheus-v1-english "
                    "and accept the model terms to enable text-to-speech."
                ),
            )
        raise HTTPException(status_code=400, detail=f"TTS request error: {exc}")

    except Exception as exc:
        logger.exception("TTS generation failed")
        raise HTTPException(status_code=500, detail=f"Text-to-speech failed: {exc}")
