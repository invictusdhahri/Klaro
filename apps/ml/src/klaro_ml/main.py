"""FastAPI entry point for the Klaro ML sidecar."""

from __future__ import annotations

import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from klaro_ml.routes import kyc, ocr, score
from klaro_ml.settings import get_settings

settings = get_settings()
logging.basicConfig(level=settings.LOG_LEVEL)

app = FastAPI(
    title="Klaro ML",
    version="0.1.0",
    description="KYC + 3-layer credit scoring sidecar.",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # called only by apps/api inside the private network
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "service": "klaro-ml"}


app.include_router(score.router, prefix="/score", tags=["score"])
app.include_router(kyc.router, prefix="/kyc", tags=["kyc"])
app.include_router(ocr.router, prefix="/ocr", tags=["ocr"])
