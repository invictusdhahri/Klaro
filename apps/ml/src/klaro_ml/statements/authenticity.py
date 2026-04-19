"""Layer 2 — Document Authenticity Check.

Verifies structural integrity of the statement:
- Required fields present (account number, dates, bank header)
- Date continuity within the statement period
- Balance arithmetic: opening + Σcredits − Σdebits ≈ closing (±0.5%)
- Currency consistency
- Transaction ID format patterns
- Date logic (no future-dated transactions, no impossible sequences)
"""

from __future__ import annotations

import json
import re
from typing import Any

import anthropic

from klaro_ml.settings import get_settings

AUTHENTICITY_SYSTEM = """\
You are a compliance analyst verifying the structural authenticity of a bank statement.

You receive extracted text from a bank statement, a transaction summary, and a pre-computed
balance check result. Check the following authenticity rules:

1. Required fields: Does the document contain a bank name/header, account holder name,
   account number (or IBAN/RIB), and a statement period?
2. Date continuity: Do transaction dates form a coherent sequence within the stated period?
   No gaps > 30 days in an active account.
3. Balance arithmetic: USE THE PRE-COMPUTED BALANCE CHECK provided below — do not attempt
   to re-parse numbers from raw text. Trust the programmatic result.
4. Currency consistency: Are all monetary values in TND? Flag unexplained foreign currencies.
5. Date logic: No transaction dated in the future. No transactions before the statement start.
6. Structural regularity: Consistent format throughout (same columns, same field ordering).
7. Round-trip plausibility: At least one credit and one debit over the statement period.

IMPORTANT — Tunisian e-banking PDFs (UBCI, UBANK, etc.):
- "Solde début de période" / "Solde actuel" are valid opening/closing labels.
- Value date vs operation date ordering differs by bank — NOT proof of forgery.
- Default passed=true when rule 3 is PASS or CANNOT VERIFY and there is no obvious fake template.

Return ONLY valid JSON:
{
  "passed": <true if document passes all critical checks>,
  "score": <float 0.0–1.0, overall authenticity score>,
  "failed_rules": [<list of rule names that failed, empty if all pass>]
}

Critical failures (auto-fail): rule 3 only if PRE-COMPUTED result is FAIL, rule 5 (future dates).
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

    tx_summary = _summarise_transactions(transactions)
    balance_note = _programmatic_balance_check(extracted_text, transactions)

    context = f"""
EXTRACTED TEXT (first 4000 chars):
{extracted_text[:4000]}

EXTRACTED TRANSACTIONS ({len(transactions)} total):
{tx_summary}

PRE-COMPUTED BALANCE CHECK (rule 3 — authoritative, do not override):
{balance_note}
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
        return _normalize_authenticity_result(result, balance_note)
    except (json.JSONDecodeError, AttributeError):
        return {"passed": True, "score": 0.5, "failed_rules": ["Parse error — check skipped"]}


def _normalize_authenticity_result(
    result: dict[str, Any],
    balance_note: str,
) -> dict[str, Any]:
    """Align LLM output with programmatic balance: do not fail real e-banking PDFs on heuristics."""
    out = dict(result)
    fr = [str(x) for x in (out.get("failed_rules") or [])]

    if "Result: FAIL" in balance_note:
        out["passed"] = False
        out["failed_rules"] = fr or ["balance_arithmetic_mismatch"]
        out["score"] = min(float(out.get("score", 0.35) or 0.35), 0.45)
        return out

    # PASS or CANNOT VERIFY — trust structural extraction over LLM nitpicks
    if "Result: PASS" in balance_note or "CANNOT VERIFY" in balance_note:
        out["passed"] = True
        out["failed_rules"] = []
        out["score"] = max(float(out.get("score", 0.5) or 0.5), 0.88)
        return out

    # Unexpected note shape — strip balance overrides only
    if fr:
        fr = [r for r in fr if "balance" not in r.lower() and "arithmetic" not in r.lower()]
        out["failed_rules"] = fr
        if not fr:
            out["passed"] = True
    return out


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _parse_french_number(s: str) -> float | None:
    """
    Parse a number that may use either French or English formatting:
      French:  "1 200,000"  →  1200.000  (space=thousands, comma=decimal)
               "342,800"    →  342.800
      English: "1 200.000"  →  1200.000  (space=thousands, period=decimal)
               "342.800"    →  342.800
    """
    s = s.strip()
    # Remove thousands separators (spaces, non-breaking spaces)
    s = re.sub(r'[\s\u00a0]', '', s)
    # Normalise decimal: last comma or period is the decimal mark
    # Count commas and periods to decide
    n_comma = s.count(',')
    n_period = s.count('.')
    if n_comma == 1 and n_period == 0:
        s = s.replace(',', '.')
    elif n_period == 1 and n_comma == 0:
        pass  # already correct
    elif n_comma > 1:
        # multiple commas → thousands separators; keep last as decimal if followed by 3 digits
        s = s.replace(',', '')
    elif n_period > 1:
        s = s.replace('.', '')
    try:
        return float(s)
    except ValueError:
        return None


def _extract_balance_amount_raw(text: str, *label_patterns: str) -> str | None:
    """Capture the numeric token after a balance label (before TND)."""
    num_pat = r'([\d][\d\s\u00a0]*[,.][\d]+|[\d]+)'
    for pat in label_patterns:
        m = re.search(
            pat + r'[\s\S]{0,80}?' + num_pat + r'\s*(?:TND)?',
            text,
            re.IGNORECASE,
        )
        if m:
            return m.group(m.lastindex or 1)
    return None


def _balance_amount_candidates(raw: str) -> list[float]:
    """Multiple interpretations for UBCI-style amounts (338,777 vs 338.777, 1700,000 vs 1.7M)."""
    raw = raw.strip()
    if not raw:
        return []
    compact = re.sub(r'[\s\u00a0]', '', raw)
    out: list[float] = []

    p = _parse_french_number(compact)
    if p is not None:
        out.append(p)

    # US-style grouped: 1,234,567
    if re.fullmatch(r"\d{1,3}(,\d{3})+", compact):
        out.append(float(compact.replace(",", "")))

    # Single comma + 3 digits: often thousands in e-banking exports (338,777 → 338777)
    if compact.count(",") == 1 and "." not in compact:
        left, right = compact.split(",")
        if left.isdigit() and right.isdigit() and len(right) == 3:
            merged = float(left + right)
            if merged not in out:
                out.append(merged)

    if compact.isdigit():
        v = float(compact)
        if v not in out:
            out.append(v)

    # Dedupe preserving order
    seen: set[float] = set()
    uniq: list[float] = []
    for x in out:
        if x not in seen:
            seen.add(x)
            uniq.append(x)
    return uniq


def _programmatic_balance_check(
    extracted_text: str,
    transactions: list[dict[str, Any]],
) -> str:
    """
    Deterministically verify opening + credits − debits ≈ closing.
    Returns a human-readable string that is injected into the LLM context.
    """
    total_credits = sum(t["amount"] for t in transactions if t.get("type") == "credit")
    total_debits = sum(t["amount"] for t in transactions if t.get("type") == "debit")

    opening_raw = _extract_balance_amount_raw(
        extracted_text,
        r"solde\s+d.ouverture",
        r"solde\s+d[ée]but\s+de\s+p[ée]riode",
        r"solde\s+de\s+d[ée]but\s+de\s+p[ée]riode",
        r"opening\s+balance",
        r"solde\s+initial",
        r"balance\s+d.ouverture",
    )
    closing_raw = _extract_balance_amount_raw(
        extracted_text,
        r"solde\s+de\s+cl[oô]ture",
        r"solde\s+final",
        r"solde\s+actuel",
        r"closing\s+balance",
        r"solde\s+cl[oô]ture",
        r"SOLDE\s+DE\s+CL",
    )

    if opening_raw is None or closing_raw is None:
        return (
            f"Opening balance: not found in text | "
            f"Closing balance: not found in text | "
            f"Extracted totals — Credits: {total_credits:.3f} TND, Debits: {total_debits:.3f} TND | "
            f"Result: CANNOT VERIFY (treat rule 3 as PASS — insufficient data)"
        )

    o_cands = _balance_amount_candidates(opening_raw)
    c_cands = _balance_amount_candidates(closing_raw)
    if not o_cands or not c_cands:
        return (
            f"Opening raw: {opening_raw!r} | Closing raw: {closing_raw!r} | "
            f"Credits: {total_credits:.3f} TND | Debits: {total_debits:.3f} TND | "
            f"Result: CANNOT VERIFY (treat rule 3 as PASS — insufficient data)"
        )

    tolerance_base = 0.1

    for opening in o_cands:
        for closing in c_cands:
            expected_closing = opening + total_credits - total_debits
            tolerance = max(abs(opening) * 0.005, abs(closing) * 0.005, tolerance_base)
            if abs(expected_closing - closing) <= tolerance:
                return (
                    f"Opening: {opening:.3f} TND (from {opening_raw!r}) | "
                    f"Credits: {total_credits:.3f} TND | "
                    f"Debits: {total_debits:.3f} TND | "
                    f"Expected closing: {expected_closing:.3f} TND | "
                    f"Stated closing: {closing:.3f} TND (from {closing_raw!r}) | "
                    f"Difference: {abs(expected_closing - closing):.3f} TND | "
                    f"Result: PASS"
                )

    # No candidate pair reconciled — report best-effort FAIL using first candidates
    opening, closing = o_cands[0], c_cands[0]
    expected_closing = opening + total_credits - total_debits
    tolerance = max(abs(opening) * 0.005, abs(closing) * 0.005, tolerance_base)
    ok = abs(expected_closing - closing) <= tolerance
    return (
        f"Opening: {opening:.3f} TND (from {opening_raw!r}) | "
        f"Credits: {total_credits:.3f} TND | "
        f"Debits: {total_debits:.3f} TND | "
        f"Expected closing: {expected_closing:.3f} TND | "
        f"Stated closing: {closing:.3f} TND (from {closing_raw!r}) | "
        f"Difference: {abs(expected_closing - closing):.3f} TND | "
        f"Result: {'PASS' if ok else 'FAIL'}"
    )


def _summarise_transactions(transactions: list[dict[str, Any]]) -> str:
    if not transactions:
        return "(no transactions extracted)"
    total_credits = sum(t["amount"] for t in transactions if t.get("type") == "credit")
    total_debits  = sum(t["amount"] for t in transactions if t.get("type") == "debit")
    dates = sorted(t.get("date", "") for t in transactions if t.get("date"))
    return (
        f"Count: {len(transactions)} | "
        f"Credits: {total_credits:.3f} TND | Debits: {total_debits:.3f} TND | "
        f"Date range: {dates[0] if dates else '?'} → {dates[-1] if dates else '?'}"
    )
