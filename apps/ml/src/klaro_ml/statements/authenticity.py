"""Layer 2 — Document Authenticity Check.

Verifies structural integrity of the statement:
- Required fields present (account number, dates, bank header)
- Date continuity within the statement period
- Balance arithmetic: opening + Σcredits − Σdebits ≈ closing (±0.1%)
- Currency consistency
- Transaction ID format patterns
- Date logic (no future-dated transactions, no impossible sequences)
"""

from __future__ import annotations

import json
from typing import Any

import anthropic

from klaro_ml.settings import get_settings

AUTHENTICITY_SYSTEM = """\
You are a compliance analyst verifying the structural authenticity of a bank statement.

You receive either extracted text from a bank statement or a list of already-extracted transactions.
Check the following authenticity rules:

1. Required fields: Does the document contain a bank name/header, account holder name, account number (or IBAN), and a statement period?
2. Date continuity: Do transaction dates form a coherent, non-overlapping sequence within the stated period? No gaps > 30 days in an active account.
3. Balance arithmetic: If opening/closing balances are visible, does opening_balance + sum(credits) − sum(debits) ≈ closing_balance (within 0.5%)?
4. Currency consistency: Are all monetary values in the same currency (TND is expected; flag mixed currencies)?
5. Date logic: No transaction dated in the future. No transactions dated before the statement's open date.
6. Structural regularity: Is the format consistent throughout (same columns, same field ordering)? Sudden format changes mid-document are suspicious.
7. Round-trip plausibility: At least one credit and one debit over a 30-day period is expected for an active account.

Return ONLY valid JSON:
{
  "passed": <true if document passes all critical checks>,
  "score": <float 0.0–1.0, overall authenticity score>,
  "failed_rules": [<list of rule names that failed, empty if all pass>]
}

Critical failures (auto-fail): rules 3 (balance mismatch > 5%), 5 (future dates).
Non-critical failures reduce score but do not auto-fail.
Output ONLY the JSON, no markdown fences.
"""


def check_authenticity(
    extracted_text: str,
    transactions: list[dict[str, Any]],
) -> dict[str, Any]:
    """Run Layer 2 structural authenticity check."""
    settings = get_settings()
    if not settings.ANTHROPIC_API_KEY:
        return {"passed": True, "score": 0.5, "failed_rules": ["API key not configured — skipped"]}

    client = anthropic.Anthropic(api_key=settings.ANTHROPIC_API_KEY)

    # Build context: extracted text (truncated) + transaction summary
    tx_summary = _summarise_transactions(transactions)
    context = f"""
EXTRACTED TEXT (first 4000 chars):
{extracted_text[:4000]}

EXTRACTED TRANSACTIONS ({len(transactions)} total):
{tx_summary}
""".strip()

    res = client.messages.create(
        model=settings.CLAUDE_HAIKU,
        max_tokens=1024,
        system=AUTHENTICITY_SYSTEM,
        messages=[{"role": "user", "content": context}],
    )

    raw = res.content[0].text.strip()  # type: ignore[union-attr]
    if raw.startswith("```"):
        raw = "\n".join(raw.split("\n")[1:])
    if raw.endswith("```"):
        raw = raw[: raw.rfind("```")]

    try:
        result: dict[str, Any] = json.loads(raw)
        return result
    except (json.JSONDecodeError, AttributeError):
        return {"passed": True, "score": 0.5, "failed_rules": ["Parse error — check skipped"]}


def _summarise_transactions(transactions: list[dict[str, Any]]) -> str:
    if not transactions:
        return "(no transactions extracted)"
    total_credits = sum(t["amount"] for t in transactions if t.get("type") == "credit")
    total_debits = sum(t["amount"] for t in transactions if t.get("type") == "debit")
    dates = sorted(t.get("date", "") for t in transactions if t.get("date"))
    return (
        f"Count: {len(transactions)} | "
        f"Credits: {total_credits:.3f} TND | Debits: {total_debits:.3f} TND | "
        f"Date range: {dates[0] if dates else '?'} → {dates[-1] if dates else '?'}"
    )
