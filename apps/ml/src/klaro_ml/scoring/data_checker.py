"""Data sufficiency gate — rejects scoring requests that lack enough real financial data."""

from __future__ import annotations

from datetime import date
from typing import Any


MINIMUM_REQUIREMENTS: dict[str, Any] = {
    "min_transactions": 20,
    "min_history_days": 60,
    "min_income_credits": 2,
    "requires_bank_connection": True,
}


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
    gaps: list[str] = []
    txs: list[dict[str, Any]] = user_data.get("transactions") or []
    bank_connections: list[dict[str, Any]] = user_data.get("bank_connections") or []

    # Requirement 1: minimum transaction count
    has_enough_txs = len(txs) >= MINIMUM_REQUIREMENTS["min_transactions"]
    if not has_enough_txs:
        gaps.append(
            f"Need at least {MINIMUM_REQUIREMENTS['min_transactions']} transactions "
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
        if days_of_history < MINIMUM_REQUIREMENTS["min_history_days"]:
            gaps.append(
                f"Need at least {MINIMUM_REQUIREMENTS['min_history_days']} days of history "
                f"(have {days_of_history})"
            )
    else:
        gaps.append(
            "No transaction history found — connect a bank account or upload bank statements"
        )

    # Requirement 3: at least 2 income (credit) entries
    credits = [t for t in txs if t.get("transaction_type") == "credit"]
    has_income = len(credits) >= MINIMUM_REQUIREMENTS["min_income_credits"]
    if not has_income:
        gaps.append(
            f"Need at least {MINIMUM_REQUIREMENTS['min_income_credits']} income entries "
            f"to evaluate income stability (have {len(credits)})"
        )

    # Requirement 4: at least one bank connection OR processed bank statement
    bank_statements: list[dict[str, Any]] = user_data.get("bank_statements") or []
    has_connection = bool(bank_connections) or bool(bank_statements)
    if not has_connection:
        gaps.append(
            "No bank connection found — connect a bank account (Attijari, BIAT, STB, BNA) "
            "or upload bank statements"
        )

    met = sum([
        has_enough_txs,
        days_of_history >= MINIMUM_REQUIREMENTS["min_history_days"],
        has_income,
        has_connection,
    ])
    sufficiency = met / 4.0

    if gaps:
        raise InsufficientDataError(data_gaps=gaps, sufficiency=sufficiency)

    return sufficiency
