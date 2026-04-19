"""Statement processing route — multi-layer pipeline orchestrator.

Endpoints
---------
POST /statements/process
    Run the full pipeline (extraction + L1-L4) and return a verdict.

POST /statements/reanalyze
    Re-run only L3.5 (income plausibility) + L4 (reasoner) using the previous
    verification report and a fresh batch of user answers. Used by the inline
    "Review needed" panel on the frontend after the user answers a question.

Pipeline
--------
    Pass 1  → Extract transactions (format-aware)
    L1      → Forensics bundle (PDF structure + image forensics + vision ensemble)
    L2      → Document authenticity (structural rules)
    L3      → Cross-consistency + web search
    L3.5    → Income plausibility (deterministic comparator + sanity Sonnet)
    L4      → Critical-thinking reasoner (clamped LLM + rubric)
    Gate    → APPROVED  → Anomaly detector → return result
              NEEDS_REVIEW → return result with questions, status pending answers
              REJECTED  → return verification failure
"""

from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter
from pydantic import BaseModel

from klaro_ml.settings import get_settings
from klaro_ml.statements.anomaly import detect_anomalies
from klaro_ml.statements.authenticity import check_authenticity
from klaro_ml.statements.consistency import check_consistency
from klaro_ml.statements.deepfake import check_deepfake
from klaro_ml.statements.extractor import extract_transactions
from klaro_ml.statements.income_plausibility import check_income_plausibility
from klaro_ml.statements.reasoner import reason as run_reasoner

logger = logging.getLogger(__name__)
router = APIRouter()


# ---------------------------------------------------------------------------
# Request / response models
# ---------------------------------------------------------------------------

class KycDocument(BaseModel):
    type: str
    status: str


class PriorStatement(BaseModel):
    fileName: str
    uploadedAt: str


class UserContext(BaseModel):
    fullName: str
    occupation: str | None = None
    occupationCategory: str | None = None
    educationLevel: str | None = None
    age: int | None = None
    kycStatus: str = "pending"
    locationGovernorate: str | None = None
    locationCountry: str | None = "TN"
    kycDocuments: list[KycDocument] = []
    priorStatements: list[PriorStatement] = []


class ClarificationAnswer(BaseModel):
    question_id: str
    value: Any


class StatementProcessRequest(BaseModel):
    storagePath: str
    mimeType: str
    userContext: UserContext
    fileBytes: str | None = None  # base64-encoded; if provided, storage download is skipped


class StatementReanalyzeRequest(BaseModel):
    """Re-runs L3.5 + L4 with the previous report + new answers."""
    userContext: UserContext
    transactions: list[dict[str, Any]]
    layers: dict[str, Any]   # the previous `verification.layers` payload
    previousAnswers: list[ClarificationAnswer] = []
    newAnswers: list[ClarificationAnswer]


class StatementProcessResponse(BaseModel):
    extraction: dict[str, Any]
    verification: dict[str, Any]
    anomalies: dict[str, Any]
    reasoning: dict[str, Any]


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.post("/process", response_model=StatementProcessResponse)
async def process_statement(req: StatementProcessRequest) -> StatementProcessResponse:
    settings = get_settings()

    if req.fileBytes:
        import base64 as _b64
        file_bytes = _b64.b64decode(req.fileBytes)
    else:
        file_bytes = _download_file(req.storagePath, settings)

    if file_bytes is None:
        logger.error("Failed to download file: %s", req.storagePath)
        return _error_response("Could not download file from storage")

    user_ctx = req.userContext.model_dump()
    mime = req.mimeType

    # ------------------------------------------------------------------
    # Pass 1 — Extract transactions
    # ------------------------------------------------------------------
    logger.info("Pass 1: extracting transactions from %s (%s)", req.storagePath, mime)
    transactions = extract_transactions(file_bytes, mime)
    logger.info("Pass 1 complete: %d transactions extracted", len(transactions))

    extracted_text = _get_text_for_authenticity(file_bytes, mime)

    # ------------------------------------------------------------------
    # Layer 1 — Deepfake forensics bundle
    # ------------------------------------------------------------------
    logger.info("Layer 1: forensics bundle")
    l1 = check_deepfake(file_bytes, mime)
    logger.info("Layer 1 result: passed=%s risk=%.2f signals=%d",
                l1.get("passed"), l1.get("risk_score", 0), len(l1.get("signals", [])))

    if not l1.get("passed", True):
        # Hard fail at L1 -> reject without further layers
        return _verification_failed("deepfake", l1, transactions, user_ctx)

    # ------------------------------------------------------------------
    # Layer 2 — Document authenticity
    # ------------------------------------------------------------------
    logger.info("Layer 2: authenticity check")
    l2 = check_authenticity(extracted_text, transactions)
    logger.info("Layer 2 result: passed=%s score=%.2f failed_rules=%s",
                l2.get("passed"), l2.get("score", 0), l2.get("failed_rules", []))

    if not l2.get("passed", True):
        return _verification_failed("authenticity", l1, transactions, user_ctx, l2=l2)

    # ------------------------------------------------------------------
    # Layer 3 — Cross-consistency + web search
    # ------------------------------------------------------------------
    logger.info("Layer 3: cross-consistency check")
    l1_signal_strings = [str(s.get("type", "")) for s in l1.get("signals", [])]
    l3 = check_consistency(transactions, user_ctx, l1_signal_strings)
    logger.info("Layer 3 result: passed=%s coherence=%.2f flags=%d",
                l3.get("passed"), l3.get("coherence_score", 0), len(l3.get("flags", [])))

    if not l3.get("passed", True):
        return _verification_failed("consistency", l1, transactions, user_ctx, l2=l2, l3=l3)

    # ------------------------------------------------------------------
    # Layer 3.5 — Income plausibility
    # ------------------------------------------------------------------
    logger.info("Layer 3.5: income plausibility check")
    l35 = check_income_plausibility(transactions, user_ctx, answers=[])
    logger.info(
        "Layer 3.5 result: passed=%s implied=%.0f flags=%d questions=%d",
        l35.get("passed"),
        l35.get("implied_monthly_income", 0),
        len(l35.get("flags", [])),
        len(l35.get("suggested_questions", [])),
    )

    layers = {
        "deepfake": l1,
        "authenticity": l2,
        "consistency": l3,
        "income_plausibility": l35,
    }

    # ------------------------------------------------------------------
    # Layer 4 — Critical-thinking reasoner
    # ------------------------------------------------------------------
    logger.info("Layer 4: reasoner")
    reasoning = run_reasoner(layers, user_ctx, answers=[])
    logger.info("Reasoner verdict=%s risk=%.2f questions=%d",
                reasoning.get("verdict"),
                reasoning.get("risk_score", 0),
                len(reasoning.get("questions", [])))

    verdict = reasoning.get("verdict", "approved")

    # Run anomaly detector even on needs_review so the UI gets full context;
    # only skip on outright rejection.
    if verdict == "rejected":
        return _verification_failed_with_reasoning(
            "reasoner", layers, transactions, user_ctx, reasoning,
        )

    anomalies = detect_anomalies(transactions, user_ctx)
    logger.info("Anomaly detector: score=%.2f flagged=%s",
                anomalies.get("anomaly_score", 0), anomalies.get("flagged"))

    return StatementProcessResponse(
        extraction={"transactions": transactions},
        verification={
            "passed": verdict in ("approved", "needs_review"),
            "verdict": verdict,
            "failed_layer": None,
            "layers": layers,
        },
        anomalies=anomalies,
        reasoning=reasoning,
    )


@router.post("/reanalyze", response_model=StatementProcessResponse)
async def reanalyze_statement(req: StatementReanalyzeRequest) -> StatementProcessResponse:
    """Re-run L3.5 + L4 with new user answers. L1-L3 are reused as-is."""
    user_ctx = req.userContext.model_dump()

    merged_answers = [
        {"question_id": a.question_id, "value": a.value}
        for a in (req.previousAnswers + req.newAnswers)
    ]

    # Re-run only the layers that depend on user answers
    l35 = check_income_plausibility(req.transactions, user_ctx, answers=merged_answers)

    layers = dict(req.layers)
    layers["income_plausibility"] = l35

    reasoning = run_reasoner(layers, user_ctx, answers=merged_answers)
    verdict = reasoning.get("verdict", "approved")

    if verdict == "rejected":
        return _verification_failed_with_reasoning(
            "reasoner", layers, req.transactions, user_ctx, reasoning,
        )

    anomalies = detect_anomalies(req.transactions, user_ctx)

    return StatementProcessResponse(
        extraction={"transactions": req.transactions},
        verification={
            "passed": verdict in ("approved", "needs_review"),
            "verdict": verdict,
            "failed_layer": None,
            "layers": layers,
        },
        anomalies=anomalies,
        reasoning=reasoning,
    )


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _download_file(storage_path: str, settings: Any) -> bytes | None:
    """Download a file from Supabase Storage using the service-role key."""
    try:
        from supabase import create_client  # type: ignore[import-not-found]

        supabase_url = settings.SUPABASE_URL
        supabase_key = settings.SUPABASE_SERVICE_ROLE_KEY

        if not supabase_url or not supabase_key:
            logger.warning("Supabase credentials not configured in ML service")
            return None

        client = create_client(supabase_url, supabase_key)
        bucket = "bank-statements"
        response = client.storage.from_(bucket).download(storage_path)
        return response
    except ImportError:
        return _download_via_http(storage_path, settings)
    except Exception as exc:
        logger.error("Storage download failed: %s", exc)
        return _download_via_http(storage_path, settings)


def _download_via_http(storage_path: str, settings: Any) -> bytes | None:
    try:
        import httpx

        supabase_url = getattr(settings, "SUPABASE_URL", None)
        supabase_key = getattr(settings, "SUPABASE_SERVICE_ROLE_KEY", None)

        if not supabase_url or not supabase_key:
            return None

        url = f"{supabase_url}/storage/v1/object/bank-statements/{storage_path}"
        resp = httpx.get(
            url,
            headers={"Authorization": f"Bearer {supabase_key}", "apikey": supabase_key},
            timeout=30.0,
        )
        if resp.status_code == 200:
            return resp.content
        logger.error("HTTP storage download failed: %s", resp.status_code)
        return None
    except Exception as exc:
        logger.error("HTTP download failed: %s", exc)
        return None


def _get_text_for_authenticity(file_bytes: bytes, mime_type: str) -> str:
    """Extract raw text from PDF for Layer 2 (best-effort)."""
    if mime_type != "application/pdf":
        return ""
    try:
        import fitz
        doc = fitz.open(stream=file_bytes, filetype="pdf")
        return "\n".join(page.get_text() for page in doc)
    except Exception:
        return ""


def _verification_failed(
    failed_layer: str,
    l1: dict[str, Any],
    transactions: list[dict[str, Any]],
    user_ctx: dict[str, Any],
    l2: dict[str, Any] | None = None,
    l3: dict[str, Any] | None = None,
) -> StatementProcessResponse:
    """Used when L1/L2/L3 fail before income/reasoner can run."""
    layers = {
        "deepfake": l1,
        "authenticity": l2 or _placeholder_authenticity(),
        "consistency": l3 or _placeholder_consistency(),
        "income_plausibility": _placeholder_income(),
    }
    # Run the reasoner anyway so the UI gets a narrative on failure
    try:
        reasoning = run_reasoner(layers, user_ctx, answers=[])
        # Force verdict to rejected when an early layer hard-failed
        reasoning["verdict"] = "rejected"
    except Exception:
        reasoning = {
            "risk_score": 1.0,
            "verdict": "rejected",
            "reasoning_summary": f"Verification failed at layer: {failed_layer}.",
            "per_flag_explanations": [],
            "questions": [],
        }
    return StatementProcessResponse(
        extraction={"transactions": []},
        verification={
            "passed": False,
            "verdict": "rejected",
            "failed_layer": failed_layer,
            "layers": layers,
        },
        anomalies={"anomaly_score": 0.0, "flagged": False, "signals": []},
        reasoning=reasoning,
    )


def _verification_failed_with_reasoning(
    failed_layer: str,
    layers: dict[str, Any],
    transactions: list[dict[str, Any]],
    user_ctx: dict[str, Any],
    reasoning: dict[str, Any],
) -> StatementProcessResponse:
    return StatementProcessResponse(
        extraction={"transactions": []},
        verification={
            "passed": False,
            "verdict": "rejected",
            "failed_layer": failed_layer,
            "layers": layers,
        },
        anomalies={"anomaly_score": 0.0, "flagged": False, "signals": []},
        reasoning=reasoning,
    )


def _error_response(message: str) -> StatementProcessResponse:
    layers = {
        "deepfake": {"passed": False, "score": 0.0, "risk_score": 1.0, "confidence": 0.0,
                     "signals": [{"type": "extraction_error", "severity": "critical",
                                  "detail": message, "evidence": {}, "source": "orchestrator"}],
                     "reasoning": message},
        "authenticity": _placeholder_authenticity(),
        "consistency": _placeholder_consistency(),
        "income_plausibility": _placeholder_income(),
    }
    return StatementProcessResponse(
        extraction={"transactions": []},
        verification={
            "passed": False,
            "verdict": "rejected",
            "failed_layer": "extraction",
            "layers": layers,
        },
        anomalies={"anomaly_score": 0.0, "flagged": False, "signals": []},
        reasoning={
            "risk_score": 1.0,
            "verdict": "rejected",
            "reasoning_summary": message,
            "per_flag_explanations": [],
            "questions": [],
        },
    )


def _placeholder_authenticity() -> dict[str, Any]:
    return {"passed": True, "score": 1.0, "failed_rules": []}


def _placeholder_consistency() -> dict[str, Any]:
    return {"passed": True, "coherence_score": 1.0, "flags": [], "web_checks": []}


def _placeholder_income() -> dict[str, Any]:
    return {
        "passed": True,
        "implied_monthly_income": 0.0,
        "local_band": {"p25": 0, "p50": 0, "p75": 0, "currency": "TND", "source": "skipped"},
        "remote_band": {"p25": 0, "p50": 0, "p75": 0, "currency": "TND", "source": "skipped"},
        "gap_local_pct": 0.0,
        "gap_remote_pct": 0.0,
        "primary_band": "local",
        "foreign_currency_share": 0.0,
        "flags": [],
        "suggested_questions": [],
        "reasoning": "Layer skipped — earlier layer failed.",
    }
