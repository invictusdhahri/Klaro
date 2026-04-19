"""KYC endpoints — liveness detection and face match."""

from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from klaro_ml.kyc.vision_liveness import check_liveness_via_vision, match_faces_via_vision
from klaro_ml.settings import get_settings

router = APIRouter()
logger = logging.getLogger(__name__)


# ── Request / response models ─────────────────────────────────────────────────


class ClientLivenessSignals(BaseModel):
    """Signals computed in the browser via MediaPipe FaceLandmarker.

    The browser already verifies a real human is performing the challenge
    (sustained yaw rotation past a threshold, blink detected from blendshapes,
    pitch tilt detected). Claude only needs to rule out OBVIOUS spoofing.
    """

    blink_detected: bool = False
    yaw_right_reached: bool = False
    yaw_left_reached: bool = False
    pitch_up_reached: bool = False
    max_yaw_deg: float = 0.0


class LivenessRequest(BaseModel):
    frames: list[str]
    client_signals: ClientLivenessSignals | None = None


class LivenessResponse(BaseModel):
    passed: bool
    confidence: float
    blink: bool = False
    head_rotation: bool = False


class FaceMatchRequest(BaseModel):
    selfie_base64: str
    doc_face_base64: str


class FaceMatchResponse(BaseModel):
    match: bool
    similarity: float
    threshold: float = 0.65


# ── Endpoints ─────────────────────────────────────────────────────────────────


@router.post("/liveness", response_model=LivenessResponse)
def liveness(req: LivenessRequest) -> LivenessResponse:
    """Analyse webcam frames for liveness signals using Claude Vision."""
    if not req.frames:
        raise HTTPException(status_code=422, detail="frames must be a non-empty list")

    settings = get_settings()
    client_signals = req.client_signals.model_dump() if req.client_signals else None
    try:
        result = check_liveness_via_vision(req.frames, settings, client_signals)
    except Exception:
        logger.exception("Unhandled error in /liveness")
        raise HTTPException(status_code=500, detail="liveness_pipeline_error")

    return LivenessResponse(
        passed=bool(result["passed"]),
        confidence=float(result["confidence"]),
        blink=bool(result.get("blink", False)),
        head_rotation=bool(result.get("head_rotation", False)),
    )


@router.post("/face-match", response_model=FaceMatchResponse)
def face_match(req: FaceMatchRequest) -> FaceMatchResponse:
    """Compare a live selfie against the face crop from the identity document."""
    settings = get_settings()
    try:
        result = match_faces_via_vision(req.doc_face_base64, req.selfie_base64, settings)
    except Exception:
        logger.exception("Unhandled error in /face-match")
        raise HTTPException(status_code=500, detail="face_match_pipeline_error")

    return FaceMatchResponse(
        match=bool(result["match"]),
        similarity=float(result["similarity"]),
        threshold=float(result.get("threshold", 0.65)),
    )
