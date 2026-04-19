"""Layer 3 — Claude Sonnet prompt-based scoring for Klaro.

Builds a three-section ScoringContext from raw user data (via context_builder),
sends it to Claude Sonnet, and parses the JSON response. The model now returns
a structured `actions` array in addition to score/breakdown.

Includes retry logic with regex fallback extraction for malformed responses.
Falls back to a stub when ANTHROPIC_API_KEY is unset.
"""

from __future__ import annotations

import json
import re
from typing import Any

from klaro_ml.scoring.context_builder import build_scoring_context
from klaro_ml.settings import get_settings

SYSTEM_PROMPT = """\
You are a credit risk analyst for Klaro, an alternative credit scoring platform in Tunisia.
You receive a structured ScoringContext with three sections:
  - quantitative: ~20 financial variables extracted from bank data
  - qualitative: user goals/concerns/situation from chat memories + profile context
  - forensics: KYC document authenticity scores + bank statement verification results

You have NO access to credit bureau data.

Your job:
1. Score the user 0-1000 based on the data provided.
2. Identify anomaly risk flags revealed by the data.
3. Explain the score in plain language (Arabic or French, max 3 sentences).
4. Produce 3-5 specific, personalized improvement actions the user can take.

Rules for actions:
- Each action MUST reference at least one specific number or fact from the context.
  BAD: "Save more money."
  GOOD: "Your savings rate is currently -8%, meaning you spend more than you earn — reducing your top 3 expense categories by 15% would shift this positive."
- actions must be ordered from highest to lowest expected_impact_points.
- expected_impact_points must be a realistic delta (integer, 5-150). Do not inflate.
- category must be exactly one of: income | payments | debt | documents | behavior
- id must be a stable snake_case string key (no spaces, lowercase).
- impact_confidence is your confidence that taking this action will achieve the stated impact (float 0-1).

Output ONLY valid JSON — no markdown, no commentary:
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
  "explanation": "<plain language, max 3 sentences, Arabic or French>",
  "actions": [
    {
      "id": "<snake_case_key>",
      "title": "<short imperative title, max 8 words>",
      "rationale": "<1 sentence grounded in user's specific data>",
      "category": "income" | "payments" | "debt" | "documents" | "behavior",
      "expected_impact_points": <int 5-150>,
      "impact_confidence": <float 0-1>
    }
  ]
}
"""


def llm_score(user_data: dict[str, Any]) -> dict[str, Any]:
    settings = get_settings()
    if not settings.ANTHROPIC_API_KEY:
        return _stub_response()

    try:
        import anthropic  # type: ignore[import-not-found]
    except ImportError:
        return _stub_response()

    client = anthropic.Anthropic(api_key=settings.ANTHROPIC_API_KEY)
    context = build_scoring_context(user_data)
    payload = json.dumps(context, ensure_ascii=False, indent=2)

    for _attempt in range(2):
        try:
            res = client.messages.create(
                model=settings.CLAUDE_SONNET,
                max_tokens=1536,
                system=SYSTEM_PROMPT,
                messages=[{"role": "user", "content": payload}],
            )
            text: str = res.content[0].text  # type: ignore[union-attr]
        except Exception:
            return _stub_response()

        parsed = _parse_response(text)
        if parsed is not None:
            return _normalise(parsed)

    return _stub_response()


# ---------------------------------------------------------------------------
# Parsing + normalisation
# ---------------------------------------------------------------------------

def _parse_response(text: str) -> dict[str, Any] | None:
    """Try direct parse, then regex extraction of first JSON object."""
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass

    match = re.search(r"\{.*\}", text, re.DOTALL)
    if match:
        try:
            return json.loads(match.group())
        except json.JSONDecodeError:
            pass
    return None


def _normalise(raw: dict[str, Any]) -> dict[str, Any]:
    """Ensure backward-compat `coaching_tips` field from the new `actions` list."""
    actions = raw.get("actions") or []
    coaching_tips = [a.get("title", "") for a in actions if a.get("title")]

    return {
        **raw,
        "actions": actions,
        "coaching_tips": coaching_tips,
    }


# ---------------------------------------------------------------------------
# Stub fallback (no API key in dev)
# ---------------------------------------------------------------------------

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
        "explanation": "Score calculé avec le modèle de règles (clé API Anthropic non configurée).",
        "coaching_tips": [
            "Connect a bank account to enable full Klaro scoring.",
            "Complete your KYC verification.",
            "Set up automatic utility payments before the 5th of each month.",
        ],
        "actions": [
            {
                "id": "connect_bank",
                "title": "Connect a bank account",
                "rationale": "No live bank connection detected — connecting one enables the full scoring pipeline and typically adds 60+ points.",
                "category": "income",
                "expected_impact_points": 60,
                "impact_confidence": 0.8,
            },
            {
                "id": "complete_kyc",
                "title": "Complete KYC verification",
                "rationale": "Your KYC is not yet verified — document consistency is unscored, which caps your maximum achievable score.",
                "category": "documents",
                "expected_impact_points": 40,
                "impact_confidence": 0.9,
            },
            {
                "id": "early_utility_payments",
                "title": "Pay utilities before the 5th",
                "rationale": "Utility payments received after day 5 are treated as late — shifting all utility payments to the 1st-4th would raise your payment regularity score.",
                "category": "payments",
                "expected_impact_points": 25,
                "impact_confidence": 0.85,
            },
        ],
    }
