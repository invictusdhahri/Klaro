"""Post-process LLM-generated actions to produce defensible score-impact estimates.

Guarantees:
  - Each action's expected_impact_points is clamped to [5, 150].
  - The sum of all impacts is capped at the user's remaining headroom (1000 - score).
  - If the LLM returns no impact for an action, a category-based default is
    derived, scaled by how much room that breakdown pillar has to improve.
"""

from __future__ import annotations

from typing import Any

# Category defaults (points) when LLM provides no estimate
_CATEGORY_DEFAULTS: dict[str, int] = {
    "income": 60,
    "payments": 35,
    "debt": 50,
    "documents": 25,
    "behavior": 20,
}

# Which LLM breakdown key maps to each action category
_CATEGORY_TO_BREAKDOWN: dict[str, str] = {
    "income": "income_stability",
    "payments": "payment_behavior",
    "debt": "debt_signals",
    "documents": "document_consistency",
    "behavior": "behavioral_patterns",
}

_MIN_IMPACT = 5
_MAX_IMPACT = 150


def apply_impact_guardrails(
    actions: list[dict[str, Any]],
    current_score: int,
    llm_breakdown: dict[str, Any] | None = None,
) -> list[dict[str, Any]]:
    """Return a new list of actions with clamped, headroom-aware impact points.

    Args:
        actions: raw action dicts from the LLM (may lack or have inflated impact).
        current_score: the blended final score (0-1000).
        llm_breakdown: the LLM breakdown dict (keys: income_stability, …) used
            to scale defaults when the LLM omitted an impact estimate.
    """
    headroom = max(0, 1000 - current_score)
    if headroom == 0 or not actions:
        return actions

    breakdown = llm_breakdown or {}
    processed: list[dict[str, Any]] = []

    for action in actions:
        raw_impact = action.get("expected_impact_points")
        category = (action.get("category") or "behavior").lower()

        if raw_impact is None or not isinstance(raw_impact, (int, float)):
            raw_impact = _default_impact(category, breakdown)

        clamped = int(max(_MIN_IMPACT, min(_MAX_IMPACT, round(float(raw_impact)))))
        processed.append({**action, "expected_impact_points": clamped})

    # Scale down proportionally if total exceeds headroom
    total = sum(a["expected_impact_points"] for a in processed)
    if total > headroom and total > 0:
        scale = headroom / total
        processed = [
            {
                **a,
                "expected_impact_points": max(_MIN_IMPACT, int(round(a["expected_impact_points"] * scale))),
            }
            for a in processed
        ]

    # Re-sort by impact desc
    processed.sort(key=lambda a: a["expected_impact_points"], reverse=True)
    return processed


def _default_impact(category: str, breakdown: dict[str, Any]) -> int:
    """Compute a default impact scaled by remaining room in the matching pillar.

    A pillar at 0.3 (70% room) gets a larger default than one at 0.9 (10% room).
    """
    base = _CATEGORY_DEFAULTS.get(category, 20)
    breakdown_key = _CATEGORY_TO_BREAKDOWN.get(category)
    if breakdown_key:
        pillar_score = breakdown.get(breakdown_key)
        if pillar_score is not None:
            room = 1.0 - float(pillar_score)  # 0 = maxed out, 1 = worst
            # Scale base by room, keep in [5, base] range
            base = max(_MIN_IMPACT, int(round(base * room)))
    return base
