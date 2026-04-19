"""Statement processing route — Path B pipeline orchestrator.

POST /statements/process
  Body: { storagePath, mimeType, userContext }
  Returns: StatementProcessResult
    {
      extraction: { transactions },
      verification: { passed, failed_layer, layers: { deepfake, authenticity, consistency } },
      anomalies:   { anomaly_score, flagged, signals }
    }

Pipeline:
  Pass 1  → Extract transactions (format-aware)
  Layer 1 → Deepfake / manipulation detection
  Layer 2 → Document authenticity (structural rules)
  Layer 3 → Cross-consistency + web search (Claude tool-use + Tavily)
  Gate    → PASS → Anomaly Detector → return full result
            FAIL → return verification failure + empty extraction
"""

from __future__ import annotations

import io
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
    occupationCategory: str | None = None
    kycStatus: str = "pending"
    locationGovernorate: str | None = None
    kycDocuments: list[KycDocument] = []
    priorStatements: list[PriorStatement] = []


class StatementProcessRequest(BaseModel):
    storagePath: str
    mimeType: str
    userContext: UserContext
    fileBytes: str | None = None  # base64-encoded; if provided, storage download is skipped


class StatementProcessResponse(BaseModel):
    extraction: dict[str, Any]
    verification: dict[str, Any]
    anomalies: dict[str, Any]


# ---------------------------------------------------------------------------
# Endpoint
# ---------------------------------------------------------------------------

@router.post("/process", response_model=StatementProcessResponse)
async def process_statement(req: StatementProcessRequest) -> StatementProcessResponse:
    settings = get_settings()

    # Download file — use inline bytes if the backend passed them, otherwise fetch from storage
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

    # Retrieve raw text for Layer 2 (best-effort from PDF text extraction)
    extracted_text = _get_text_for_authenticity(file_bytes, mime)

    # ------------------------------------------------------------------
    # Layer 1 — Deepfake detection
    # ------------------------------------------------------------------
    logger.info("Layer 1: deepfake check")
    l1 = check_deepfake(file_bytes, mime)
    logger.info("Layer 1 result: passed=%s confidence=%.2f", l1.get("passed"), l1.get("confidence", 0))

    if not l1.get("passed", True):
        return _verification_failed("deepfake", l1, transactions)

    # ------------------------------------------------------------------
    # Layer 2 — Document authenticity
    # ------------------------------------------------------------------
    logger.info("Layer 2: authenticity check")
    l2 = check_authenticity(extracted_text, transactions)
    logger.info("Layer 2 result: passed=%s score=%.2f failed_rules=%s",
                l2.get("passed"), l2.get("score", 0), l2.get("failed_rules", []))

    if not l2.get("passed", True):
        return _verification_failed("authenticity", l1, transactions, l2=l2)

    # ------------------------------------------------------------------
    # Layer 3 — Cross-consistency + web search
    # ------------------------------------------------------------------
    logger.info("Layer 3: cross-consistency check")
    l1_signals = l1.get("signals", [])
    l3 = check_consistency(transactions, user_ctx, l1_signals)
    logger.info("Layer 3 result: passed=%s coherence=%.2f flags=%d",
                l3.get("passed"), l3.get("coherence_score", 0), len(l3.get("flags", [])))

    if not l3.get("passed", True):
        return _verification_failed("consistency", l1, transactions, l2=l2, l3=l3)

    # ------------------------------------------------------------------
    # All layers PASSED — run Anomaly Detector
    # ------------------------------------------------------------------
    logger.info("All layers passed. Running anomaly detector.")
    anomalies = detect_anomalies(transactions, user_ctx)
    logger.info("Anomaly detector: score=%.2f flagged=%s", anomalies.get("anomaly_score", 0), anomalies.get("flagged"))

    return StatementProcessResponse(
        extraction={"transactions": transactions},
        verification={
            "passed": True,
            "failed_layer": None,
            "layers": {
                "deepfake": l1,
                "authenticity": l2,
                "consistency": l3,
            },
        },
        anomalies=anomalies,
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
        # supabase-py not installed — try direct HTTP download
        return _download_via_http(storage_path, settings)
    except Exception as exc:
        logger.error("Storage download failed: %s", exc)
        return _download_via_http(storage_path, settings)


def _download_via_http(storage_path: str, settings: Any) -> bytes | None:
    """Fallback: download via Supabase Storage REST API."""
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
    l2: dict[str, Any] | None = None,
    l3: dict[str, Any] | None = None,
) -> StatementProcessResponse:
    return StatementProcessResponse(
        extraction={"transactions": []},
        verification={
            "passed": False,
            "failed_layer": failed_layer,
            "layers": {
                "deepfake": l1,
                "authenticity": l2 or {"passed": True, "score": 1.0, "failed_rules": []},
                "consistency": l3 or {"passed": True, "coherence_score": 1.0, "flags": [], "web_checks": []},
            },
        },
        anomalies={"anomaly_score": 0.0, "flagged": False, "signals": []},
    )


def _error_response(message: str) -> StatementProcessResponse:
    return StatementProcessResponse(
        extraction={"transactions": []},
        verification={
            "passed": False,
            "failed_layer": "extraction",
            "layers": {
                "deepfake": {"passed": False, "confidence": 0.0, "signals": [message]},
                "authenticity": {"passed": False, "score": 0.0, "failed_rules": [message]},
                "consistency": {"passed": False, "coherence_score": 0.0, "flags": [], "web_checks": []},
            },
        },
        anomalies={"anomaly_score": 0.0, "flagged": False, "signals": []},
    )
