"""PaddleOCR wrapper. Lazy-imported so the base image stays light."""

from __future__ import annotations

from typing import Any


def extract_text(image_bytes: bytes, languages: tuple[str, ...] = ("ar", "fr")) -> list[str]:
    try:
        from paddleocr import PaddleOCR  # type: ignore[import-not-found]
    except ImportError as exc:
        raise RuntimeError(
            "PaddleOCR is not installed. Install with `uv sync --extra kyc`."
        ) from exc

    ocr = PaddleOCR(use_angle_cls=True, lang=languages[0])
    raw: Any = ocr.ocr(image_bytes, cls=True)
    lines: list[str] = []
    for page in raw or []:
        for line in page or []:
            if len(line) >= 2 and isinstance(line[1], (list, tuple)) and line[1]:
                text = line[1][0]
                if isinstance(text, str):
                    lines.append(text)
    return lines
