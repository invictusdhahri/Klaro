"""Layer 1 — Deepfake / AI-generated document detection.

Thin orchestrator over the `forensics/` bundle. It runs three independent
checks on every uploaded document and fuses the signals through the
`rule_engine`:

  1. PDF structural fingerprinting (metadata, fonts, text-layer ratio)
  2. Pixel-level image forensics (ELA, FFT, noise inconsistency) — applied to
     image uploads directly, and to every rasterised PDF page
  3. Multi-page Claude Vision ensemble (Sonnet + Haiku, two prompts)

CSV / Excel inputs auto-pass with a low-confidence note because they have no
visual content to inspect; their authenticity is verified entirely by Layer 2.
"""

from __future__ import annotations

import logging
from typing import Any

from klaro_ml.statements.forensics import (
    image_forensics,
    pdf_structure,
    rule_engine,
    vision_ensemble,
)

logger = logging.getLogger(__name__)

NON_VISUAL_MIMES = {
    "text/csv",
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
}


def check_deepfake(file_bytes: bytes, mime_type: str) -> dict[str, Any]:
    """Run Layer-1 forensics. Returns the fused result from `rule_engine.combine`."""
    if mime_type in NON_VISUAL_MIMES:
        return {
            "passed": True,
            "score": 1.0,
            "risk_score": 0.0,
            "confidence": 0.5,
            "signals": [
                {
                    "type": "non_visual_format",
                    "severity": "low",
                    "detail": "Tabular file (CSV/Excel) — visual forensics not applicable.",
                    "evidence": {"mime_type": mime_type},
                    "source": "orchestrator",
                }
            ],
            "reasoning": "Tabular upload — visual forensics skipped; Layer 2 will verify structure.",
            "vision_pages_analysed": 0,
            "vision_available": False,
            "soft_fail": False,
        }

    pdf_signals: list[dict[str, Any]] = []
    image_signals: list[dict[str, Any]] = []

    try:
        pdf_signals = pdf_structure.analyse_pdf(file_bytes, mime_type)
    except Exception as exc:
        logger.warning("pdf_structure analysis failed: %s", exc)

    try:
        if mime_type.startswith("image/"):
            image_signals = image_forensics.analyse_image(file_bytes, mime_type)
        elif mime_type == "application/pdf":
            image_signals = image_forensics.analyse_pdf_pages(file_bytes, mime_type)
    except Exception as exc:
        logger.warning("image_forensics analysis failed: %s", exc)

    try:
        vision_result = vision_ensemble.analyse(file_bytes, mime_type)
    except Exception as exc:
        logger.warning("vision_ensemble analysis failed: %s", exc)
        vision_result = {
            "available": False,
            "pages_analysed": 0,
            "page_votes": [],
            "signals": [],
        }

    result = rule_engine.combine(pdf_signals, image_signals, vision_result)
    # Surface the raw page votes for downstream debugging / audit
    result["vision_page_votes"] = vision_result.get("page_votes", [])
    return result
