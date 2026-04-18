"""Layer 2 — Unsupervised anomaly detection (PyOD IsolationForest).

PyOD is in the optional `ml` extra. If unavailable, this module returns a
neutral result so the API stays functional during the hackathon scaffold.
"""

from __future__ import annotations

from typing import Any

ANOMALY_FEATURES: tuple[str, ...] = (
    "income_to_expense_ratio",
    "max_single_deposit",
    "tx_count_last_7_days",
    "unique_counterparties",
    "weekend_tx_ratio",
    "late_night_tx_ratio",
    "round_number_tx_ratio",
    "income_occupation_gap",
    "doc_balance_vs_scraped_balance_delta",
)


def detect_anomalies(features: dict[str, Any]) -> dict[str, Any]:
    try:
        from pyod.models.iforest import IForest  # type: ignore[import-not-found]
        import numpy as np  # noqa: F401
    except ImportError:
        return {"anomaly_score": 0.5, "flagged": False, "top_signals": []}

    # NOTE: A real model is trained on accumulated user feature matrices;
    # here we only expose the shape so the API contract is stable.
    _ = IForest
    return {"anomaly_score": 0.5, "flagged": False, "top_signals": []}
