"""Data sufficiency gate — rejects scoring requests that lack enough real financial data."""

from __future__ import annotations

from datetime import date
from typing import Any

from klaro_ml.settings import get_settings

# Production: enforced credit-score bar (set ML_ENV=production).
PRODUCTION_REQUIREMENTS: dict[str, Any] = {
    "min_transactions": 20,
    "min_history_days": 60,
    "min_income_credits": 2,
    "require_bank_or_statement": True,
}

# Non-production: minimal gate so local/testing works with small extracts or seeds.
DEVELOPMENT_REQUIREMENTS: dict[str, Any] = {
    "min_transactions": 1,
    "min_history_days": 0,
    "min_income_credits": 0,
    "require_bank_or_statement": False,
}


def _minimum_requirements() -> dict[str, Any]:
    if get_settings().ML_ENV.lower() == "production":
        return PRODUCTION_REQUIREMENTS
    return DEVELOPMENT_REQUIREMENTS


class InsufficientDataError(Exception):
    def __init__(self, data_gaps: list[str], sufficiency: float) -> None:
        self.data_gaps = data_gaps
        self.sufficiency = sufficiency
        super().__init__(f"Insufficient data (sufficiency={sufficiency:.2f}): {data_gaps}")


def check_data_sufficiency(user_data: dict[str, Any]) -> float:
    """Validate that the user has enough real financial data to produce a meaningful score.

    Returns a sufficiency score 0–1 when all requirements are met.
    Raises InsufficientDataError listing every gap if any requirement fails.
    """
    req = _minimum_requirements()
    gaps: list[str] = []
    txs: list[dict[str, Any]] = user_data.get("transactions") or []
    bank_connections: list[dict[str, Any]] = user_data.get("bank_connections") or []

    # Requirement 1: minimum transaction count
    has_enough_txs = len(txs) >= req["min_transactions"]
    if not has_enough_txs:
        gaps.append(
            f"Need at least {req['min_transactions']} transactions "
            f"(have {len(txs)})"
        )

    # Requirement 2: minimum history span
    days_of_history = 0
    if txs:
        try:
            earliest_str = min(t["transaction_date"] for t in txs)
            days_of_history = (date.today() - date.fromisoformat(str(earliest_str))).days
        except (KeyError, ValueError):
            days_of_history = 0
        if days_of_history < req["min_history_days"]:
            gaps.append(
                f"Need at least {req['min_history_days']} days of history "
                f"(have {days_of_history})"
            )
    else:
        gaps.append(
            "No transaction history found — connect a bank account or upload bank statements"
        )

    # Requirement 3: income (credit) entries
    credits = [t for t in txs if t.get("transaction_type") == "credit"]
    has_income = len(credits) >= req["min_income_credits"]
    if not has_income:
        gaps.append(
            f"Need at least {req['min_income_credits']} income entries "
            f"to evaluate income stability (have {len(credits)})"
        )

    # Requirement 4: bank connection OR processed bank statement (optional in non-production)
    bank_statements: list[dict[str, Any]] = user_data.get("bank_statements") or []
    has_connection = bool(bank_connections) or bool(bank_statements)
    if req["require_bank_or_statement"] and not has_connection:
        gaps.append(
            "No bank connection found — connect a bank account (Attijari, BIAT, STB, BNA) "
            "or upload bank statements"
        )

    connection_ok = has_connection or not req["require_bank_or_statement"]
    met = sum([
        has_enough_txs,
        days_of_history >= req["min_history_days"],
        has_income,
        connection_ok,
    ])
    sufficiency = met / 4.0

    if gaps:
        raise InsufficientDataError(data_gaps=gaps, sufficiency=sufficiency)

    return sufficiency
