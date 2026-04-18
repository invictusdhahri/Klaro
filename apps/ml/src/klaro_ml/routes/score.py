"""Credit scoring endpoint."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter
from pydantic import BaseModel, Field

from klaro_ml.scoring.compose import compose_score

router = APIRouter()


class ScoreRequest(BaseModel):
    user_id: str = Field(..., alias="userId")
    features: dict[str, Any]


class ScoreResponse(BaseModel):
    score: int
    band: str
    breakdown: dict[str, float]
    flags: list[str]
    recommendations: list[str]
    confidence: float
    model_version: str


@router.post("", response_model=ScoreResponse)
def score(req: ScoreRequest) -> ScoreResponse:
    result = compose_score(req.features)
    return ScoreResponse(**result)
