"""Unit tests for POST /ocr/extract.

Heavy dependencies (MTCNN, Claude Vision) are patched out so the
suite runs without GPU hardware or API credentials.

Three scenarios mirror the checklist:
  1. Blurry / tilted image  → { success: false, reason: low_quality | tilted_image }
  2. Clear image but no face detected  → { success: false, reason: no_face_detected }
  3. Clear image with face — full happy-path  → { success: true, all fields present }
"""

from __future__ import annotations

import io
from typing import Any
from unittest.mock import MagicMock, patch

import numpy as np
import pytest
from fastapi.testclient import TestClient
from PIL import Image

from klaro_ml.main import app

client = TestClient(app)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_MOCK_FIELDS = {
    "full_name": "محمد أمين",
    "full_name_latin": "Mohamed Amine",
    "cin_number": "12345678",
    "date_of_birth": "1997-03-15",
    "expiry_date": "2029-03-14",
    "address": "Tunis",
    "gender": "M",
}

_MOCK_CONFIDENCE = round(7 / 7, 4)  # all 7 fields extracted
_MOCK_B64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwADhQGAWjR9awAAAABJRU5ErkJggg=="


def _make_image_bytes(width: int = 200, height: int = 120) -> bytes:
    """Create a minimal valid PNG image in memory."""
    img = Image.fromarray(np.zeros((height, width, 3), dtype=np.uint8))
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def _multipart(image_bytes: bytes | None = None, document_type: str = "cin") -> dict[str, Any]:
    data = _make_image_bytes() if image_bytes is None else image_bytes
    return {
        "image": ("document.png", io.BytesIO(data), "image/png"),
        "document_type": (None, document_type),
    }


# ---------------------------------------------------------------------------
# Test 1 — Blurry / tilted image
# ---------------------------------------------------------------------------


@patch("klaro_ml.routes.ocr.compute_quality_score", return_value=0.05)
def test_blurry_image_returns_low_quality(mock_quality: MagicMock) -> None:
    """An image with quality_score below the threshold must be rejected."""
    res = client.post("/ocr/extract", files=_multipart())
    assert res.status_code == 200
    body = res.json()
    assert body["success"] is False
    assert body["reason"] == "low_quality"
    mock_quality.assert_called_once()


@patch("klaro_ml.routes.ocr.compute_quality_score", return_value=0.0)
def test_tilted_image_returns_tilted_image(mock_quality: MagicMock) -> None:
    """An image rejected by skew detection (score==0.0) returns tilted_image reason."""
    res = client.post("/ocr/extract", files=_multipart())
    assert res.status_code == 200
    body = res.json()
    assert body["success"] is False
    assert body["reason"] == "tilted_image"


# ---------------------------------------------------------------------------
# Test 2 — Clear image, no face
# ---------------------------------------------------------------------------


@patch("klaro_ml.routes.ocr.detect_and_crop_face", return_value=None)
@patch(
    "klaro_ml.routes.ocr.extract_fields_via_vision",
    return_value=(_MOCK_FIELDS, _MOCK_CONFIDENCE),
)
@patch("klaro_ml.routes.ocr.compute_quality_score", return_value=0.85)
def test_clear_image_no_face(
    mock_quality: MagicMock,
    mock_vision: MagicMock,
    mock_face: MagicMock,
) -> None:
    """Quality passes, vision extraction succeeds, but MTCNN finds no face."""
    res = client.post("/ocr/extract", files=_multipart())
    assert res.status_code == 200
    body = res.json()
    assert body["success"] is False
    assert body["reason"] == "no_face_detected"
    mock_face.assert_called_once()


# ---------------------------------------------------------------------------
# Test 3 — Clear image, full happy path
# ---------------------------------------------------------------------------


@patch("klaro_ml.routes.ocr.detect_and_crop_face", return_value=_MOCK_B64)
@patch(
    "klaro_ml.routes.ocr.extract_fields_via_vision",
    return_value=(_MOCK_FIELDS, _MOCK_CONFIDENCE),
)
@patch("klaro_ml.routes.ocr.compute_quality_score", return_value=0.94)
def test_clear_image_full_pipeline(
    mock_quality: MagicMock,
    mock_vision: MagicMock,
    mock_face: MagicMock,
) -> None:
    """Full success: all pipeline stages pass and all fields are returned."""
    res = client.post("/ocr/extract", files=_multipart())
    assert res.status_code == 200
    body = res.json()

    assert body["success"] is True
    assert body["face_crop_base64"] == _MOCK_B64
    assert body["confidence"] == pytest.approx(_MOCK_CONFIDENCE)
    assert body["quality_score"] == pytest.approx(0.94, abs=1e-3)

    extracted = body["extracted"]
    assert extracted["full_name"] == "محمد أمين"
    assert extracted["full_name_latin"] == "Mohamed Amine"
    assert extracted["cin_number"] == "12345678"
    assert extracted["date_of_birth"] == "1997-03-15"
    assert extracted["expiry_date"] == "2029-03-14"
    assert extracted["address"] == "Tunis"
    assert extracted["gender"] == "M"

    mock_vision.assert_called_once()
    mock_face.assert_called_once()
