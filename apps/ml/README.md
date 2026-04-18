# @klaro/ml — Klaro ML sidecar

FastAPI service for KYC (OCR, face match, liveness) and credit scoring (3-layer hybrid).

## Run

```bash
# install uv: https://docs.astral.sh/uv/getting-started/installation/
uv sync                # core deps
uv sync --extra ml     # add scoring deps (PyOD, scikit-learn)
uv sync --extra kyc    # add KYC deps (PaddleOCR, MediaPipe, facenet) — heavy
uv run uvicorn klaro_ml.main:app --reload --port 8000
```

## Endpoints

- `GET  /health`
- `POST /score`           — 3-layer scoring
- `POST /ocr/extract`     — KYC document OCR
- `POST /kyc/liveness`    — liveness check
- `POST /kyc/face-match`  — face embedding match

## Layout

```
src/klaro_ml/
  main.py            FastAPI app
  settings.py        env config
  routes/            HTTP routes
  scoring/           Layer 1 (rules), Layer 2 (anomaly), Layer 3 (LLM), composer
  kyc/               OCR / face / liveness wrappers (heavy deps lazy-loaded)
```
