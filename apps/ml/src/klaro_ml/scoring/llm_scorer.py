"""Layer 3 — Claude Sonnet prompt-based scoring.

Sends the full feature vector to Claude Sonnet and parses a strict JSON
response. Falls back to a deterministic stub when ANTHROPIC_API_KEY is
unset (e.g. local dev without an API key).
"""

from __future__ import annotations

import json
from typing import Any

from klaro_ml.settings import get_settings

SYSTEM_PROMPT = """\
You are a credit risk analyst for an alternative credit scoring platform in Tunisia.
You receive structured financial data extracted from bank statements, KYC documents,
and behavioral signals. You have NO access to credit bureau data.

Your job:
1. Score the user 0-1000 based on the data provided.
2. Identify anomalies or risk flags the data reveals.
3. Explain the score in plain language (Arabic or French, max 3 sentences).
4. List 3 specific actions the user can take to improve their score.

Output ONLY valid JSON:
{
  "score": <int 0-1000>,
  "confidence": <float 0-1>,
  "risk_category": "low" | "medium" | "high" | "very_high",
  "breakdown": {
    "income_stability": <float 0-1>,
    "payment_behavior": <float 0-1>,
    "debt_signals": <float 0-1>,
    "document_consistency": <float 0-1>,
    "behavioral_patterns": <float 0-1>
  },
  "anomaly_flags": [<string>, ...],
  "explanation": "<plain language, max 3 sentences>",
  "coaching_tips": ["<tip 1>", "<tip 2>", "<tip 3>"]
}
"""


def llm_score(features: dict[str, Any]) -> dict[str, Any]:
    settings = get_settings()
    if not settings.ANTHROPIC_API_KEY:
        return _stub_response()

    try:
        import anthropic  # type: ignore[import-not-found]
    except ImportError:
        return _stub_response()

    client = anthropic.Anthropic(api_key=settings.ANTHROPIC_API_KEY)
    res = client.messages.create(
        model=settings.CLAUDE_SONNET,
        max_tokens=1024,
        system=SYSTEM_PROMPT,
        messages=[
            {"role": "user", "content": json.dumps(features, ensure_ascii=False, indent=2)}
        ],
    )
    text = res.content[0].text  # type: ignore[union-attr]
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        return _stub_response()


def _stub_response() -> dict[str, Any]:
    return {
        "score": 600,
        "confidence": 0.5,
        "risk_category": "medium",
        "breakdown": {
            "income_stability": 0.6,
            "payment_behavior": 0.6,
            "debt_signals": 0.6,
            "document_consistency": 0.6,
            "behavioral_patterns": 0.6,
        },
        "anomaly_flags": [],
        "explanation": "ML stub response — Anthropic key not configured.",
        "coaching_tips": [
            "Connect a bank account to enable real scoring.",
            "Complete KYC verification.",
            "Set up automatic utility payments.",
        ],
    }
