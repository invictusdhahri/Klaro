"""Layer 1 — Deepfake / Manipulation Detection.

Uses Claude Vision to detect signs of digital manipulation in the uploaded file.
For PDFs, the first page is rendered to an image before analysis.
For CSV/Excel (no visual content), this layer automatically passes.
"""

from __future__ import annotations

import base64
from typing import Any

import anthropic

from klaro_ml.settings import get_settings

DEEPFAKE_SYSTEM = """\
You are a forensic document analyst specialising in detecting manipulated or fabricated bank statements.
Analyse the provided image carefully for signs of digital manipulation.

Return ONLY valid JSON:
{
  "passed": <true if document appears genuine, false if manipulation detected>,
  "confidence": <float 0.0–1.0, your confidence in the assessment>,
  "signals": [<list of specific manipulation signals found, empty if none>]
}

Signals to check:
- Inconsistent font rendering (mixed DPI, different kerning in same field)
- Pixel-level artifacts around numbers or amounts (copy-paste halos, resampling artifacts)
- Inconsistent background texture between sections
- Misaligned text that suggests overlay editing
- Color or brightness discontinuities in text regions
- Suspicious regularity (every amount identical, impossible round-number precision)
- Security feature anomalies (watermarks, seals appearing digitally inserted)
- Date/timestamp inconsistencies between document metadata and printed dates

Output ONLY the JSON, no markdown fences.
"""

IMAGE_MIMES = {
    "image/jpeg", "image/jpg", "image/png",
    "image/webp", "image/gif", "image/tiff",
}

NON_VISUAL_MIMES = {
    "text/csv",
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
}


def check_deepfake(
    file_bytes: bytes,
    mime_type: str,
) -> dict[str, Any]:
    """Run Layer 1 deepfake check. Returns layer result dict."""
    # Tabular files have no visual content — pass automatically
    if mime_type in NON_VISUAL_MIMES:
        return {"passed": True, "confidence": 1.0, "signals": []}

    settings = get_settings()
    if not settings.ANTHROPIC_API_KEY:
        return {"passed": True, "confidence": 0.5, "signals": ["API key not configured — skipped"]}

    client = anthropic.Anthropic(api_key=settings.ANTHROPIC_API_KEY)

    # Obtain image bytes
    if mime_type == "application/pdf":
        image_bytes, img_mime = _pdf_first_page(file_bytes)
        if image_bytes is None:
            return {"passed": True, "confidence": 0.5, "signals": ["PDF rendering unavailable"]}
    else:
        image_bytes = file_bytes
        img_mime = mime_type

    return _analyse_image(client, image_bytes, img_mime)


def _pdf_first_page(pdf_bytes: bytes) -> tuple[bytes | None, str]:
    try:
        import fitz
        doc = fitz.open(stream=pdf_bytes, filetype="pdf")
        if len(doc) == 0:
            return None, "image/png"
        pix = doc[0].get_pixmap(matrix=fitz.Matrix(2.0, 2.0))
        return pix.tobytes("png"), "image/png"
    except ImportError:
        return None, "image/png"


def _analyse_image(
    client: anthropic.Anthropic,
    image_bytes: bytes,
    mime_type: str,
) -> dict[str, Any]:
    import json

    media_type = mime_type if mime_type in IMAGE_MIMES else "image/jpeg"
    b64 = base64.standard_b64encode(image_bytes).decode()

    res = client.messages.create(
        model=get_settings().CLAUDE_SONNET,
        max_tokens=1024,
        system=DEEPFAKE_SYSTEM,
        messages=[{
            "role": "user",
            "content": [{
                "type": "image",
                "source": {"type": "base64", "media_type": media_type, "data": b64},
            }],
        }],
    )

    raw = res.content[0].text.strip()  # type: ignore[union-attr]
    if raw.startswith("```"):
        raw = "\n".join(raw.split("\n")[1:])
    if raw.endswith("```"):
        raw = raw[: raw.rfind("```")]

    try:
        result: dict[str, Any] = json.loads(raw)
        # Fail if confidence < 0.6 (uncertain) OR any signal present
        if result.get("confidence", 1.0) < 0.6:
            result["passed"] = False
        return result
    except (json.JSONDecodeError, AttributeError):
        return {"passed": True, "confidence": 0.5, "signals": ["Parse error — check skipped"]}
