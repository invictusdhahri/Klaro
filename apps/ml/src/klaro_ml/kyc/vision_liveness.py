"""Claude Vision-based liveness detection and face-match for KYC.

Both functions follow the same pattern as vision_extractor.py: they send
base64-encoded images directly to Claude Haiku Vision and parse structured
JSON from the response.
"""

from __future__ import annotations

import base64
import json
import logging

from klaro_ml.settings import Settings

logger = logging.getLogger(__name__)

# ── Liveness ──────────────────────────────────────────────────────────────────

_LIVENESS_SYSTEM_PROMPT = """\
You are confirming an already-completed liveness challenge. The user has
ALREADY demonstrated head rotation and (likely) blinking — verified
client-side via MediaPipe FaceLandmarker (Google's facial geometry model).

Your ONLY job is to detect OBVIOUS spoofing in the snapshot frames.

DEFAULT TO PASSED. Only reject if you see CLEAR evidence of:
  1. A flat printed photograph (visible paper edges, paper texture, ink dots)
  2. A phone or tablet screen displayed in front of the camera (visible
     screen bezel, pixel grid, screen reflection / glare patterns)
  3. A mask with visible edges, seams, or unnatural skin texture
  4. NO face at all in any frame (completely blank / wrong subject)

REAL HUMAN FACES — even partial, slightly blurry, poorly lit, at odd angles,
or wearing glasses — should ALWAYS pass with high confidence.

If client_signals indicate blink_detected and yaw rotation, weight your
decision strongly toward passed=true unless you see obvious spoofing.

- blink: mirror the client signal if provided, else infer from frames.
- head_rotation: mirror the client signal if provided, else infer from frames.
- confidence: 0.9+ for clear real face, 0.5-0.7 if uncertain, <0.3 only for
  clear spoofing.

Return ONLY valid JSON — no markdown, no explanation.

Output schema:
{
  "passed": true,
  "blink": true,
  "head_rotation": true,
  "confidence": 0.92
}
"""


def check_liveness_via_vision(
    frames_b64: list[str],
    settings: Settings,
    client_signals: dict | None = None,
) -> dict[str, bool | float]:
    """Analyse webcam frames with Claude Vision and return liveness signals.

    Falls back to passed=False, confidence=0.0 on any error.
    """
    _fail: dict[str, bool | float] = {
        "passed": False,
        "blink": False,
        "head_rotation": False,
        "confidence": 0.0,
    }

    if not settings.ANTHROPIC_API_KEY:
        logger.error("ANTHROPIC_API_KEY not set; cannot call Claude Vision.")
        return _fail

    if not frames_b64:
        return _fail

    try:
        import anthropic  # type: ignore[import-not-found]
    except ImportError as exc:
        raise RuntimeError("anthropic package is not installed.") from exc

    client = anthropic.Anthropic(api_key=settings.ANTHROPIC_API_KEY)

    # Build content: up to 3 frames + instruction text
    content: list[dict] = []
    for i, b64 in enumerate(frames_b64[:3]):
        # Detect mime from magic bytes
        raw = base64.b64decode(b64 + "==")  # pad for safety
        mime = "image/jpeg"
        if raw[:4] == b"\x89PNG":
            mime = "image/png"
        content.append({
            "type": "image",
            "source": {"type": "base64", "media_type": mime, "data": b64},
        })
        content.append({
            "type": "text",
            "text": f"Frame {i + 1} of {min(len(frames_b64), 3)}",
        })

    if client_signals:
        content.append({
            "type": "text",
            "text": (
                "Client-side signals (verified via MediaPipe FaceLandmarker):\n"
                f"  blink_detected:    {client_signals.get('blink_detected', False)}\n"
                f"  yaw_right_reached: {client_signals.get('yaw_right_reached', False)}\n"
                f"  yaw_left_reached:  {client_signals.get('yaw_left_reached', False)}\n"
                f"  pitch_up_reached:  {client_signals.get('pitch_up_reached', False)}\n"
                f"  max_yaw_deg:       {client_signals.get('max_yaw_deg', 0.0):.1f}\n"
                "Trust these unless you see clear spoofing in the frames."
            ),
        })

    content.append({
        "type": "text",
        "text": "Analyse these frames for liveness and return the JSON result.",
    })

    try:
        message = client.messages.create(
            model=settings.CLAUDE_HAIKU,
            max_tokens=256,
            system=_LIVENESS_SYSTEM_PROMPT,
            messages=[{"role": "user", "content": content}],
        )
    except Exception as exc:
        logger.error("Claude Vision liveness call failed: %s", exc)
        return _fail

    raw_text = message.content[0].text.strip()
    logger.debug("Liveness response: %s", raw_text)

    if raw_text.startswith("```"):
        raw_text = "\n".join(
            line for line in raw_text.splitlines() if not line.startswith("```")
        ).strip()

    try:
        parsed: dict = json.loads(raw_text)
    except json.JSONDecodeError:
        logger.error("Liveness response was not valid JSON: %s", raw_text)
        return _fail

    passed = bool(parsed.get("passed", False))
    confidence = float(parsed.get("confidence", 0.0))
    blink = bool(parsed.get("blink", False))
    head_rotation = bool(parsed.get("head_rotation", False))

    # Trust strong client signals: if MediaPipe verified blink AND meaningful
    # yaw on both sides, override unless Claude is highly confident it's a spoof
    # (very low confidence on a passed=false call indicates clear spoofing).
    if client_signals and not passed and confidence > 0.4:
        client_blink = bool(client_signals.get("blink_detected", False))
        client_yaw_r = bool(client_signals.get("yaw_right_reached", False))
        client_yaw_l = bool(client_signals.get("yaw_left_reached", False))
        client_pitch = bool(client_signals.get("pitch_up_reached", False))
        if client_blink and client_yaw_r and client_yaw_l and client_pitch:
            logger.info("Overriding Claude liveness=false (client signals strong).")
            passed = True
            blink = True
            head_rotation = True
            confidence = max(confidence, 0.75)

    return {
        "passed": passed,
        "blink": blink,
        "head_rotation": head_rotation,
        "confidence": confidence,
    }


# ── Face match ────────────────────────────────────────────────────────────────

_FACE_MATCH_SYSTEM_PROMPT = """\
You are a face-verification system. You will receive exactly two images:
  Image A — a face crop taken from a government-issued identity document.
  Image B — a selfie captured live from a webcam.

Decide whether both images show the same person.

IMPORTANT CONTEXT — read before comparing:
- Image A is cropped from a physical ID card. It is commonly:
    • Grayscale / black-and-white (printed on paper or card)
    • Small, lower resolution, and possibly slightly blurry
    • From years ago — the person may look younger
    • Printed with less dynamic range than a digital photo
- Image B is a live colour webcam frame with normal digital quality.
  These visual differences are EXPECTED and should NOT affect your verdict.

COMPARISON RULES:
- Compare FACIAL GEOMETRY ONLY: inter-ocular distance, nose bridge width,
  nose tip shape, jaw shape, cheekbone prominence, lip shape, overall face
  proportions.
- Ignore: colour vs grayscale, age (±10 years), lighting, background,
  image resolution, hairstyle, facial hair, expression, accessories.
- A correct match between a B&W ID photo and a colour selfie of the SAME
  person will often look "different" superficially. Look past that.
- Set match: true when the facial geometry is consistent.
- Set match: false only when the underlying bone structure is clearly
  from a different person (different face shape, different nose, etc.).
- similarity: 0.0–1.0. For a confident same-person match give ≥ 0.75.
- threshold: 0.55 (lower than typical because of the B&W/colour difference).
  Set match: true when similarity >= 0.55.

Return ONLY valid JSON — no markdown, no explanation.

Output schema:
{
  "match": true,
  "similarity": 0.82,
  "threshold": 0.55
}
"""


def match_faces_via_vision(
    doc_face_b64: str,
    selfie_b64: str,
    settings: Settings,
) -> dict[str, bool | float]:
    """Compare doc face crop and selfie using Claude Vision.

    Falls back to match=False, similarity=0.0 on any error.
    """
    _fail: dict[str, bool | float] = {"match": False, "similarity": 0.0, "threshold": 0.55}

    if not settings.ANTHROPIC_API_KEY:
        logger.error("ANTHROPIC_API_KEY not set; cannot call Claude Vision.")
        return _fail

    try:
        import anthropic  # type: ignore[import-not-found]
    except ImportError as exc:
        raise RuntimeError("anthropic package is not installed.") from exc

    client = anthropic.Anthropic(api_key=settings.ANTHROPIC_API_KEY)

    def _mime(b64: str) -> str:
        try:
            raw = base64.b64decode(b64 + "==")
            return "image/png" if raw[:4] == b"\x89PNG" else "image/jpeg"
        except Exception:
            return "image/jpeg"

    content = [
        {"type": "text", "text": "Image A — identity document face crop:"},
        {"type": "image", "source": {"type": "base64", "media_type": _mime(doc_face_b64), "data": doc_face_b64}},
        {"type": "text", "text": "Image B — live selfie:"},
        {"type": "image", "source": {"type": "base64", "media_type": _mime(selfie_b64), "data": selfie_b64}},
        {"type": "text", "text": "Are these the same person? Return the JSON result."},
    ]

    try:
        message = client.messages.create(
            model=settings.CLAUDE_HAIKU,
            max_tokens=128,
            system=_FACE_MATCH_SYSTEM_PROMPT,
            messages=[{"role": "user", "content": content}],
        )
    except Exception as exc:
        logger.error("Claude Vision face-match call failed: %s", exc)
        return _fail

    raw_text = message.content[0].text.strip()
    logger.debug("Face-match response: %s", raw_text)

    if raw_text.startswith("```"):
        raw_text = "\n".join(
            line for line in raw_text.splitlines() if not line.startswith("```")
        ).strip()

    try:
        parsed: dict = json.loads(raw_text)
    except json.JSONDecodeError:
        logger.error("Face-match response was not valid JSON: %s", raw_text)
        return _fail

    similarity = float(parsed.get("similarity", 0.0))
    threshold = float(parsed.get("threshold", 0.55))
    match = bool(parsed.get("match", similarity >= threshold))

    return {"match": match, "similarity": similarity, "threshold": threshold}
