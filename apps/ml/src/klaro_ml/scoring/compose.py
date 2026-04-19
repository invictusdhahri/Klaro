"""Final score composition — blend Layer 1 + Layer 2 + Layer 3."""

from __future__ import annotations

from typing import Any

from klaro_ml.scoring.anomaly_detector import detect_anomalies
from klaro_ml.scoring.impact_estimator import apply_impact_guardrails
from klaro_ml.scoring.llm_scorer import llm_score
from klaro_ml.scoring.rule_scorecard import compute_rule_score

MODEL_VERSION = "klaro-score-0.2.0"


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


def compose_score(user_data: dict[str, Any]) -> dict[str, Any]:
    """Blend the three scoring layers into a final 0–1000 score.

    Weights: 35% rule layer + 65% LLM layer − 150-point anomaly penalty.
    Actions are post-processed by the impact estimator for defensible +X pts values.
    """
    rule = compute_rule_score(user_data)
    anomaly = detect_anomalies(user_data)
    llm = llm_score(user_data)

    rule_score = float(rule["weighted"]) * 1000
    llm_value = float(llm["score"])
    anomaly_penalty = 150.0 if anomaly["flagged"] else 0.0

    final = (rule_score * 0.35) + (llm_value * 0.65) - anomaly_penalty
    final_int = int(max(0, min(1000, round(final))))

    # LLM five-pillar breakdown (what the UI bars show)
    llm_breakdown: dict[str, Any] = llm.get("breakdown") or {}

    # Guardrailed actions
    raw_actions: list[dict[str, Any]] = llm.get("actions") or []
    actions = apply_impact_guardrails(raw_actions, final_int, llm_breakdown)

    # Actions stored inside breakdown jsonb (key: "actions") — zero-migration approach
    full_breakdown: dict[str, Any] = {
        **llm_breakdown,
        "rule_subscores": rule["sub_scores"],
        "rule_layer": round(rule_score),
        "llm_layer": round(llm_value),
        "anomaly_penalty": anomaly_penalty,
        "actions": actions,
    }

    return {
        "score": final_int,
        "band": _band(final_int),
        "risk_category": llm.get("risk_category", "medium"),
        "confidence": float(llm.get("confidence", 0.5)),
        "breakdown": full_breakdown,
        "flags": list({*anomaly.get("top_signals", []), *llm.get("anomaly_flags", [])}),
        "explanation": llm.get("explanation", ""),
        "coaching_tips": llm.get("coaching_tips", []),
        "actions": actions,
        "model_version": MODEL_VERSION,
    }
