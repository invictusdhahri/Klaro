"""PaddleOCR wrapper, image preprocessor, and quality scorer.

Lazy-imported so the base image stays light when the kyc extra is not installed.
"""

from __future__ import annotations

import logging
import struct
from typing import Any

logger = logging.getLogger(__name__)


# ── EXIF auto-rotation ────────────────────────────────────────────────────────


def _read_exif_orientation(data: bytes) -> int:
    """Parse the EXIF orientation tag from JPEG bytes without extra deps.

    Returns the orientation value (1–8) or 1 (no rotation) if not found.
    """
    if len(data) < 2 or data[:2] != b"\xff\xd8":
        return 1
    i = 2
    while i < len(data) - 4:
        if data[i] != 0xFF:
            break
        marker = data[i + 1]
        if marker in (0xDA, 0xD9):
            break
        try:
            length = struct.unpack(">H", data[i + 2 : i + 4])[0]
        except struct.error:
            break
        if marker == 0xE1 and length >= 8:  # APP1 — may contain EXIF
            app1 = data[i + 4 : i + 2 + length]
            if app1[:6] == b"Exif\x00\x00":
                tiff = app1[6:]
                if len(tiff) < 8:
                    break
                endian = "<" if tiff[:2] == b"II" else ">"
                try:
                    ifd_offset = struct.unpack(endian + "I", tiff[4:8])[0]
                    num_entries = struct.unpack(
                        endian + "H", tiff[ifd_offset : ifd_offset + 2]
                    )[0]
                    for j in range(num_entries):
                        base = ifd_offset + 2 + j * 12
                        tag = struct.unpack(endian + "H", tiff[base : base + 2])[0]
                        if tag == 0x0112:  # Orientation
                            return struct.unpack(
                                endian + "H", tiff[base + 8 : base + 10]
                            )[0]
                except (struct.error, IndexError):
                    break
        i += 2 + length
    return 1


def auto_rotate_image(image_bytes: bytes) -> bytes:
    """Apply EXIF orientation correction using OpenCV.

    Phone cameras embed a rotation tag instead of physically rotating the
    pixels — without this step a landscape card shot in portrait mode arrives
    sideways and Claude cannot read it.  Falls back to original bytes if
    opencv is unavailable or the image has no EXIF rotation.
    """
    try:
        import cv2
        import numpy as np
    except ImportError:
        return image_bytes

    orientation = _read_exif_orientation(image_bytes)
    if orientation == 1:
        return image_bytes  # already upright

    nparr = np.frombuffer(image_bytes, np.uint8)
    img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
    if img is None:
        return image_bytes

    if orientation == 3:
        img = cv2.rotate(img, cv2.ROTATE_180)
    elif orientation == 6:
        img = cv2.rotate(img, cv2.ROTATE_90_CLOCKWISE)
    elif orientation == 8:
        img = cv2.rotate(img, cv2.ROTATE_90_COUNTERCLOCKWISE)
    # orientations 2/4/5/7 (mirror + rotate) are virtually never produced by
    # phone cameras, so we leave them alone.

    _, encoded = cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, 95])
    logger.info("EXIF orientation %d corrected", orientation)
    return encoded.tobytes()



def preprocess_for_ocr(image_bytes: bytes) -> bytes:
    """Sharpen, upscale, and enhance contrast before OCR.

    Phone photos of plastic ID cards need this: the card occupies a fraction
    of the frame, text is sub-100px tall, and JPEG compression blurs edges.
    Returns the processed image re-encoded as JPEG bytes.
    Falls back to the original bytes if opencv is unavailable.
    """
    try:
        import cv2
        import numpy as np
    except ImportError:
        return image_bytes

    nparr = np.frombuffer(image_bytes, np.uint8)
    img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
    if img is None:
        return image_bytes

    h, w = img.shape[:2]

    # ── 1. Upscale to at least 1800 px wide so small card text is readable ───
    if w < 1800:
        scale = 1800 / w
        img = cv2.resize(
            img, (int(w * scale), int(h * scale)), interpolation=cv2.INTER_CUBIC
        )

    # ── 2. CLAHE on L channel for even contrast across the card ─────────────
    lab = cv2.cvtColor(img, cv2.COLOR_BGR2LAB)
    l_ch, a_ch, b_ch = cv2.split(lab)
    clahe = cv2.createCLAHE(clipLimit=2.5, tileGridSize=(8, 8))
    l_ch = clahe.apply(l_ch)
    img = cv2.cvtColor(cv2.merge([l_ch, a_ch, b_ch]), cv2.COLOR_LAB2BGR)

    # ── 3. Unsharp-mask sharpening ────────────────────────────────────────────
    blurred = cv2.GaussianBlur(img, (0, 0), 3)
    img = cv2.addWeighted(img, 1.5, blurred, -0.5, 0)

    _, encoded = cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, 95])
    return encoded.tobytes()


# ── OCR ───────────────────────────────────────────────────────────────────────

# Detections with score below this are treated as noise
_CONFIDENCE_THRESHOLD = 0.7

# Vertical tolerance for grouping text into the same row (pixels in original res)
_ROW_TOLERANCE_PX = 20


def extract_text(image_bytes: bytes, languages: tuple[str, ...] = ("ar", "fr")) -> list[str]:
    """Extract text lines from a document image using PaddleOCR.

    Returns:
        Lines sorted by their spatial position on the document — top to bottom,
        and right to left within each row (Arabic reading order).  Low-confidence
        detections (score < 0.7) are discarded to reduce noise fragments.
    """
    try:
        from paddleocr import PaddleOCR  # type: ignore[import-not-found]
    except ImportError as exc:
        raise RuntimeError(
            "PaddleOCR is not installed. Install with `uv sync --extra kyc`."
        ) from exc

    enhanced = preprocess_for_ocr(image_bytes)

    ocr = PaddleOCR(use_angle_cls=True, lang=languages[0])
    raw: Any = ocr.ocr(enhanced, cls=True)

    # ── Collect detections with spatial info ─────────────────────────────────
    detections: list[tuple[float, float, str]] = []
    for page in raw or []:
        for line in page or []:
            if len(line) < 2 or not isinstance(line[1], (list, tuple)) or not line[1]:
                continue
            bbox = line[0]
            text_val = line[1][0]
            score = line[1][1] if len(line[1]) > 1 else 0.0

            if not isinstance(text_val, str) or not text_val.strip():
                continue
            if score < _CONFIDENCE_THRESHOLD:
                continue

            y_center = sum(p[1] for p in bbox) / 4
            x_center = sum(p[0] for p in bbox) / 4
            detections.append((y_center, x_center, text_val.strip()))

    if not detections:
        return []

    # ── Sort: top-to-bottom rows, right-to-left within each row ─────────────
    # Round y to the nearest row bucket so items on the same line group together,
    # then sort by descending x (rightmost first = Arabic reading order).
    detections.sort(key=lambda d: (round(d[0] / _ROW_TOLERANCE_PX), -d[1]))

    return [text for _, _, text in detections]


# ── Quality scorer ────────────────────────────────────────────────────────────


def compute_quality_score(image_bytes: bytes) -> float:
    """Return a 0–1 quality score combining sharpness and skew detection.

    Returns 0.0 for images that are unreadable:
    - Laplacian variance normalised to 0–1 (sharpness)
    - Returns 0.0 if the document is tilted more than ~25 degrees

    Falls back to 1.0 if opencv is not installed.
    """
    try:
        import cv2  # type: ignore[import-not-found]
        import numpy as np
    except ImportError:
        return 1.0

    nparr = np.frombuffer(image_bytes, np.uint8)
    img = cv2.imdecode(nparr, cv2.IMREAD_GRAYSCALE)
    if img is None:
        return 0.0

    # ── Sharpness ─────────────────────────────────────────────────────────────
    lap_var: float = float(cv2.Laplacian(img, cv2.CV_64F).var())
    sharpness = min(lap_var / 80.0, 1.0)

    # ── Skew detection via Hough lines ────────────────────────────────────────
    # Reject images where the dominant text angle deviates more than 25° from
    # horizontal — these photos are held at too steep an angle to read reliably.
    try:
        edges = cv2.Canny(img, 50, 150, apertureSize=3)
        lines = cv2.HoughLines(edges, 1, np.pi / 180, threshold=80)
        if lines is not None and len(lines) >= 5:
            angles = []
            for line in lines[:30]:
                theta = float(line[0][1])
                # Convert to degrees from horizontal (-90 to +90)
                deg = np.degrees(theta) - 90
                if abs(deg) <= 45:
                    angles.append(deg)
            if angles:
                median_angle = float(np.median(angles))
                if abs(median_angle) > 25:
                    logger.info(
                        "Skew %.1f° exceeds 25° threshold — rejecting image",
                        median_angle,
                    )
                    return 0.0
    except Exception:
        pass  # skew check is best-effort; don't fail the whole request

    return sharpness
