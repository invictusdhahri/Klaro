"""OCR extraction endpoint.

Accepts a multipart/form-data upload containing an identity document image
and runs the full extraction pipeline:

  1. Image quality + skew check
  2. Claude Haiku Vision — reads the document image directly and returns
     structured JSON fields (replaces PaddleOCR + text parsing)
  3. MTCNN — detect and crop the face photo on the document

Returns a rich JSON response ready for the KYC pipeline.
"""

from __future__ import annotations

import logging
from typing import Annotated, Literal

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from pydantic import BaseModel

from klaro_ml.kyc.face_detect import detect_and_crop_face
from klaro_ml.kyc.ocr import auto_rotate_image, compute_quality_score
from klaro_ml.kyc.vision_extractor import extract_fields_via_vision
from klaro_ml.settings import get_settings

router = APIRouter()
logger = logging.getLogger(__name__)

DocumentType = Literal["cin", "passport", "driver_license"]

# ------------------------------------------------------------------
# Response models
# ------------------------------------------------------------------


class ExtractedFields(BaseModel):
    full_name: str | None = None
    full_name_latin: str | None = None
    cin_number: str | None = None
    date_of_birth: str | None = None
    expiry_date: str | None = None
    address: str | None = None
    gender: str | None = None
    occupation: str | None = None
    father_name: str | None = None
    mother_name: str | None = None
    place_of_birth: str | None = None


class OcrSuccessResponse(BaseModel):
    success: Literal[True] = True
    extracted: ExtractedFields
    face_crop_base64: str
    confidence: float
    quality_score: float


class OcrErrorResponse(BaseModel):
    success: Literal[False] = False
    reason: str


# ------------------------------------------------------------------
# Endpoint
# ------------------------------------------------------------------

QUALITY_THRESHOLD = 0.25


@router.post(
    "/extract",
    response_model=OcrSuccessResponse | OcrErrorResponse,
    summary="Extract KYC fields from an identity document image",
)
async def extract(
    image: Annotated[UploadFile, File(description="Identity document image — front side (JPEG or PNG)")],
    document_type: Annotated[
        DocumentType,
        Form(description="Type of document: cin | passport | driver_license"),
    ] = "cin",
    image_verso: Annotated[
        UploadFile | None,
        File(description="Optional back side of the document (CIN / driver licence)"),
    ] = None,
) -> OcrSuccessResponse | OcrErrorResponse:
    settings = get_settings()
    image_bytes = await image.read()
    verso_bytes: bytes | None = await image_verso.read() if image_verso else None

    try:
        # ── 0. EXIF orientation correction ────────────────────────────
        image_bytes = auto_rotate_image(image_bytes)
        if verso_bytes:
            verso_bytes = auto_rotate_image(verso_bytes)

        # ── 1. Quality + skew gate (recto only) ───────────────────────
        quality_score = compute_quality_score(image_bytes)
        logger.info("quality_score=%.3f document_type=%s", quality_score, document_type)

        if quality_score < QUALITY_THRESHOLD:
            reason = "tilted_image" if quality_score == 0.0 else "low_quality"
            return OcrErrorResponse(success=False, reason=reason)

        # ── 2. Claude Vision extraction (recto + optional verso) ──────
        fields_dict, confidence = extract_fields_via_vision(
            image_bytes, document_type, settings, quality_score,
            verso_bytes=verso_bytes,
        )
        logger.info("vision confidence=%.3f verso=%s", confidence, verso_bytes is not None)

        # ── 3. MTCNN face detection (recto only) ──────────────────────
        face_crop_b64 = detect_and_crop_face(image_bytes)
        if face_crop_b64 is None:
            return OcrErrorResponse(success=False, reason="no_face_detected")

        return OcrSuccessResponse(
            success=True,
            extracted=ExtractedFields(**fields_dict),
            face_crop_base64=face_crop_b64,
            confidence=confidence,
            quality_score=round(quality_score, 4),
        )

    except Exception:
        logger.exception("Unhandled error in /ocr/extract")
        raise HTTPException(status_code=500, detail="ocr_pipeline_error")
