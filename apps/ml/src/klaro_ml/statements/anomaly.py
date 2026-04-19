"""Anomaly Detector — runs only after all 3 verification layers PASS.

Analyses transaction patterns for behavioral anomalies matching the existing
ANOMALY_FEATURES from klaro_ml/scoring/anomaly_detector.py, plus additional
document-specific checks.

Returns a structured anomaly report with an overall score and flagged signals.
"""

from __future__ import annotations

import json
from collections import Counter
from datetime import date
from typing import Any

import anthropic

from klaro_ml.settings import get_settings


LLM_ANOMALY_SYSTEM = """\
You are a financial crime analyst reviewing extracted bank statement transactions.
Identify behavioral anomalies and suspicious patterns.

Flag types (use exactly these strings):
  income_occupation_gap       - income implausible for stated occupation
  round_number_structuring    - > 40% of debits are round multiples of 500 TND (money structuring)
  sudden_income_spike         - a single month's credits exceed 3× the rolling 3-month average
  duplicate_period            - this statement period overlaps a prior upload
  weekend_tx_anomaly          - unusually high weekend transaction volume (> 60%)
  late_night_tx_anomaly       - > 30% of transactions after 22:00 (if timestamps available)
  low_counterparty_diversity  - fewer than 3 unique counterparties (possible fabrication)
  unusual_large_single_tx     - single transaction > 50% of monthly average income
  currency_mismatch           - unexplained foreign-currency transactions

Severity: low | medium | high | critical

Return ONLY valid JSON (no markdown fences):
{
  "anomaly_score": <float 0.0–1.0, 0=clean 1=highly anomalous>,
  "flagged": <true if anomaly_score >= 0.6 OR any critical/high severity signal>,
  "signals": [
    {
      "type": "<flag type>",
      "severity": "<severity>",
      "detail": "<human-readable explanation>",
      "evidence": { "value": <computed stat>, "threshold": <threshold used> }
    }
  ]
}
"""


def detect_anomalies(
    transactions: list[dict[str, Any]],
    user_context: dict[str, Any],
) -> dict[str, Any]:
    """Run anomaly detection on extracted transactions."""
    if not transactions:
        return {"anomaly_score": 0.0, "flagged": False, "signals": []}

    # Rule-based fast checks (no LLM needed)
    rule_signals = _rule_based_checks(transactions, user_context)

    settings = get_settings()
    if not settings.ANTHROPIC_API_KEY:
        score = min(1.0, len(rule_signals) * 0.2)
        flagged = any(s["severity"] in ("high", "critical") for s in rule_signals)
        return {"anomaly_score": score, "flagged": flagged, "signals": rule_signals}

    # LLM-based pattern recognition
    client = anthropic.Anthropic(api_key=settings.ANTHROPIC_API_KEY)
    llm_result = _llm_anomaly_check(client, transactions, user_context, rule_signals)

    # Merge rule signals with LLM signals (deduplicate by type)
    existing_types = {s["type"] for s in llm_result.get("signals", [])}
    for sig in rule_signals:
        if sig["type"] not in existing_types:
            llm_result.setdefault("signals", []).append(sig)

    # Recompute flagged status after merge
    all_signals = llm_result.get("signals", [])
    high_or_critical = any(s["severity"] in ("high", "critical") for s in all_signals)
    llm_result["flagged"] = high_or_critical or llm_result.get("anomaly_score", 0) >= 0.6

    return llm_result


# ---------------------------------------------------------------------------
# Rule-based checks (deterministic, fast)
# ---------------------------------------------------------------------------

def _rule_based_checks(
    transactions: list[dict[str, Any]],
    user_context: dict[str, Any],
) -> list[dict[str, Any]]:
    signals: list[dict[str, Any]] = []

    debits = [t for t in transactions if t.get("type") == "debit"]
    credits_ = [t for t in transactions if t.get("type") == "credit"]

    total_debits_count = len(debits)

    # Round-number structuring: > 40% of debits are multiples of 500
    if total_debits_count >= 5:
        round_count = sum(1 for t in debits if _is_round(t.get("amount", 0)))
        ratio = round_count / total_debits_count
        if ratio > 0.4:
            signals.append({
                "type": "round_number_structuring",
                "severity": "high",
                "detail": f"{ratio:.0%} of debit transactions are round multiples of 500 TND, suggesting possible structuring.",
                "evidence": {"value": ratio, "threshold": 0.4},
            })

    # Low counterparty diversity
    counterparties = {t.get("counterparty") or t.get("description", "") for t in transactions}
    counterparties.discard("")
    if len(transactions) >= 10 and len(counterparties) < 3:
        signals.append({
            "type": "low_counterparty_diversity",
            "severity": "medium",
            "detail": f"Only {len(counterparties)} unique counterparties across {len(transactions)} transactions.",
            "evidence": {"value": len(counterparties), "threshold": 3},
        })

    # Sudden income spike: compare months
    monthly = _monthly_credits(credits_)
    if len(monthly) >= 2:
        sorted_months = sorted(monthly.items())
        amounts = [v for _, v in sorted_months]
        rolling_avg = sum(amounts[:-1]) / max(len(amounts) - 1, 1)
        last_month = amounts[-1]
        if rolling_avg > 0 and last_month > 3 * rolling_avg:
            signals.append({
                "type": "sudden_income_spike",
                "severity": "high",
                "detail": (
                    f"Last period income ({last_month:.0f} TND) is "
                    f"{last_month / rolling_avg:.1f}× the prior average ({rolling_avg:.0f} TND)."
                ),
                "evidence": {"value": last_month / rolling_avg, "threshold": 3.0},
            })

    # Unusual large single transaction
    if credits_:
        monthly_avg = sum(t["amount"] for t in credits_) / max(len(monthly), 1)
        max_single = max(t["amount"] for t in transactions)
        if monthly_avg > 0 and max_single > 0.5 * monthly_avg:
            signals.append({
                "type": "unusual_large_single_tx",
                "severity": "medium",
                "detail": (
                    f"Largest single transaction ({max_single:.0f} TND) exceeds "
                    f"50% of monthly average income ({monthly_avg:.0f} TND)."
                ),
                "evidence": {"value": max_single / monthly_avg, "threshold": 0.5},
            })

    return signals


def _is_round(amount: float) -> bool:
    return amount > 0 and amount % 500 == 0


def _monthly_credits(credits_: list[dict[str, Any]]) -> dict[str, float]:
    monthly: Counter[str] = Counter()
    for t in credits_:
        raw_date = t.get("date", "")
        try:
            d = date.fromisoformat(raw_date)
            key = f"{d.year}-{d.month:02d}"
            monthly[key] += float(t.get("amount", 0))
        except (ValueError, TypeError):
            pass
    return dict(monthly)


# ---------------------------------------------------------------------------
# LLM-based anomaly check
# ---------------------------------------------------------------------------

def _llm_anomaly_check(
    client: anthropic.Anthropic,
    transactions: list[dict[str, Any]],
    user_context: dict[str, Any],
    rule_signals: list[dict[str, Any]],
) -> dict[str, Any]:
    settings = get_settings()

    context = f"""
OCCUPATION: {user_context.get('occupationCategory', 'unknown')}
PRIOR UPLOADS: {len(user_context.get('priorStatements', []))} statements already uploaded

RULE-BASED SIGNALS ALREADY FOUND:
{json.dumps(rule_signals, ensure_ascii=False)}

TRANSACTIONS ({len(transactions)} total, first 30 shown):
{json.dumps(transactions[:30], ensure_ascii=False, indent=2)}
""".strip()

    res = client.messages.create(
        model=settings.CLAUDE_HAIKU,
        max_tokens=1024,
        system=LLM_ANOMALY_SYSTEM,
        messages=[{"role": "user", "content": context}],
    )

    raw = res.content[0].text.strip()  # type: ignore[union-attr]
    if raw.startswith("```"):
        raw = "\n".join(raw.split("\n")[1:])
    if raw.endswith("```"):
        raw = raw[: raw.rfind("```")]

    try:
        return json.loads(raw)
    except (json.JSONDecodeError, AttributeError):
        return {"anomaly_score": 0.0, "flagged": False, "signals": []}
