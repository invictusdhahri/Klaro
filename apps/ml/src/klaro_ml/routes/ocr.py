"""OCR extraction endpoint."""

from __future__ import annotations

from fastapi import APIRouter
from pydantic import BaseModel

router = APIRouter()


class OcrExtractRequest(BaseModel):
    storagePath: str


class OcrExtractResponse(BaseModel):
    fields: dict[str, str]


@router.post("/extract", response_model=OcrExtractResponse)
def extract(_req: OcrExtractRequest) -> OcrExtractResponse:
    # TODO: download from Supabase Storage; run PaddleOCR (AR + FR);
    # then have Claude Haiku structure raw text into KYC fields.
    return OcrExtractResponse(fields={})
