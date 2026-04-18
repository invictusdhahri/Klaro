# syntax=docker/dockerfile:1.7
FROM python:3.11-slim AS base
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    UV_SYSTEM_PYTHON=1 \
    UV_LINK_MODE=copy
RUN apt-get update \
 && apt-get install -y --no-install-recommends build-essential libgl1 libglib2.0-0 \
 && rm -rf /var/lib/apt/lists/*
COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /usr/local/bin/

FROM base AS builder
WORKDIR /app
COPY apps/ml/pyproject.toml apps/ml/uv.lock* ./
# Install full extras for production image (KYC + ML).
RUN uv sync --frozen --no-dev --extra ml --extra kyc || uv sync --no-dev --extra ml --extra kyc

FROM base AS runner
WORKDIR /app
COPY --from=builder /app/.venv /app/.venv
ENV PATH="/app/.venv/bin:$PATH"
COPY apps/ml/src ./src
ENV PYTHONPATH=/app/src
EXPOSE 8000
USER nobody
CMD ["uvicorn", "klaro_ml.main:app", "--host", "0.0.0.0", "--port", "8000"]
