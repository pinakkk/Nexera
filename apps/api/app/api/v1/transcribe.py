"""Voice transcription endpoint – POST /v1/transcribe.

Uses Groq's Whisper API for speech-to-text.
"""

from __future__ import annotations

import logging
import tempfile
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException, UploadFile, File
from pydantic import BaseModel

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/transcribe", tags=["transcribe"])


class TranscribeResponse(BaseModel):
    """Response from the transcription endpoint."""
    text: str
    language: str | None = None
    duration_seconds: float | None = None
    model_used: str = "whisper-large-v3-turbo"


@router.post("", response_model=TranscribeResponse)
async def transcribe_audio(
    file: UploadFile = File(..., description="Audio file to transcribe"),
) -> TranscribeResponse:
    """Transcribe an audio file using Whisper via Groq.

    Accepts common audio formats: mp3, wav, m4a, webm, ogg, flac.
    """
    from app.config import get_settings

    settings = get_settings()
    if not settings.GROQ_API_KEY:
        raise HTTPException(status_code=503, detail="Groq API key not configured")

    # Validate file type
    allowed_types = {"audio/mpeg", "audio/wav", "audio/mp3", "audio/m4a",
                     "audio/webm", "audio/ogg", "audio/flac", "audio/mp4",
                     "video/webm", "application/octet-stream"}

    content_type = file.content_type or ""
    filename = file.filename or "audio.wav"
    ext = Path(filename).suffix.lower()
    allowed_exts = {".mp3", ".wav", ".m4a", ".webm", ".ogg", ".flac", ".mp4"}

    if content_type not in allowed_types and ext not in allowed_exts:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported audio format: {content_type}. Use mp3, wav, m4a, webm, ogg, or flac.",
        )

    # Read file content
    audio_data = await file.read()
    if not audio_data:
        raise HTTPException(status_code=400, detail="Empty audio file")

    # Save to temp file (Groq SDK expects file path/object)
    suffix = ext if ext else ".wav"
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        tmp.write(audio_data)
        tmp_path = tmp.name

    try:
        import groq

        client = groq.Groq(api_key=settings.GROQ_API_KEY)

        # Try primary model first
        model = getattr(settings, "STT_MODEL", "whisper-large-v3-turbo")
        fallback = getattr(settings, "STT_FALLBACK_MODEL", "whisper-large-v3")

        try:
            with open(tmp_path, "rb") as audio_file:
                transcription = client.audio.transcriptions.create(
                    file=(filename, audio_file),
                    model=model,
                    response_format="verbose_json",
                )
        except Exception as exc:
            logger.warning("Primary STT model %s failed: %s, trying fallback %s", model, exc, fallback)
            with open(tmp_path, "rb") as audio_file:
                transcription = client.audio.transcriptions.create(
                    file=(filename, audio_file),
                    model=fallback,
                    response_format="verbose_json",
                )
            model = fallback

        text = transcription.text or ""
        language = getattr(transcription, "language", None)
        duration = getattr(transcription, "duration", None)

        logger.info("Transcription complete: %d chars, lang=%s, model=%s", len(text), language, model)

        return TranscribeResponse(
            text=text,
            language=language,
            duration_seconds=float(duration) if duration else None,
            model_used=model,
        )

    except Exception as exc:
        logger.exception("Transcription failed")
        raise HTTPException(status_code=500, detail=f"Transcription failed: {exc}")
    finally:
        # Clean up temp file
        try:
            Path(tmp_path).unlink(missing_ok=True)
        except Exception:
            pass
