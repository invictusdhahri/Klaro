"""Layer-1 rule engine.

Combines forensic signals from all sources (`pdf_structure`, `image_forensics`,
`vision_ensemble`) into a single deterministic Layer-1 result with a
`risk_score` and a list of typed signals. The score is a pure function of the
inputs — no LLM may override it.

Output schema (the "passed" field is consumed by the orchestrator gate):

    {
      "passed": bool,
      "score": float,             # 0.0 (clean) - 1.0 (clearly fake)
      "confidence": float,        # 0.0 - 1.0, how strong the evidence is
      "signals": [<typed signal dicts>],
      "reasoning": str,           # human-readable summary
    }
"""

from __future__ import annotations

from typing import Any

# Severity weights — additive into a 0-1 risk score.
SEVERITY_WEIGHTS: dict[str, float] = {
    "low": 0.04,
    "medium": 0.10,
    "high": 0.22,
    "critical": 0.55,
}

# Source weighting: deterministic forensic signals are weighted slightly higher
# than vision-LLM signals because they cannot hallucinate.
SOURCE_MULTIPLIERS: dict[str, float] = {
    "pdf_structure": 1.10,
    "image_forensics": 1.00,
    "vision_ensemble": 0.55,
}

# Signal types that force-fail the layer regardless of score.
HARD_FAIL_TYPES: frozenset[str] = frozenset({
    "pdf_suspicious_producer",   # only when severity=critical (handled below)
    "pdf_empty",
})

# Hard-fail score gate — anything above this is rejected even without a
# critical-severity flag.
HARD_FAIL_SCORE = 0.78

# Minimum score that flips the layer to a soft fail (used by the reasoner to
# route to needs_review rather than instant rejection).
SOFT_FAIL_SCORE = 0.52


def combine(
    pdf_signals: list[dict[str, Any]],
    image_signals: list[dict[str, Any]],
    vision_result: dict[str, Any],
) -> dict[str, Any]:
    """Fuse signals from every source into the Layer-1 result."""
    all_signals: list[dict[str, Any]] = []
    all_signals.extend(pdf_signals)
    all_signals.extend(image_signals)
    all_signals.extend(vision_result.get("signals", []))

    # Compute weighted risk
    risk = 0.0
    for sig in all_signals:
        sev_weight = SEVERITY_WEIGHTS.get(str(sig.get("severity", "low")).lower(), 0.04)
        src_mult = SOURCE_MULTIPLIERS.get(str(sig.get("source", "")), 1.0)
        risk += sev_weight * src_mult

    risk = min(1.0, risk)

    # Critical override: a critical-severity signal from a deterministic source
    # always force-fails Layer-1 (e.g. producer = ChatGPT).
    has_critical = any(
        str(s.get("severity")) == "critical" and s.get("source") in ("pdf_structure", "image_forensics")
        for s in all_signals
    )

    # Hard fail by type
    has_hard_fail_type = any(
        s.get("type") in HARD_FAIL_TYPES
        and (s.get("type") != "pdf_suspicious_producer" or s.get("severity") == "critical")
        for s in all_signals
    )

    if has_critical or has_hard_fail_type:
        passed = False
    else:
        passed = risk < HARD_FAIL_SCORE

    confidence = _confidence(all_signals, vision_result)
    reasoning = _build_reasoning(all_signals, risk, vision_result, passed)

    return {
        "passed": passed,
        "score": round(1.0 - risk, 3),         # back to 0=fake, 1=genuine for layer
        "risk_score": round(risk, 3),          # explicit risk for the reasoner
        "confidence": round(confidence, 3),
        "signals": all_signals,
        "reasoning": reasoning,
        "vision_pages_analysed": vision_result.get("pages_analysed", 0),
        "vision_available": vision_result.get("available", False),
        "soft_fail": (not passed) or risk >= SOFT_FAIL_SCORE,
    }


def _confidence(
    signals: list[dict[str, Any]],
    vision_result: dict[str, Any],
) -> float:
    """How strong is the evidence (in either direction)?"""
    base = 0.5
    # More signals = more evidence — converges on 0.95 around 8 signals
    base += min(0.4, 0.05 * len(signals))
    # Vision pages analysed boost
    base += min(0.1, 0.02 * int(vision_result.get("pages_analysed", 0)))
    # Heavy penalty when both forensic sources and vision are silent
    has_forensic = any(s.get("source") in ("pdf_structure", "image_forensics") for s in signals)
    if not has_forensic and not vision_result.get("available"):
        base = max(0.3, base - 0.2)
    return min(0.99, base)


def _build_reasoning(
    signals: list[dict[str, Any]],
    risk: float,
    vision_result: dict[str, Any],
    passed: bool,
) -> str:
    if not signals:
        return (
            "No forensic anomalies detected across PDF structure, pixel-level analysis "
            "and vision ensemble."
        )

    by_source: dict[str, int] = {}
    for s in signals:
        src = str(s.get("source", "unknown"))
        by_source[src] = by_source.get(src, 0) + 1

    parts = [
        f"Composite forensic risk score {risk:.2f} (threshold {HARD_FAIL_SCORE:.2f}).",
        "Signals: " + ", ".join(
            f"{n} from {src.replace('_', ' ')}" for src, n in by_source.items()
        ) + ".",
    ]

    crit = [s for s in signals if str(s.get("severity")) == "critical"]
    if crit:
        crit_types = sorted({str(s.get("type")) for s in crit})
        parts.append(
            "Critical signal(s) overrode the score: " + ", ".join(crit_types) + "."
        )

    if vision_result.get("available"):
        parts.append(
            f"Vision ensemble inspected {vision_result.get('pages_analysed', 0)} page(s)."
        )
    else:
        parts.append("Vision ensemble unavailable (no API key or render failure).")

    parts.append("Verdict: " + ("PASS" if passed else "FAIL"))
    return " ".join(parts)
