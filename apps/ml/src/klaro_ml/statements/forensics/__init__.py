"""Forensic analysis bundle for Layer 1 (Deepfake / AI-generated document detection).

Each module is independent and returns a list of typed signals. The
`rule_engine.combine` function fuses signals from all sources into a single
Layer-1 result with deterministic scoring and human-readable reasoning.

Modules
-------
pdf_structure
    PDF metadata, fonts, content-stream and text-layer inspection (PyMuPDF,
    pdfminer.six). Catches AI-generated PDFs from ChatGPT/Claude/HTML-to-PDF
    converters whose producer/font/layer fingerprints are distinctive.

image_forensics
    Pixel-level checks: Error-Level Analysis (ELA), FFT spectrum noise floor,
    block-wise noise-variance inconsistency. Catches diffusion-generated and
    composited images that pass an LLM "looks like a bank statement" check.

vision_ensemble
    Multi-page Claude Vision cross-vote (Sonnet + Haiku). Reuses the existing
    forensic prompt across every page rather than the first page only, plus a
    dedicated "is this AI-generated?" prompt, then aggregates per-page votes.

rule_engine
    Combines all signal sources into a single weighted score with critical
    overrides (e.g. producer = "ChatGPT" force-fails regardless of model votes).
"""
