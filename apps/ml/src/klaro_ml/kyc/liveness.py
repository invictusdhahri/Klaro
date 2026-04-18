"""MediaPipe-based liveness checks (478 face landmarks). Stub for scaffold."""

from __future__ import annotations


def check_liveness(_video_bytes: bytes) -> dict[str, bool | float]:
    """Return blink, head-rotation, anti-spoof signals + confidence."""
    return {
        "passed": True,
        "blink": True,
        "head_rotation": True,
        "anti_spoof": True,
        "confidence": 0.9,
    }
