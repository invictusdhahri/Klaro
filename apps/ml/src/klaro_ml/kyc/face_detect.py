"""MTCNN-based face detection and cropping from identity documents.

Lazy-imported so the base image stays light when the kyc extra is not installed.
"""

from __future__ import annotations

import base64
import io


def detect_and_crop_face(image_bytes: bytes) -> str | None:
    """Detect the photo on an ID document and return a base64-encoded PNG crop.

    Uses MTCNN (from facenet_pytorch) for face detection.  Returns ``None``
    when no face is found so the caller can surface the ``no_face_detected``
    error to the client.

    facenet_pytorch's MTCNN.detect() returns:
        boxes  : np.ndarray | None  shape (N, 4) as [x1, y1, x2, y2]
        probs  : np.ndarray | None  shape (N,)
    """
    try:
        from facenet_pytorch import MTCNN  # type: ignore[import-not-found]
        from PIL import Image  # type: ignore[import-not-found]
    except ImportError as exc:
        raise RuntimeError(
            "facenet-pytorch / Pillow is not installed. Install with `uv sync --extra kyc`."
        ) from exc

    img = Image.open(io.BytesIO(image_bytes)).convert("RGB")

    # keep_all=True returns all detections; select_largest=False so we rank by prob.
    detector = MTCNN(keep_all=True, post_process=False)
    boxes, probs = detector.detect(img)  # type: ignore[misc]

    if boxes is None or len(boxes) == 0:
        return None

    # Pick the box with the highest detection probability.
    best_idx = int(probs.argmax()) if probs is not None else 0  # type: ignore[union-attr]
    x1, y1, x2, y2 = (float(v) for v in boxes[best_idx])

    # Guard against out-of-bounds or degenerate boxes.
    x1, y1 = max(x1, 0.0), max(y1, 0.0)
    x2, y2 = min(x2, float(img.width)), min(y2, float(img.height))

    if x2 <= x1 or y2 <= y1:
        return None

    face_crop = img.crop((x1, y1, x2, y2))

    buf = io.BytesIO()
    face_crop.save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode("ascii")
