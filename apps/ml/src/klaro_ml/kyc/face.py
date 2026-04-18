"""MTCNN + AdaFace face match wrappers (lazy-loaded)."""

from __future__ import annotations


def embed(_image_bytes: bytes) -> list[float]:
    """Return a 512-dim face embedding. Stub — real impl uses AdaFace."""
    return [0.0] * 512


def cosine_similarity(a: list[float], b: list[float]) -> float:
    if len(a) != len(b) or not a:
        return 0.0
    dot = sum(x * y for x, y in zip(a, b, strict=True))
    na = sum(x * x for x in a) ** 0.5
    nb = sum(y * y for y in b) ** 0.5
    if na == 0 or nb == 0:
        return 0.0
    return dot / (na * nb)


def match(doc_image: bytes, selfie_image: bytes, threshold: float = 0.65) -> dict[str, float | bool]:
    sim = cosine_similarity(embed(doc_image), embed(selfie_image))
    return {"similarity": sim, "match": sim >= threshold, "threshold": threshold}
