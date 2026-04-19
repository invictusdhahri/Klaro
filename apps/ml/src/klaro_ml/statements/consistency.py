"""Layer 3 — Cross-Consistency Check with optional web search.

Uses Claude Haiku with tool-use so the model can call `web_search` when it needs
to verify things it cannot determine from the data alone:
  - Employer/company existence
  - Salary benchmarks by occupation + country
  - Bank licensing (BCT)
  - Known counterparty risk
  - Exchange rate sanity

Web search is backed by the Tavily API (optional). If TAVILY_API_KEY is not set,
web search calls are silently skipped and Claude continues without that data.
"""

from __future__ import annotations

import json
from typing import Any

import anthropic
import httpx

from klaro_ml.settings import get_settings

CONSISTENCY_SYSTEM = """\
You are a financial compliance analyst cross-checking a bank statement against the user's declared profile.

Your goal: compute a coherence_score (0.0–1.0) and list any flags that indicate incoherence or fraud risk.

You have access to the `web_search` tool. Use it when you need to verify:
- Whether an employer or company the user mentions actually exists in Tunisia or North Africa
- Typical salary ranges for the user's occupation in Tunisia
- Whether a bank name is BCT-licensed
- Known fraudulent counterparty names
- Exchange rates for foreign-currency transactions

Flag types (use exactly these strings):
  name_mismatch              - statement account holder ≠ profile full_name
  income_occupation_gap      - monthly income implausible for declared occupation
  balance_inconsistency      - arithmetic does not reconcile
  round_number_structuring   - >40% of transactions are round multiples of 500 TND
  sudden_income_spike        - single month > 3× prior average
  duplicate_period           - overlaps a prior uploaded statement
  currency_mismatch          - unexplained non-TND transactions
  document_integrity         - visual manipulation signals passed from Layer 1
  kyc_address_mismatch       - merchant locations inconsistent with declared governorate
  employer_not_found         - web search could not verify employer existence
  salary_benchmark_exceeded  - income far exceeds regional salary benchmark
  bank_not_licensed          - bank name not found in BCT registry

Severity levels: low | medium | high | critical

Return ONLY valid JSON (no markdown fences):
{
  "passed": <true if coherence_score >= 0.5 AND no critical flags>,
  "coherence_score": <float 0.0–1.0>,
  "flags": [
    {
      "type": "<flag type>",
      "severity": "<severity>",
      "detail": "<human-readable, English or French>",
      "evidence": { "statement_value": "...", "profile_value": "..." }
    }
  ],
  "web_checks": [
    { "query": "<search query used>", "finding": "<summary of result>", "passed": <bool> }
  ]
}
"""

TOOLS: list[dict[str, Any]] = [
    {
        "name": "web_search",
        "description": (
            "Search the web for current information. Use for verifying employer existence, "
            "salary benchmarks, bank licensing, and counterparty risk."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "The search query string",
                }
            },
            "required": ["query"],
        },
    }
]


def check_consistency(
    transactions: list[dict[str, Any]],
    user_context: dict[str, Any],
    layer1_signals: list[str],
) -> dict[str, Any]:
    """Run Layer 3 cross-consistency check with optional web search."""
    settings = get_settings()
    if not settings.ANTHROPIC_API_KEY:
        return {
            "passed": True,
            "coherence_score": 0.5,
            "flags": [],
            "web_checks": [],
        }

    client = anthropic.Anthropic(api_key=settings.ANTHROPIC_API_KEY)

    user_message = _build_context_message(transactions, user_context, layer1_signals)

    messages: list[dict[str, Any]] = [{"role": "user", "content": user_message}]

    web_checks: list[dict[str, Any]] = []

    # Agentic loop: Claude may call web_search multiple times
    for _ in range(5):  # max 5 tool calls
        res = client.messages.create(
            model=settings.CLAUDE_HAIKU,
            max_tokens=2048,
            system=CONSISTENCY_SYSTEM,
            tools=TOOLS,  # type: ignore[arg-type]
            messages=messages,
        )

        if res.stop_reason == "tool_use":
            # Process tool calls
            tool_results = []
            for block in res.content:
                if block.type == "tool_use" and block.name == "web_search":
                    query: str = block.input.get("query", "")  # type: ignore[union-attr]
                    search_result = _web_search(query, settings.TAVILY_API_KEY)
                    web_checks.append({
                        "query": query,
                        "finding": search_result[:500],
                        "passed": "not found" not in search_result.lower()
                               and "error" not in search_result.lower(),
                    })
                    tool_results.append({
                        "type": "tool_result",
                        "tool_use_id": block.id,
                        "content": search_result,
                    })

            messages.append({"role": "assistant", "content": res.content})
            messages.append({"role": "user", "content": tool_results})

        else:
            # Final answer
            final_text = ""
            for block in res.content:
                if hasattr(block, "text"):
                    final_text = block.text
                    break

            result = _parse_result(final_text)
            result["web_checks"] = web_checks
            return result

    # If we exhaust the loop, return a neutral result
    return {
        "passed": True,
        "coherence_score": 0.5,
        "flags": [],
        "web_checks": web_checks,
    }


def _web_search(query: str, api_key: str | None) -> str:
    """Call Tavily Search API. Gracefully degrades if key not set."""
    if not api_key:
        return f"[web search skipped — no TAVILY_API_KEY] query: {query}"

    try:
        resp = httpx.post(
            "https://api.tavily.com/search",
            json={
                "api_key": api_key,
                "query": query,
                "search_depth": "basic",
                "max_results": 3,
            },
            timeout=10.0,
        )
        if resp.status_code == 200:
            data = resp.json()
            results = data.get("results", [])
            snippets = [f"- {r.get('title', '')}: {r.get('content', '')[:200]}" for r in results]
            return "\n".join(snippets) if snippets else "No results found."
        return f"Search API error: HTTP {resp.status_code}"
    except Exception as exc:
        return f"Search unavailable: {exc}"


def _build_context_message(
    transactions: list[dict[str, Any]],
    user_context: dict[str, Any],
    layer1_signals: list[str],
) -> str:
    tx_count = len(transactions)
    credits = [t for t in transactions if t.get("type") == "credit"]
    debits = [t for t in transactions if t.get("type") == "debit"]
    monthly_income = sum(t["amount"] for t in credits)
    dates = sorted(t.get("date", "") for t in transactions if t.get("date"))

    prior_statements = user_context.get("priorStatements", [])
    prior_text = (
        ", ".join(s["fileName"] for s in prior_statements)
        if prior_statements
        else "none"
    )

    return f"""
USER PROFILE:
  Full name: {user_context.get('fullName', 'unknown')}
  Occupation: {user_context.get('occupationCategory', 'unknown')}
  KYC status: {user_context.get('kycStatus', 'unknown')}
  Governorate: {user_context.get('locationGovernorate', 'unknown')}
  KYC documents: {json.dumps(user_context.get('kycDocuments', []))}
  Prior uploads: {prior_text}

STATEMENT SUMMARY:
  Total transactions: {tx_count}
  Date range: {dates[0] if dates else '?'} → {dates[-1] if dates else '?'}
  Total credits: {sum(t['amount'] for t in credits):.3f} TND ({len(credits)} transactions)
  Total debits:  {sum(t['amount'] for t in debits):.3f} TND ({len(debits)} transactions)
  Implied monthly income: {monthly_income:.3f} TND

LAYER 1 DEEPFAKE SIGNALS (if any):
  {', '.join(layer1_signals) if layer1_signals else 'none'}

SAMPLE TRANSACTIONS (first 20):
{json.dumps(transactions[:20], ensure_ascii=False, indent=2)}

Please cross-check the statement against the profile, use web_search as needed, and return your JSON assessment.
""".strip()


def _parse_result(raw: str) -> dict[str, Any]:
    cleaned = raw.strip()
    if cleaned.startswith("```"):
        cleaned = "\n".join(cleaned.split("\n")[1:])
    if cleaned.endswith("```"):
        cleaned = cleaned[: cleaned.rfind("```")]
    try:
        result: dict[str, Any] = json.loads(cleaned)
        # Enforce: any critical flag → fail
        critical = any(f.get("severity") == "critical" for f in result.get("flags", []))
        if critical:
            result["passed"] = False
        return result
    except (json.JSONDecodeError, AttributeError):
        return {
            "passed": True,
            "coherence_score": 0.5,
            "flags": [],
            "web_checks": [],
        }
