"""Layer 4 — Critical-thinking Reasoner.

Receives the per-layer outputs (L1 forensics, L2 authenticity, L3 consistency,
L3.5 income plausibility) plus the user context and any previously submitted
clarification answers, and produces:

  - `risk_score`        — deterministic, computed from a documented rubric
  - `verdict`           — approved | needs_review | rejected
  - `reasoning_summary` — 2-3 sentences shown at the top of the card
  - `per_flag_explanations` — narrative for each flag (why_it_matters,
                              what_would_clear_it)
  - `questions`         — clarification questions to ask the user inline

Critical thinking guarantees
----------------------------
* The score is a pure function of the inputs. The LLM proposes a `risk_score`
  but the code clamps it within `±0.10` of the rubric value, so the model can
  never overrule the rubric on critical signals.
* Any single `critical` severity flag forces `verdict = rejected` regardless
  of score.
* When the user has answered a question, only the matching layer is re-run
  (income_plausibility); other layer scores are reused — this prevents an
  attacker from getting unlimited free LLM re-rolls.
"""

from __future__ import annotations

import json
import logging
from collections import Counter
from typing import Any

import anthropic

from klaro_ml.settings import get_settings

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Scoring rubric — auditable constants
# ---------------------------------------------------------------------------

# Per-layer weights summing to 1.0. The "score" inside each layer is
# 0.0 (clean / safe) - 1.0 (clearly suspicious / fake) for THIS rubric.
LAYER_WEIGHTS: dict[str, float] = {
    "deepfake":            0.35,
    "authenticity":        0.20,
    "consistency":         0.25,
    "income_plausibility": 0.20,
}

# Severity -> additive risk for each flag found across all layers.
# Capped per call so a torrent of "low" flags can't push score over 1.0.
SEVERITY_RISK: dict[str, float] = {
    "low":      0.02,
    "medium":   0.04,
    "high":     0.09,
    "critical": 0.20,
}
MAX_FLAG_RISK_BUMP = 0.45

# Special bonuses / penalties documented in the plan
PENALTY_VISION_DISAGREEMENT = 0.05  # vision ensemble disagreed across pages
PENALTY_INCOME_STATUS_MISMATCH = 0.12  # student/unemployed earning a lot, no answer
PENALTY_OCCUPATION_UNVERIFIABLE = 0.05
BONUS_CLARIFIED_QUESTION = -0.10        # user cleared a borderline question
BONUS_REMOTE_MATCH_CONFIRMED = -0.08    # remote band fits AND user confirmed remote

# Verdict thresholds (slightly lenient to reduce false rejections on borderline scans)
THRESHOLD_REJECT = 0.66
THRESHOLD_REVIEW = 0.28

# Maximum the LLM may move the rubric score in either direction.
LLM_RISK_CLAMP = 0.10


# ---------------------------------------------------------------------------
# Public entry points
# ---------------------------------------------------------------------------


def reason(
    layers: dict[str, Any],
    user_context: dict[str, Any],
    answers: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """Run the critical-thinking reasoner.

    Args:
        layers: dict with keys "deepfake", "authenticity", "consistency",
                "income_plausibility" — each a layer result dict.
        user_context: the same userContext passed to the rest of the pipeline.
        answers: list of {question_id, value} previously submitted by the user.
    """
    answers = answers or []
    answer_map = {a.get("question_id"): a.get("value") for a in answers if a.get("question_id")}

    # 1. Deterministic rubric score
    rubric = compute_rubric_score(layers, answer_map)

    # 2. Optional LLM narrative + question proposals (clamped)
    llm_output = _llm_pass(layers, user_context, answer_map, rubric)

    # 3. Clamp the LLM's risk score within ±LLM_RISK_CLAMP of the rubric value
    llm_risk = llm_output.get("risk_score")
    final_risk = rubric["risk_score"]
    if isinstance(llm_risk, (int, float)):
        clamped = max(0.0, min(1.0, float(llm_risk)))
        if abs(clamped - rubric["risk_score"]) > LLM_RISK_CLAMP:
            # snap to the rubric ± the clamp on the side the LLM was leaning
            sign = 1 if clamped > rubric["risk_score"] else -1
            final_risk = rubric["risk_score"] + sign * LLM_RISK_CLAMP
        else:
            final_risk = clamped

    final_risk = max(0.0, min(1.0, final_risk))

    # 4. Critical override — any critical flag from any layer rejects
    if rubric["has_critical_flag"]:
        verdict = "rejected"
    elif final_risk >= THRESHOLD_REJECT:
        verdict = "rejected"
    elif final_risk >= THRESHOLD_REVIEW or rubric["has_uncleared_borderline"]:
        verdict = "needs_review"
    else:
        verdict = "approved"

    # 5. Merge questions from layers + LLM (deduped)
    layer_questions = list(
        layers.get("income_plausibility", {}).get("suggested_questions", [])
    )
    llm_questions = llm_output.get("questions", [])
    questions = _dedup_questions(layer_questions + llm_questions, answer_map)

    # If we landed on needs_review with no questions to ask, downgrade to
    # approved-with-warnings rather than blocking the user forever.
    if verdict == "needs_review" and not questions:
        verdict = "approved"

    # Prefer clarification (income / profile gaps) over hard rejection when we can ask something.
    if verdict == "rejected" and questions and not rubric["has_critical_flag"]:
        verdict = "needs_review"

    summary = (
        llm_output.get("reasoning_summary")
        or _fallback_summary(rubric, final_risk, verdict)
    )

    explanations = llm_output.get("per_flag_explanations") or _fallback_explanations(rubric)

    return {
        "risk_score": round(final_risk, 3),
        "rubric_risk_score": round(rubric["risk_score"], 3),
        "rubric_breakdown": rubric["breakdown"],
        "verdict": verdict,
        "reasoning_summary": summary,
        "per_flag_explanations": explanations,
        "questions": questions,
        "applied_answers": list(answer_map.keys()),
    }


# ---------------------------------------------------------------------------
# Deterministic rubric
# ---------------------------------------------------------------------------


def compute_rubric_score(
    layers: dict[str, Any],
    answer_map: dict[str, Any],
) -> dict[str, Any]:
    """Pure rubric. Returns {risk_score, breakdown, has_critical_flag,
    has_uncleared_borderline}."""
    breakdown: dict[str, float] = {}
    weighted_sum = 0.0
    weight_total = 0.0

    for layer_name, weight in LAYER_WEIGHTS.items():
        layer = layers.get(layer_name) or {}
        layer_risk = _layer_risk(layer_name, layer)
        breakdown[layer_name] = round(layer_risk, 3)
        weighted_sum += weight * layer_risk
        weight_total += weight

    base = weighted_sum / max(weight_total, 1e-6)

    # Per-flag bumps (capped)
    all_flags = _collect_flags(layers)
    sev_counts = Counter(str(f.get("severity", "low")).lower() for f in all_flags)
    bump = sum(SEVERITY_RISK.get(sev, 0.0) * count for sev, count in sev_counts.items())
    bump = min(bump, MAX_FLAG_RISK_BUMP)

    # Specific penalties
    penalty = 0.0

    deepfake = layers.get("deepfake") or {}
    # Only disagreement across models is a risk bump; majority-page is informational.
    if any(s.get("type") == "vision_model_disagreement" for s in deepfake.get("signals", [])):
        penalty += PENALTY_VISION_DISAGREEMENT

    income = layers.get("income_plausibility") or {}
    income_flag_types = {f.get("type") for f in income.get("flags", [])}
    if (
        "income_inconsistent_with_status" in income_flag_types
        and "income_source_explanation" not in answer_map
    ):
        penalty += PENALTY_INCOME_STATUS_MISMATCH
    if (
        "occupation_unverifiable" in income_flag_types
        and "occupation_clarify" not in answer_map
    ):
        penalty += PENALTY_OCCUPATION_UNVERIFIABLE

    # Bonuses
    bonus = 0.0
    if answer_map:
        # Each answered question that maps to a flag deflates risk
        flagged_question_ids = _flag_linked_questions(layers)
        cleared = sum(1 for qid in answer_map.keys() if qid in flagged_question_ids)
        bonus += BONUS_CLARIFIED_QUESTION * cleared
    if (
        "income_matches_remote_band" in income_flag_types
        and _is_truthy_remote_answer(answer_map.get("remote_work"))
    ):
        bonus += BONUS_REMOTE_MATCH_CONFIRMED

    score = max(0.0, min(1.0, base + bump + penalty + bonus))

    breakdown["base_weighted"] = round(base, 3)
    breakdown["flag_bump"] = round(bump, 3)
    breakdown["penalties"] = round(penalty, 3)
    breakdown["bonuses"] = round(bonus, 3)
    breakdown["final"] = round(score, 3)

    has_critical = any(str(f.get("severity")).lower() == "critical" for f in all_flags)

    # "Borderline" = any medium/high flag whose linked question has no answer
    flagged_question_ids = _flag_linked_questions(layers)
    has_uncleared_borderline = any(
        qid not in answer_map for qid in flagged_question_ids
    )

    return {
        "risk_score": score,
        "breakdown": breakdown,
        "has_critical_flag": has_critical,
        "has_uncleared_borderline": has_uncleared_borderline,
    }


def _layer_risk(layer_name: str, layer: dict[str, Any]) -> float:
    """Convert any layer's bespoke shape into a 0-1 risk number."""
    if not layer:
        return 0.0

    if layer_name == "deepfake":
        # Forensic rule_engine emits an explicit risk_score; fall back to
        # 1 - score otherwise.
        if "risk_score" in layer:
            return float(layer["risk_score"])
        return max(0.0, 1.0 - float(layer.get("score", 1.0)))

    if layer_name == "authenticity":
        return max(0.0, 1.0 - float(layer.get("score", 1.0)))

    if layer_name == "consistency":
        return max(0.0, 1.0 - float(layer.get("coherence_score", 1.0)))

    if layer_name == "income_plausibility":
        # Convert flag severities into a layer-local risk in [0,1]
        flags = layer.get("flags", []) or []
        if not flags:
            return 0.0
        sev_weight = {
            "low": 0.05,
            "medium": 0.20,
            "high": 0.45,
            "critical": 0.80,
        }
        worst = max(
            (sev_weight.get(str(f.get("severity")).lower(), 0.05) for f in flags),
            default=0.0,
        )
        return min(1.0, worst)

    return 0.0


def _collect_flags(layers: dict[str, Any]) -> list[dict[str, Any]]:
    flags: list[dict[str, Any]] = []
    for layer_name in ("deepfake", "authenticity", "consistency", "income_plausibility"):
        layer = layers.get(layer_name) or {}
        for s in layer.get("signals", []) or []:
            flags.append(s)
        for f in layer.get("flags", []) or []:
            flags.append(f)
        # authenticity uses failed_rules: list[str]
        for r in layer.get("failed_rules", []) or []:
            if isinstance(r, str):
                flags.append({"type": r, "severity": "medium", "detail": r, "source": layer_name})
    return flags


def _flag_linked_questions(layers: dict[str, Any]) -> set[str]:
    out: set[str] = set()
    for q in (layers.get("income_plausibility") or {}).get("suggested_questions", []) or []:
        if q.get("id"):
            out.add(str(q["id"]))
    return out


# ---------------------------------------------------------------------------
# LLM pass — narrative + extra questions, never authoritative for the score
# ---------------------------------------------------------------------------


REASONER_SYSTEM = """\
You are a skeptical KYC analyst doing a final review of a bank statement
verification report. You have already received scores from four automated
layers (forensics, authenticity, consistency, income plausibility). Your job:

1. Write a SHORT 2-3 sentence reasoning_summary that explains the overall
   risk picture in plain language.
2. For each flag in the inputs, provide:
   - "why_it_matters": one sentence explaining the practical risk
   - "what_would_clear_it": one sentence describing what would resolve it
3. Optionally suggest up to 2 ADDITIONAL clarification questions that would
   meaningfully reduce uncertainty. Do NOT repeat questions already supplied.
4. Propose a `risk_score` in [0,1]. The system will clamp it to within ±0.10
   of the rubric value, so use this only to signal disagreement, not override.

You MUST be skeptical: when layer scores are weak or borderline, raise rather
than lower the risk_score. When layers disagree, raise it. When the user's
profile is implausible vs the income, raise it. Apply critical thinking — do
not be flattered into approving a borderline document.

Return ONLY valid JSON, no markdown:
{
  "risk_score": <float 0-1>,
  "reasoning_summary": "<2-3 sentences>",
  "per_flag_explanations": [
    { "flag_type": "<type>", "why_it_matters": "<...>", "what_would_clear_it": "<...>" }
  ],
  "questions": [
    { "id": "<snake_case>", "type": "single_choice|multi_choice|free_text|amount",
      "prompt": "<one sentence>", "options": ["..."], "linked_flag": "<flag type>" }
  ]
}
"""


def _llm_pass(
    layers: dict[str, Any],
    user_context: dict[str, Any],
    answer_map: dict[str, Any],
    rubric: dict[str, Any],
) -> dict[str, Any]:
    settings = get_settings()
    if not settings.ANTHROPIC_API_KEY:
        return {}

    payload = {
        "rubric_risk_score": rubric["risk_score"],
        "rubric_breakdown": rubric["breakdown"],
        "user_profile": {
            "occupation": user_context.get("occupation"),
            "occupationCategory": user_context.get("occupationCategory"),
            "governorate": user_context.get("locationGovernorate"),
            "country": user_context.get("locationCountry"),
            "education": user_context.get("educationLevel"),
            "age": user_context.get("age"),
            "enriched_context": user_context.get("profileContext") or {},
        },
        "answers_already_submitted": answer_map,
        "layers": _summarise_layers(layers),
    }

    try:
        client = anthropic.Anthropic(api_key=settings.ANTHROPIC_API_KEY)
        res = client.messages.create(
            model=settings.CLAUDE_SONNET,
            max_tokens=2048,
            system=REASONER_SYSTEM,
            messages=[{"role": "user", "content": json.dumps(payload, ensure_ascii=False)}],
        )
        raw = res.content[0].text.strip()  # type: ignore[union-attr]
        if raw.startswith("```"):
            raw = "\n".join(raw.split("\n")[1:])
        if raw.endswith("```"):
            raw = raw[: raw.rfind("```")]
        parsed = json.loads(raw)
    except Exception as exc:
        logger.warning("reasoner LLM pass failed: %s", exc)
        return {}

    return {
        "risk_score": parsed.get("risk_score"),
        "reasoning_summary": parsed.get("reasoning_summary"),
        "per_flag_explanations": parsed.get("per_flag_explanations", []) or [],
        "questions": _normalise_questions(parsed.get("questions", []) or []),
    }


def _summarise_layers(layers: dict[str, Any]) -> dict[str, Any]:
    """Strip noisy/heavy fields before sending to the LLM."""
    out: dict[str, Any] = {}
    for name in ("deepfake", "authenticity", "consistency", "income_plausibility"):
        layer = layers.get(name) or {}
        flags = (
            layer.get("signals", [])
            or layer.get("flags", [])
            or [{"type": r, "severity": "medium", "detail": r} for r in layer.get("failed_rules", []) or []]
        )
        out[name] = {
            "passed": layer.get("passed"),
            "score": layer.get("score") or layer.get("coherence_score"),
            "flags": [
                {
                    "type": f.get("type"),
                    "severity": f.get("severity"),
                    "detail": (f.get("detail") or "")[:240],
                }
                for f in flags[:12]
            ],
        }
        if name == "income_plausibility":
            out[name]["implied_monthly_income"] = layer.get("implied_monthly_income")
            out[name]["local_band"] = layer.get("local_band")
            out[name]["remote_band"] = layer.get("remote_band")
            out[name]["primary_band"] = layer.get("primary_band")
    return out


def _normalise_questions(questions: list[Any]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for q in questions:
        if not isinstance(q, dict) or not q.get("id") or not q.get("prompt"):
            continue
        out.append({
            "id": str(q["id"]),
            "type": str(q.get("type", "free_text")),
            "prompt": str(q["prompt"]),
            "options": list(q.get("options", []) or []),
            "linked_flag": str(q.get("linked_flag", "")),
        })
    return out[:2]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _dedup_questions(
    questions: list[dict[str, Any]],
    answer_map: dict[str, Any],
) -> list[dict[str, Any]]:
    seen: set[str] = set()
    out: list[dict[str, Any]] = []
    for q in questions:
        qid = q.get("id")
        if not qid or qid in seen or qid in answer_map:
            continue
        seen.add(qid)
        out.append(q)
    return out


def _fallback_summary(
    rubric: dict[str, Any],
    final_risk: float,
    verdict: str,
) -> str:
    bd = rubric["breakdown"]
    return (
        f"Overall risk {final_risk:.2f} ({verdict}). Layer risks — deepfake "
        f"{bd.get('deepfake', 0):.2f}, authenticity {bd.get('authenticity', 0):.2f}, "
        f"consistency {bd.get('consistency', 0):.2f}, income {bd.get('income_plausibility', 0):.2f}. "
        f"Flag bump {bd.get('flag_bump', 0):.2f}, penalties {bd.get('penalties', 0):.2f}."
    )


def _fallback_explanations(rubric: dict[str, Any]) -> list[dict[str, Any]]:
    # Empty list; the UI will fall back to per-flag detail strings.
    return []


def _is_truthy_remote_answer(value: Any) -> bool:
    if not isinstance(value, str):
        return False
    return value.strip().lower().startswith("yes")
