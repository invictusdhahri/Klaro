"""Pixel-level forensic checks.

Three independent signals are computed per image:

1. Error-Level Analysis (ELA) — re-save the image at JPEG quality 90, diff the
   result with the original, and look at how energy is distributed. Genuine
   captures show roughly uniform compression error; tampered or composited
   regions produce localised hotspots.

2. FFT spectrum noise floor — natural camera/scanner images contain wide-band
   high-frequency sensor noise. AI-generated images and over-resampled
   screenshots have an artificially low high-frequency floor.

3. Block-wise noise variance inconsistency — split the image into a grid and
   compute local noise variance. Bank scans show uniform sensor noise; AI
   composites and copy-pasted regions show inconsistent variance.

All checks degrade gracefully if numpy / Pillow / OpenCV are missing.
"""

from __future__ import annotations

import io
from typing import Any

# Severity thresholds (deliberately conservative to avoid false positives on
# legitimate scans).
ELA_HOTSPOT_RATIO_HIGH = 0.04   # >4% of pixels with extreme delta → high
ELA_HOTSPOT_RATIO_MED = 0.015   # >1.5% → medium
FFT_HF_FLOOR_LOW = 0.02         # high-freq energy share < 2% → suspicious
NOISE_CV_HIGH = 1.4             # coefficient of variation across blocks


def analyse_image(file_bytes: bytes, mime_type: str) -> list[dict[str, Any]]:
    """Forensic signals for a single image. PDFs should be rasterised first."""
    if not _is_image_mime(mime_type):
        return []

    try:
        import numpy as np
        from PIL import Image
    except ImportError:
        return []

    try:
        img = Image.open(io.BytesIO(file_bytes))
        img.load()
    except Exception:
        return [
            {
                "type": "image_unparseable",
                "severity": "medium",
                "detail": "Image could not be decoded for forensic analysis.",
                "evidence": {},
                "source": "image_forensics",
            }
        ]

    # Normalise to RGB
    if img.mode not in ("RGB", "L"):
        img = img.convert("RGB")
    if img.mode == "L":
        img = img.convert("RGB")

    # Cap working size to keep ELA / FFT cheap on huge captures
    max_dim = 2000
    if max(img.size) > max_dim:
        ratio = max_dim / max(img.size)
        new_size = (int(img.size[0] * ratio), int(img.size[1] * ratio))
        img = img.resize(new_size, Image.Resampling.LANCZOS)

    arr = np.asarray(img, dtype=np.uint8)

    signals: list[dict[str, Any]] = []
    signals.extend(_ela_signals(img, arr, np))
    signals.extend(_fft_signals(arr, np))
    signals.extend(_noise_block_signals(arr, np))
    return signals


def analyse_pdf_pages(file_bytes: bytes, mime_type: str) -> list[dict[str, Any]]:
    """Render every page of a PDF and run image forensics on each.

    Aggregates per-page signals into per-document signals, prefixed with
    page index in the evidence dict so the UI can highlight problem pages.
    """
    if mime_type != "application/pdf":
        return []

    try:
        import fitz  # PyMuPDF
    except ImportError:
        return []

    try:
        doc = fitz.open(stream=file_bytes, filetype="pdf")
    except Exception:
        return []

    aggregated: list[dict[str, Any]] = []
    try:
        # Cap to first 8 pages — beyond that ELA gets expensive and the
        # marginal forensic value drops sharply.
        for page_index in range(min(8, len(doc))):
            try:
                page = doc[page_index]
                pix = page.get_pixmap(matrix=fitz.Matrix(2.0, 2.0))
                page_bytes = pix.tobytes("png")
            except Exception:
                continue
            page_signals = analyse_image(page_bytes, "image/png")
            for sig in page_signals:
                sig.setdefault("evidence", {})["page"] = page_index + 1
                aggregated.append(sig)
    finally:
        doc.close()

    return aggregated


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _is_image_mime(mime_type: str) -> bool:
    return mime_type.startswith("image/")


def _ela_signals(img: Any, arr: Any, np: Any) -> list[dict[str, Any]]:
    """Error-Level Analysis: re-save at quality 90 and inspect the residual."""
    from PIL import Image

    try:
        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=90)
        buf.seek(0)
        recompressed = np.asarray(Image.open(buf).convert("RGB"), dtype=np.int16)
    except Exception:
        return []

    if recompressed.shape != arr.shape:
        # Some PIL versions add padding — trim to common size
        h = min(recompressed.shape[0], arr.shape[0])
        w = min(recompressed.shape[1], arr.shape[1])
        recompressed = recompressed[:h, :w]
        arr_cmp = arr[:h, :w].astype(np.int16)
    else:
        arr_cmp = arr.astype(np.int16)

    delta = np.abs(arr_cmp - recompressed)
    delta_max = delta.max(axis=2)  # per-pixel worst channel

    threshold = 30  # 0–255 scale; >30 is a strong residual
    hotspot_mask = delta_max > threshold
    hotspot_ratio = float(hotspot_mask.mean())
    p99_delta = float(np.percentile(delta_max, 99))

    signals: list[dict[str, Any]] = []
    if hotspot_ratio >= ELA_HOTSPOT_RATIO_HIGH:
        signals.append(
            {
                "type": "image_ela_hotspots",
                "severity": "high",
                "detail": (
                    f"Error-Level Analysis shows {hotspot_ratio:.1%} of pixels with extreme "
                    f"residual energy after JPEG re-compression. Genuine captures sit below "
                    f"{ELA_HOTSPOT_RATIO_HIGH:.1%}; this pattern is consistent with copy-paste "
                    f"or AI-generated regions."
                ),
                "evidence": {
                    "hotspot_ratio": round(hotspot_ratio, 4),
                    "p99_delta": round(p99_delta, 1),
                    "threshold": threshold,
                },
                "source": "image_forensics",
            }
        )
    elif hotspot_ratio >= ELA_HOTSPOT_RATIO_MED:
        signals.append(
            {
                "type": "image_ela_hotspots",
                "severity": "medium",
                "detail": (
                    f"Error-Level Analysis shows elevated residual energy "
                    f"({hotspot_ratio:.1%} of pixels). Worth a closer look."
                ),
                "evidence": {
                    "hotspot_ratio": round(hotspot_ratio, 4),
                    "p99_delta": round(p99_delta, 1),
                    "threshold": threshold,
                },
                "source": "image_forensics",
            }
        )
    return signals


def _fft_signals(arr: Any, np: Any) -> list[dict[str, Any]]:
    """High-frequency content check via 2D FFT.

    Real captures have a wide, gently decaying spectrum. AI-generated or
    upscaled images show an artificially low high-frequency floor.
    """
    try:
        gray = arr.mean(axis=2)
    except Exception:
        return []

    # Use a power-of-two crop for speed and stability of the FFT
    h, w = gray.shape
    side = min(h, w)
    side = 1 << (side.bit_length() - 1)  # largest power of two ≤ side
    if side < 64:
        return []
    cropped = gray[:side, :side]

    try:
        spectrum = np.abs(np.fft.fftshift(np.fft.fft2(cropped)))
    except Exception:
        return []

    spectrum = spectrum / (spectrum.sum() + 1e-9)

    centre = side // 2
    # High-frequency mask: outside a radius of side/4 from the centre
    yy, xx = np.indices(spectrum.shape)
    radius = np.sqrt((yy - centre) ** 2 + (xx - centre) ** 2)
    hf_mask = radius > (side / 4)
    hf_share = float(spectrum[hf_mask].sum())

    if hf_share < FFT_HF_FLOOR_LOW:
        return [
            {
                "type": "image_low_high_frequency",
                "severity": "medium",
                "detail": (
                    f"FFT spectrum shows only {hf_share:.1%} of energy in high-frequency "
                    f"bands (genuine captures sit above {FFT_HF_FLOOR_LOW:.1%}). This is "
                    f"consistent with diffusion-generated or heavily upscaled imagery."
                ),
                "evidence": {
                    "hf_share": round(hf_share, 4),
                    "threshold": FFT_HF_FLOOR_LOW,
                },
                "source": "image_forensics",
            }
        ]
    return []


def _noise_block_signals(arr: Any, np: Any) -> list[dict[str, Any]]:
    """Block-wise local noise variance.

    Sensor noise is roughly uniform across a real capture. AI composites and
    copy-paste regions produce blocks with very different variance, so the
    coefficient of variation across blocks is unusually high.
    """
    try:
        gray = arr.mean(axis=2)
    except Exception:
        return []

    h, w = gray.shape
    block = 64
    if h < block * 4 or w < block * 4:
        return []  # image too small for the block grid to be meaningful

    n_y = h // block
    n_x = w // block
    variances: list[float] = []
    for by in range(n_y):
        for bx in range(n_x):
            patch = gray[by * block:(by + 1) * block, bx * block:(bx + 1) * block]
            # Estimate local noise via Laplacian variance proxy: diff from mean
            variances.append(float(patch.var()))

    if len(variances) < 16:
        return []

    arr_var = np.asarray(variances, dtype=np.float64)
    mean_v = float(arr_var.mean())
    if mean_v < 1e-3:
        return []
    cv = float(arr_var.std() / mean_v)

    if cv >= NOISE_CV_HIGH:
        return [
            {
                "type": "image_noise_inconsistency",
                "severity": "medium",
                "detail": (
                    f"Block-wise noise variance has a coefficient of variation of "
                    f"{cv:.2f} (genuine scans typically sit below {NOISE_CV_HIGH}). "
                    f"This indicates regions of the image come from different sources, "
                    f"consistent with composition or partial overlay editing."
                ),
                "evidence": {
                    "coefficient_of_variation": round(cv, 3),
                    "threshold": NOISE_CV_HIGH,
                    "blocks_analysed": len(variances),
                },
                "source": "image_forensics",
            }
        ]
    return []
