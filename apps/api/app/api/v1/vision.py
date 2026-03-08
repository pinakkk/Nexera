"""Vision analysis endpoint – POST /v1/vision/analyze.

Uses Llama 4 Scout via Groq for multimodal image understanding.
"""

from __future__ import annotations

import base64
import logging
import tempfile
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException, UploadFile, File, Form
from pydantic import BaseModel

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/vision", tags=["vision"])


class VisionAnalysisResponse(BaseModel):
    """Response from the vision analysis endpoint."""
    analysis: str
    model_used: str = "meta-llama/llama-4-scout-17b-16e-instruct"


@router.post("/analyze", response_model=VisionAnalysisResponse)
async def analyze_image(
    file: UploadFile = File(..., description="Image file to analyze"),
    prompt: str = Form(
        default="Describe this image in detail. What do you see?",
        description="Analysis prompt / question about the image",
    ),
) -> VisionAnalysisResponse:
    """Analyze an image using Llama 4 Scout via Groq.

    Accepts common image formats: png, jpg, jpeg, gif, webp.
    """
    from app.config import get_settings

    settings = get_settings()
    if not settings.GROQ_API_KEY:
        raise HTTPException(status_code=503, detail="Groq API key not configured")

    # Validate file type
    allowed_types = {
        "image/png", "image/jpeg", "image/jpg", "image/gif",
        "image/webp", "application/octet-stream",
    }
    allowed_exts = {".png", ".jpg", ".jpeg", ".gif", ".webp"}

    content_type = file.content_type or ""
    filename = file.filename or "image.png"
    ext = Path(filename).suffix.lower()

    if content_type not in allowed_types and ext not in allowed_exts:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported image format: {content_type}. Use png, jpg, jpeg, gif, or webp.",
        )

    # Read and encode image
    image_data = await file.read()
    if not image_data:
        raise HTTPException(status_code=400, detail="Empty image file")

    # Limit file size (10MB)
    if len(image_data) > 10 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="Image too large. Maximum size is 10MB.")

    # Encode to base64 for the API
    base64_image = base64.b64encode(image_data).decode("utf-8")

    # Determine MIME type
    mime_type = content_type if content_type in allowed_types else f"image/{ext.lstrip('.')}"
    if mime_type == "application/octet-stream":
        mime_type = f"image/{ext.lstrip('.')}" if ext else "image/png"

    try:
        import groq

        client = groq.AsyncGroq(api_key=settings.GROQ_API_KEY)
        model = getattr(settings, "VISION_MODEL", "meta-llama/llama-4-scout-17b-16e-instruct")

        response = await client.chat.completions.create(
            model=model,
            messages=[
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "text",
                            "text": prompt,
                        },
                        {
                            "type": "image_url",
                            "image_url": {
                                "url": f"data:{mime_type};base64,{base64_image}",
                            },
                        },
                    ],
                }
            ],
            temperature=0.3,
            max_tokens=1024,
        )

        analysis = response.choices[0].message.content or ""
        logger.info(
            "Vision analysis complete: %d chars output, model=%s",
            len(analysis),
            model,
        )

        return VisionAnalysisResponse(
            analysis=analysis,
            model_used=model,
        )

    except Exception as exc:
        logger.exception("Vision analysis failed")
        raise HTTPException(status_code=500, detail=f"Vision analysis failed: {exc}")
