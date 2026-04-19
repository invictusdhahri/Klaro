"""Credit scoring endpoint.

Accepts a user_id, fetches all relevant data from Supabase (read-only),
runs the 3-layer scoring pipeline, and returns the full result.
The Express backend is responsible for persisting and notifying.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from klaro_ml.scoring.compose import compose_score
from klaro_ml.scoring.data_checker import InsufficientDataError, check_data_sufficiency
from klaro_ml.settings import get_settings

router = APIRouter()


class ScoreRequest(BaseModel):
    user_id: str = Field(..., alias="userId")

    model_config = {"populate_by_name": True}


class ScoreResponse(BaseModel):
    score: int
    band: str
    risk_category: str
    confidence: float
    breakdown: dict[str, Any]
    flags: list[str]
    explanation: str
    coaching_tips: list[str]
    data_sufficiency: float
    model_version: str


def _get_supabase() -> Any:
    try:
        from supabase import create_client  # type: ignore[import-not-found]
    except ImportError as e:
        raise HTTPException(
            status_code=500, detail="supabase package not installed"
        ) from e
    settings = get_settings()
    if not settings.SUPABASE_URL or not settings.SUPABASE_SERVICE_ROLE_KEY:
        raise HTTPException(
            status_code=500,
            detail="SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set",
        )
    return create_client(settings.SUPABASE_URL, settings.SUPABASE_SERVICE_ROLE_KEY)


def fetch_user_data(user_id: str) -> dict[str, Any]:
    """Fetch all data needed for scoring from Supabase (read-only, service role)."""
    sb = _get_supabase()

    transactions = (
        sb.table("transactions")
        .select("*")
        .eq("user_id", user_id)
        .order("transaction_date", desc=False)
        .execute()
        .data
        or []
    )
    profile = (
        sb.table("profiles")
        .select("*")
        .eq("id", user_id)
        .maybe_single()
        .execute()
        .data
        or {}
    )
    bank_connections = (
        sb.table("bank_connections")
        .select("*")
        .eq("user_id", user_id)
        .execute()
        .data
        or []
    )
    kyc_documents = (
        sb.table("kyc_documents")
        .select("*")
        .eq("user_id", user_id)
        .execute()
        .data
        or []
    )
    bank_statements = (
        sb.table("bank_statements")
        .select("id, status, extracted_count, created_at")
        .eq("user_id", user_id)
        .eq("status", "processed")
        .execute()
        .data
        or []
    )

    return {
        "user_id": user_id,
        "transactions": transactions,
        "profile": profile,
        "bank_connections": bank_connections,
        "kyc_documents": kyc_documents,
        "bank_statements": bank_statements,
    }


@router.post("", response_model=ScoreResponse)
def score(req: ScoreRequest) -> ScoreResponse:
    user_data = fetch_user_data(req.user_id)

    try:
        sufficiency = check_data_sufficiency(user_data)
    except InsufficientDataError as exc:
        raise HTTPException(
            status_code=422,
            detail={
                "code": "INSUFFICIENT_DATA",
                "message": "Not enough financial data to generate a Klaro credit score",
                "data_gaps": exc.data_gaps,
                "data_sufficiency": exc.sufficiency,
                "suggestions": [
                    "Connect a bank account (Attijari, BIAT, STB, BNA)",
                    "Upload your last 3 months of bank statements",
                    "Ensure your account has been active for at least 2 months",
                ],
            },
        ) from exc

    result = compose_score(user_data)
    result["data_sufficiency"] = sufficiency
    return ScoreResponse(**result)
