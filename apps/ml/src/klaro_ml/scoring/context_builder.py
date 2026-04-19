"""Build a structured ScoringContext from raw user_data.

Separates the data fed into the LLM into three sections:

  quantitative  — ~20 numeric financial variables (deterministic)
  qualitative   — distilled chat memories + profile_context enrichments
  forensics     — KYC document scores + latest statement reasoning

These sections are the sole input to llm_scorer._build_user_variables,
which now calls build_scoring_context() instead of computing inline.
"""

from __future__ import annotations

import statistics
from datetime import date
from typing import Any


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------

def build_scoring_context(user_data: dict[str, Any]) -> dict[str, Any]:
    """Return a ScoringContext dict ready for JSON serialisation into the LLM prompt."""
    return {
        "quantitative": _build_quantitative(user_data),
        "qualitative": _build_qualitative(user_data),
        "forensics": _build_forensics(user_data),
    }


# ---------------------------------------------------------------------------
# Quantitative section
# ---------------------------------------------------------------------------

def _build_quantitative(user_data: dict[str, Any]) -> dict[str, Any]:
    txs: list[dict[str, Any]] = user_data.get("transactions") or []
    profile: dict[str, Any] = user_data.get("profile") or {}
    bank_connections: list[dict[str, Any]] = user_data.get("bank_connections") or []

    credits = [t for t in txs if t.get("transaction_type") == "credit"]
    debits = [t for t in txs if t.get("transaction_type") == "debit"]

    monthly_income: dict[str, float] = {}
    for t in credits:
        key = _safe_date(t.get("transaction_date")).strftime("%Y-%m")
        monthly_income[key] = monthly_income.get(key, 0.0) + float(t.get("amount", 0))

    monthly_expense: dict[str, float] = {}
    for t in debits:
        key = _safe_date(t.get("transaction_date")).strftime("%Y-%m")
        monthly_expense[key] = monthly_expense.get(key, 0.0) + float(t.get("amount", 0))

    income_values = list(monthly_income.values())
    avg_monthly_income = statistics.mean(income_values) if income_values else 0.0
    income_cv = (
        statistics.stdev(income_values) / avg_monthly_income
        if len(income_values) >= 2 and avg_monthly_income > 0
        else None
    )

    expense_values = list(monthly_expense.values())
    avg_monthly_expense = statistics.mean(expense_values) if expense_values else 0.0

    utility_txs = [t for t in debits if _is_utility(t)]
    utility_payment_rate = (
        sum(1 for t in utility_txs if _safe_date(t.get("transaction_date")).day <= 5)
        / len(utility_txs)
        if utility_txs
        else None
    )

    debt_txs = [t for t in debits if _is_debt(t)]
    monthly_debt: dict[str, float] = {}
    for t in debt_txs:
        key = _safe_date(t.get("transaction_date")).strftime("%Y-%m")
        monthly_debt[key] = monthly_debt.get(key, 0.0) + float(t.get("amount", 0))
    avg_monthly_debt = statistics.mean(monthly_debt.values()) if monthly_debt else 0.0
    debt_to_income = (avg_monthly_debt / avg_monthly_income) if avg_monthly_income > 0 else None

    savings_rate = (
        (avg_monthly_income - avg_monthly_expense) / avg_monthly_income
        if avg_monthly_income > 0
        else None
    )

    account_age_months: float | None = None
    if bank_connections:
        today = date.today()
        dates = []
        for conn in bank_connections:
            try:
                dates.append(date.fromisoformat(str(conn.get("created_at", ""))[:10]))
            except ValueError:
                pass
        if dates:
            account_age_months = (today - min(dates)).days / 30.44

    counterparties = {
        (t.get("counterparty") or t.get("description") or "").strip().lower()
        for t in credits
        if (t.get("counterparty") or t.get("description") or "").strip()
    }
    income_sources_count = len(counterparties)

    return {
        "age": profile.get("age"),
        "occupation": profile.get("occupation"),
        "occupation_category": profile.get("occupation_category"),
        "kyc_status": profile.get("kyc_status"),
        "tx_count_total": len(txs),
        "avg_monthly_income_tnd": round(avg_monthly_income, 2),
        "avg_monthly_expense_tnd": round(avg_monthly_expense, 2),
        "income_cv": round(income_cv, 4) if income_cv is not None else None,
        "utility_payment_rate": round(utility_payment_rate, 4) if utility_payment_rate is not None else None,
        "debt_to_income_ratio": round(debt_to_income, 4) if debt_to_income is not None else None,
        "savings_rate": round(savings_rate, 4) if savings_rate is not None else None,
        "account_age_months": round(account_age_months, 1) if account_age_months is not None else None,
        "income_sources_count": income_sources_count,
        "kyc_verified": profile.get("kyc_status") == "verified",
        "bank_connection_count": len(bank_connections),
        "has_utility_payments": bool(utility_txs),
        "has_debt_payments": bool(debt_txs),
        "months_of_history": len(monthly_income),
    }


# ---------------------------------------------------------------------------
# Qualitative section
# ---------------------------------------------------------------------------

def _build_qualitative(user_data: dict[str, Any]) -> dict[str, Any]:
    """Distil chat memories and profile_context into a compact qualitative snapshot."""
    profile: dict[str, Any] = user_data.get("profile") or {}
    profile_context: dict[str, Any] = profile.get("profile_context") or {}
    user_memories: list[dict[str, Any]] = user_data.get("user_memories") or []
    chat_messages: list[dict[str, Any]] = user_data.get("chat_messages") or []

    # Group memories by category
    memories_by_category: dict[str, list[str]] = {}
    for mem in user_memories:
        cat = mem.get("category") or "fact"
        memories_by_category.setdefault(cat, []).append(mem.get("fact", ""))

    # Summarise the last N chat turns as role: content pairs (token-friendly)
    chat_turns = [
        {"role": m.get("role", "user"), "text": (m.get("content") or "")[:300]}
        for m in chat_messages[-20:]
    ]

    return {
        "memories": memories_by_category,
        "profile_context": profile_context,
        "recent_chat_turns": chat_turns,
        "declared_income_source": profile_context.get("income_source"),
        "confirmed_remote_work": profile_context.get("confirmed_remote_work"),
        "income_source_explanation": profile_context.get("income_source_explanation"),
    }


# ---------------------------------------------------------------------------
# Forensics section
# ---------------------------------------------------------------------------

def _build_forensics(user_data: dict[str, Any]) -> dict[str, Any]:
    """Extract KYC forensic scores and the latest statement reasoning summary."""
    kyc_docs: list[dict[str, Any]] = user_data.get("kyc_documents") or []
    bank_statements: list[dict[str, Any]] = user_data.get("bank_statements") or []

    # Best available KYC forensic scores (highest authenticity preferred)
    best_consistency: float | None = None
    best_authenticity: float | None = None
    best_deepfake: float | None = None

    for doc in sorted(kyc_docs, key=lambda d: d.get("created_at", ""), reverse=True):
        if best_consistency is None and doc.get("consistency_score") is not None:
            best_consistency = float(doc["consistency_score"])
        if best_authenticity is None and doc.get("authenticity_score") is not None:
            best_authenticity = float(doc["authenticity_score"])
        if best_deepfake is None and doc.get("deepfake_score") is not None:
            best_deepfake = float(doc["deepfake_score"])

    # Latest statement reasoning (first after order desc on created_at, done in fetch)
    latest_reasoning: dict[str, Any] = {}
    for stmt in bank_statements:
        raw = stmt.get("reasoning") or stmt.get("statement_reasoning")
        if raw and isinstance(raw, dict):
            latest_reasoning = raw
            break

    reasoning_summary: dict[str, Any] = {}
    if latest_reasoning:
        reasoning_summary = {
            "overall_risk": latest_reasoning.get("overall_risk"),
            "risk_score": latest_reasoning.get("risk_score"),
            "recommended_action": latest_reasoning.get("recommended_action"),
            "top_layer_scores": _top_layer_scores(latest_reasoning.get("layer_scores") or {}),
        }

    return {
        "kyc_consistency_score": best_consistency,
        "kyc_authenticity_score": best_authenticity,
        "kyc_deepfake_score": best_deepfake,
        "statement_reasoning": reasoning_summary if reasoning_summary else None,
        "processed_statement_count": len(bank_statements),
    }


def _top_layer_scores(layer_scores: dict[str, Any]) -> list[dict[str, Any]]:
    """Return the 3 highest-scoring layers sorted by score desc."""
    items = [
        {"layer": k, "score": v.get("score") if isinstance(v, dict) else v}
        for k, v in layer_scores.items()
        if v is not None
    ]
    items.sort(key=lambda x: x.get("score") or 0, reverse=True)
    return items[:3]


# ---------------------------------------------------------------------------
# Shared helpers (duplicated from llm_scorer to keep this module self-contained)
# ---------------------------------------------------------------------------

_UTILITY_KEYWORDS = (
    "steg", "sonede", "ooredoo", "tunisie telecom", "orange tunisie",
    "telecom", "eau", "electricite", "electricity", "gaz",
)

_DEBT_KEYWORDS = (
    "credit", "pret", "remboursement", "versement", "echéance",
    "echeance", "loan", "dette",
)


def _safe_date(raw: Any) -> date:
    try:
        return date.fromisoformat(str(raw)[:10])
    except (ValueError, TypeError):
        return date.today()


def _is_utility(tx: dict[str, Any]) -> bool:
    haystack = " ".join(
        filter(None, [tx.get("counterparty"), tx.get("description"), tx.get("category")])
    ).lower()
    return any(kw in haystack for kw in _UTILITY_KEYWORDS)


def _is_debt(tx: dict[str, Any]) -> bool:
    haystack = " ".join(
        filter(None, [tx.get("counterparty"), tx.get("description"), tx.get("category")])
    ).lower()
    return any(kw in haystack for kw in _DEBT_KEYWORDS)
