"""KYC endpoints — face match and liveness."""

from __future__ import annotations

from fastapi import APIRouter
from pydantic import BaseModel

router = APIRouter()


class StoragePathRequest(BaseModel):
    storagePath: str


class LivenessResponse(BaseModel):
    passed: bool
    confidence: float
    blink: bool = False
    head_rotation: bool = False
    anti_spoof: bool = True


class FaceMatchRequest(BaseModel):
    documentStoragePath: str
    selfieStoragePath: str


class FaceMatchResponse(BaseModel):
    match: bool
    similarity: float
    threshold: float = 0.65


@router.post("/liveness", response_model=LivenessResponse)
def liveness(_req: StoragePathRequest) -> LivenessResponse:
    # TODO: load image from Supabase Storage; run MediaPipe + anti-spoof.
    return LivenessResponse(passed=True, confidence=0.92, blink=True, head_rotation=True)


@router.post("/face-match", response_model=FaceMatchResponse)
def face_match(_req: FaceMatchRequest) -> FaceMatchResponse:
    # TODO: AdaFace embedding + cosine similarity (lazy-load model).
    return FaceMatchResponse(match=True, similarity=0.81)
