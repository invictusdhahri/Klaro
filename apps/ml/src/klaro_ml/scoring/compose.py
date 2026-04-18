"""Final score composition — blend Layer 1 + Layer 2 + Layer 3."""

from __future__ import annotations

from typing import Any

from klaro_ml.scoring.anomaly_detector import detect_anomalies
from klaro_ml.scoring.llm_scorer import llm_score
from klaro_ml.scoring.rule_scorecard import compute_rule_score

MODEL_VERSION = "klaro-score-0.1.0"


def _band(score: int) -> str:
    if score >= 850:
        return "EXCELLENT"
    if score >= 750:
        return "VERY_GOOD"
    if score >= 600:
        return "GOOD"
    if score >= 400:
        return "FAIR"
    return "POOR"


def compose_score(features: dict[str, Any]) -> dict[str, Any]:
    rule = compute_rule_score(features)
    anomaly = detect_anomalies(features)
    llm = llm_score(features)

    rule_score = float(rule["weighted"]) * 1000
    llm_value = float(llm["score"])
    anomaly_penalty = 150.0 if anomaly["flagged"] else 0.0

    final = (rule_score * 0.35) + (llm_value * 0.65) - anomaly_penalty
    final_int = int(max(0, min(1000, round(final))))

    return {
        "score": final_int,
        "band": _band(final_int),
        "breakdown": {
            "rule_layer": round(rule_score),
            "llm_layer": round(llm_value),
            "anomaly_penalty": anomaly_penalty,
            **{f"sub_{k}": v for k, v in rule["sub_scores"].items()},
            **llm.get("breakdown", {}),
        },
        "flags": list({*anomaly.get("top_signals", []), *llm.get("anomaly_flags", [])}),
        "recommendations": llm.get("coaching_tips", []),
        "confidence": float(llm.get("confidence", 0.5)),
        "model_version": MODEL_VERSION,
    }
