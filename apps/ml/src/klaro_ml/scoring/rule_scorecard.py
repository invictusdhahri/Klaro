"""Layer 1 — Rule-based scorecard.

Pure deterministic math over normalized features. No ML libraries. Outputs
sub-scores in [0, 1] and a weighted total in [0, 1].

Source: internal_docs/06_Updated_Architecture_TechStack.md
"""

from __future__ import annotations

from typing import Any

RULE_WEIGHTS: dict[str, float] = {
    "income_stability": 0.25,
    "payment_regularity": 0.20,
    "debt_ratio": 0.20,
    "balance_trend": 0.15,
    "account_age": 0.10,
    "income_diversity": 0.10,
}


def _clamp(x: float, lo: float = 0.0, hi: float = 1.0) -> float:
    return max(lo, min(hi, x))


def score_income_stability(features: dict[str, Any]) -> float:
    cv = features.get("income_cv")
    if cv is None:
        return 0.4
    return _clamp(1.0 - float(cv))


def score_payment_regularity(features: dict[str, Any]) -> float:
    rate = features.get("utility_payment_rate")
    if rate is None:
        return 0.5
    return _clamp(float(rate))


def score_debt_ratio(features: dict[str, Any]) -> float:
    ratio = features.get("debt_to_income_ratio")
    if ratio is None:
        return 0.5
    r = float(ratio)
    if r < 0.30:
        return 1.0
    if r < 0.45:
        return 0.6
    return 0.2


def score_balance_trend(features: dict[str, Any]) -> float:
    trend = features.get("balance_trend")
    return {"growing": 1.0, "stable": 0.7, "flat": 0.5, "declining": 0.2}.get(str(trend), 0.5)


def score_account_age(features: dict[str, Any]) -> float:
    months = features.get("account_age_months")
    if months is None:
        return 0.4
    return _clamp(float(months) / 24.0)


def score_income_diversity(features: dict[str, Any]) -> float:
    sources = features.get("income_sources_count")
    if sources is None:
        return 0.4
    return _clamp(float(sources) / 3.0)


_RULE_FUNCS = {
    "income_stability": score_income_stability,
    "payment_regularity": score_payment_regularity,
    "debt_ratio": score_debt_ratio,
    "balance_trend": score_balance_trend,
    "account_age": score_account_age,
    "income_diversity": score_income_diversity,
}


def compute_rule_score(features: dict[str, Any]) -> dict[str, Any]:
    sub_scores = {key: fn(features) for key, fn in _RULE_FUNCS.items()}
    weighted = sum(sub_scores[k] * RULE_WEIGHTS[k] for k in sub_scores)
    return {"sub_scores": sub_scores, "weighted": weighted}
