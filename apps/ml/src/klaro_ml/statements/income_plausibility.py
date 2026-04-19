"""Layer 3.5 — Income Plausibility.

Compares the implied monthly income from extracted transactions against
salary benchmarks for the user's declared occupation, in two regimes:

  * Local Tunisian band  — based on `occupationCategory` × governorate × education
  * Abroad / remote band — based on `occupationCategory` × education

The comparator is deterministic (no LLM in the scoring loop). A small Sonnet
"sanity pass" only proposes clarification questions; it cannot move the score.
This means an attacker cannot talk the model out of a bad number — they must
either provide a verifiable explanation that re-runs the rules in their favour
or accept the flag.

Output shape (added to `verification.layers.income_plausibility`):

    {
      "passed": bool,
      "implied_monthly_income": float,
      "local_band":  {p25, p50, p75, currency, source},
      "remote_band": {p25, p50, p75, currency, source},
      "gap_local_pct":  float,
      "gap_remote_pct": float,
      "primary_band":   "local" | "remote",   # which one the score used
      "flags":         [<typed flag dicts>],
      "suggested_questions": [<question dicts>],
      "reasoning":     str,
    }
"""

from __future__ import annotations

import json
import logging
from collections import Counter
from datetime import date
from typing import Any

import anthropic

from klaro_ml.data.salary_bands_tn import (
    DEFAULT_USD_TND_RATE,
    lookup_local_band,
    lookup_remote_band,
)
from klaro_ml.settings import get_settings
from klaro_ml.utils.web_search import web_search

logger = logging.getLogger(__name__)

# Common foreign-currency keywords seen in Tunisian bank statement descriptions
FOREIGN_CURRENCY_HINTS: tuple[str, ...] = (
    "usd", "eur", "gbp", "chf", "cad", "aed", "sar",
    "dollar", "euro", "swift", "wise", "payoneer", "stripe", "paypal",
    "upwork", "toptal", "fiverr", "freelancer.com", "deel", "remote.com",
    "google", "amazon", "microsoft", "meta", "apple",
)

QUESTION_REMOTE_WORK = {
    "id": "remote_work",
    "type": "single_choice",
    "prompt": "Are you working remotely or freelance for clients outside Tunisia?",
    "options": [
        "Yes, full-time remote employee",
        "Yes, freelance/contract for foreign clients",
        "Some side projects or occasional payments",
        "No, all my income is local",
    ],
    "linked_flag": "income_above_local_ceiling",
}

QUESTION_SECONDARY_INCOME = {
    "id": "secondary_income",
    "type": "free_text",
    "prompt": "Do you have other income sources (rental, family business, side hustle)? Please describe.",
    "options": [],
    "linked_flag": "income_above_local_ceiling",
}

QUESTION_INCONSISTENT_STATUS = {
    "id": "income_source_explanation",
    "type": "single_choice",
    "prompt": "Your declared occupation does not normally generate this level of income. What is the source?",
    "options": [
        "Family transfers / support",
        "Investment returns or dividends",
        "Inheritance or gift",
        "Sale of property or asset",
        "Side business not listed in profile",
        "Other (please update profile)",
    ],
    "linked_flag": "income_inconsistent_with_status",
}

QUESTION_INCOME_BELOW_FLOOR = {
    "id": "income_below_floor_reason",
    "type": "single_choice",
    "prompt": "Income on this statement is well below typical for your declared role. Why?",
    "options": [
        "Probation or first months on the job",
        "Part-time / reduced schedule",
        "On unpaid leave during this period",
        "Salary paid into a different account",
        "Other",
    ],
    "linked_flag": "income_below_floor",
}

QUESTION_OCCUPATION_UNVERIFIABLE = {
    "id": "occupation_clarify",
    "type": "free_text",
    "prompt": "We couldn't verify your declared occupation through public sources. Please add a short description of your role and employer (or your business if self-employed).",
    "options": [],
    "linked_flag": "occupation_unverifiable",
}


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------


def check_income_plausibility(
    transactions: list[dict[str, Any]],
    user_context: dict[str, Any],
    answers: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """Run Layer 3.5. Optional `answers` (from a prior reanalyze call) are used
    to widen tolerances when the user has confirmed e.g. remote work."""
    answers = answers or []
    answer_map = {a.get("question_id"): a.get("value") for a in answers if a.get("question_id")}

    aggregates = _transaction_aggregates(transactions)
    implied_income = aggregates["implied_monthly_income"]
    foreign_share = aggregates["foreign_currency_share"]

    occupation = (user_context.get("occupation") or "").strip()
    occupation_category = user_context.get("occupationCategory") or "salaried"
    governorate = user_context.get("locationGovernorate")
    education = user_context.get("educationLevel")

    # Pull live web bands (best-effort) and merge with the static fallback
    local_band, local_source = _build_band(
        live_band=_query_local_band(occupation, occupation_category, governorate),
        static_band=lookup_local_band(occupation_category, governorate, education),
    )
    remote_band, remote_source = _build_band(
        live_band=_query_remote_band(occupation, occupation_category),
        static_band=lookup_remote_band(occupation_category, education),
    )

    user_says_remote = _is_truthy_remote_answer(answer_map.get("remote_work"))
    primary_band_name = (
        "remote"
        if user_says_remote or foreign_share >= 0.30
        else "local"
    )
    primary = remote_band if primary_band_name == "remote" else local_band

    gap_local_pct = _gap(implied_income, local_band[1])
    gap_remote_pct = _gap(implied_income, remote_band[1])

    flags = _build_flags(
        implied_income=implied_income,
        local_band=local_band,
        remote_band=remote_band,
        primary_band=primary,
        primary_band_name=primary_band_name,
        occupation_category=occupation_category,
        occupation=occupation,
        foreign_share=foreign_share,
        aggregates=aggregates,
        answer_map=answer_map,
    )

    occupation_unverifiable = _occupation_is_unverifiable(occupation, occupation_category)
    if occupation_unverifiable and not answer_map.get("occupation_clarify"):
        flags.append({
            "type": "occupation_unverifiable",
            "severity": "medium",
            "detail": (
                "Declared occupation could not be verified against public sources. Without "
                "a verifiable role we cannot benchmark income confidently."
            ),
            "evidence": {"occupation": occupation, "category": occupation_category},
            "source": "income_plausibility",
        })

    suggested = _suggest_questions(flags, answer_map)

    # Sonnet sanity pass — proposes additional/replacement questions only.
    extra_questions = _llm_question_suggestions(
        transactions=transactions,
        user_context=user_context,
        flags=flags,
        local_band=local_band,
        remote_band=remote_band,
        implied_income=implied_income,
    )
    suggested = _merge_questions(suggested, extra_questions)

    passed = not any(f["severity"] in ("high", "critical") for f in flags)

    reasoning = _build_reasoning(
        implied_income=implied_income,
        local_band=local_band,
        remote_band=remote_band,
        primary_band_name=primary_band_name,
        flags=flags,
        passed=passed,
    )

    return {
        "passed": passed,
        "implied_monthly_income": round(implied_income, 3),
        "local_band": _band_dict(local_band, "TND", local_source),
        "remote_band": _band_dict(remote_band, "TND", remote_source),
        "gap_local_pct": round(gap_local_pct, 3),
        "gap_remote_pct": round(gap_remote_pct, 3),
        "primary_band": primary_band_name,
        "foreign_currency_share": round(foreign_share, 3),
        "flags": flags,
        "suggested_questions": suggested,
        "reasoning": reasoning,
        "applied_answers": list(answer_map.keys()),
    }


# ---------------------------------------------------------------------------
# Transaction aggregates
# ---------------------------------------------------------------------------


def _transaction_aggregates(transactions: list[dict[str, Any]]) -> dict[str, Any]:
    credits = [t for t in transactions if t.get("type") == "credit"]
    debits = [t for t in transactions if t.get("type") == "debit"]

    monthly: Counter[str] = Counter()
    for t in credits:
        try:
            d = date.fromisoformat(str(t.get("date", "")))
            monthly[f"{d.year}-{d.month:02d}"] += float(t.get("amount", 0))
        except (ValueError, TypeError):
            continue

    months = max(1, len(monthly))
    total_credits = sum(t.get("amount", 0) for t in credits)
    implied_monthly_income = total_credits / months

    # Foreign-currency / international counterparty share of credit volume
    foreign_amount = 0.0
    for t in credits:
        desc = (t.get("description") or "").lower()
        if any(hint in desc for hint in FOREIGN_CURRENCY_HINTS):
            foreign_amount += float(t.get("amount", 0))
    foreign_share = (foreign_amount / total_credits) if total_credits > 0 else 0.0

    counterparties = {
        (t.get("counterparty") or t.get("description") or "").strip()
        for t in transactions
    }
    counterparties.discard("")

    # Volatility = std/mean of monthly credits (large = freelance / spiky)
    if len(monthly) >= 2:
        amounts = list(monthly.values())
        mean = sum(amounts) / len(amounts)
        if mean > 0:
            variance = sum((a - mean) ** 2 for a in amounts) / len(amounts)
            volatility = (variance ** 0.5) / mean
        else:
            volatility = 0.0
    else:
        volatility = 0.0

    return {
        "implied_monthly_income": implied_monthly_income,
        "monthly_credits": dict(monthly),
        "months_covered": months,
        "credit_count": len(credits),
        "debit_count": len(debits),
        "total_credits": total_credits,
        "foreign_currency_share": foreign_share,
        "unique_counterparties": len(counterparties),
        "volatility": volatility,
    }


# ---------------------------------------------------------------------------
# Band assembly
# ---------------------------------------------------------------------------


def _build_band(
    live_band: tuple[float, float, float] | None,
    static_band: tuple[float, float, float],
) -> tuple[tuple[float, float, float], str]:
    """Merge a live web-derived band with the static fallback. Web wins when
    present, but never below the static p25 (acts as a hard floor)."""
    if not live_band:
        return static_band, "static"
    p25 = max(live_band[0], static_band[0])
    p50 = max(live_band[1], static_band[1])
    p75 = max(live_band[2], static_band[2])
    return (p25, p50, p75), "tavily+static"


def _query_local_band(
    occupation: str,
    occupation_category: str,
    governorate: str | None,
) -> tuple[float, float, float] | None:
    """Tavily query for local salary numbers. Returns None on any parse failure."""
    if not occupation:
        return None
    region = governorate or "Tunisia"
    query = (
        f"average monthly salary {occupation} {region} Tunisia 2026 TND net"
    )
    snippet = web_search(query, max_results=3)
    if snippet.startswith("[skipped]") or snippet.startswith("[error]") or snippet.startswith("[empty]"):
        return None
    return _parse_band_from_text(snippet, currency_hint="TND")


def _query_remote_band(
    occupation: str,
    occupation_category: str,
) -> tuple[float, float, float] | None:
    if not occupation:
        return None
    queries = [
        f"average monthly remote salary {occupation} 2026 USD",
        f"freelance {occupation} hourly rate 2026 USD",
    ]
    snippets: list[str] = []
    for q in queries:
        s = web_search(q, max_results=3)
        if not (s.startswith("[skipped]") or s.startswith("[error]") or s.startswith("[empty]")):
            snippets.append(s)
    if not snippets:
        return None
    band_usd = _parse_band_from_text("\n".join(snippets), currency_hint="USD")
    if not band_usd:
        return None
    rate = DEFAULT_USD_TND_RATE
    return (band_usd[0] * rate, band_usd[1] * rate, band_usd[2] * rate)


def _parse_band_from_text(
    text: str,
    currency_hint: str,
) -> tuple[float, float, float] | None:
    """Best-effort numeric extraction from a Tavily snippet.

    Looks for any "<number> <currency>" or "<number>/month" patterns and
    returns p25/p50/p75 of the numbers found. We deliberately do NOT use an
    LLM here; we want zero hallucination risk in the scoring path.
    """
    import re

    # Strip thousands separators (spaces, commas) where they sit between digits
    cleaned = re.sub(r"(?<=\d)[\s,](?=\d{3}\b)", "", text)

    pattern = (
        r"(\d{2,7}(?:\.\d+)?)"   # the number
        r"(?:\s*-\s*\d{2,7}(?:\.\d+)?)?"  # optional range upper bound (ignored)
        r"\s*(?:USD|usd|\$|EUR|eur|€|TND|tnd|DT|dt|dinar)"  # currency anchor
    )
    nums: list[float] = []
    for m in re.finditer(pattern, cleaned):
        try:
            v = float(m.group(1))
        except ValueError:
            continue
        # Filter clearly non-salary numbers (years, page counts, etc.)
        if currency_hint == "USD" and 200 <= v <= 50000:
            nums.append(v)
        elif currency_hint == "TND" and 200 <= v <= 100000:
            nums.append(v)

    if len(nums) < 2:
        return None

    nums.sort()
    n = len(nums)
    p25 = nums[max(0, n // 4 - 1)]
    p50 = nums[n // 2]
    p75 = nums[min(n - 1, (3 * n) // 4)]
    return (p25, p50, p75)


def _band_dict(
    band: tuple[float, float, float],
    currency: str,
    source: str,
) -> dict[str, Any]:
    return {
        "p25": round(band[0], 2),
        "p50": round(band[1], 2),
        "p75": round(band[2], 2),
        "currency": currency,
        "source": source,
    }


def _gap(actual: float, reference: float) -> float:
    if reference <= 0:
        return 0.0
    return (actual - reference) / reference


# ---------------------------------------------------------------------------
# Decision matrix
# ---------------------------------------------------------------------------


def _build_flags(
    implied_income: float,
    local_band: tuple[float, float, float],
    remote_band: tuple[float, float, float],
    primary_band: tuple[float, float, float],
    primary_band_name: str,
    occupation_category: str,
    occupation: str,
    foreign_share: float,
    aggregates: dict[str, Any],
    answer_map: dict[str, Any],
) -> list[dict[str, Any]]:
    flags: list[dict[str, Any]] = []

    cat = (occupation_category or "salaried").lower()
    local_p25, local_p50, local_p75 = local_band
    remote_p25, remote_p50, remote_p75 = remote_band

    # 1. Status mismatch — student / unemployed / retired with high income
    if cat in ("student", "unemployed", "retired") and implied_income > local_p50 * 1.5:
        # If the user already explained the source, downgrade to informational
        explanation = answer_map.get("income_source_explanation")
        if explanation and explanation != "Other (please update profile)":
            flags.append({
                "type": "income_source_clarified",
                "severity": "low",
                "detail": (
                    f"User clarified income source as '{explanation}'. Statement income "
                    f"({implied_income:.0f} TND/mo) is above the typical local band for "
                    f"{cat}, but the explanation is plausible."
                ),
                "evidence": {
                    "implied_monthly": round(implied_income, 2),
                    "local_p50": round(local_p50, 2),
                    "explanation": explanation,
                },
                "source": "income_plausibility",
            })
        else:
            flags.append({
                "type": "income_inconsistent_with_status",
                "severity": "high",
                "detail": (
                    f"User declared as '{cat}' but the statement implies "
                    f"{implied_income:.0f} TND/month, which is {(implied_income / max(local_p50, 1) - 1) * 100:.0f}% "
                    f"above the local median for that status ({local_p50:.0f} TND)."
                ),
                "evidence": {
                    "implied_monthly": round(implied_income, 2),
                    "local_p50": round(local_p50, 2),
                    "gap_pct": round(_gap(implied_income, local_p50), 3),
                    "category": cat,
                },
                "source": "income_plausibility",
            })

    # 2. Salaried below floor
    if cat == "salaried" and implied_income < local_p25 * 0.5 and implied_income > 0:
        flags.append({
            "type": "income_below_floor",
            "severity": "medium",
            "detail": (
                f"Implied income ({implied_income:.0f} TND/mo) is well below the local "
                f"p25 floor ({local_p25:.0f} TND) for salaried workers — possible "
                f"part-time, probation, or income paid elsewhere."
            ),
            "evidence": {
                "implied_monthly": round(implied_income, 2),
                "local_p25": round(local_p25, 2),
                "threshold_multiplier": 0.5,
            },
            "source": "income_plausibility",
        })

    # 3. Salaried above ceiling — only when it does NOT match the remote band
    #    OR when the user has explicitly said they are not remote.
    user_says_not_remote = answer_map.get("remote_work") == "No, all my income is local"
    matches_remote = remote_p25 <= implied_income <= remote_p75 * 1.5
    user_says_remote = _is_truthy_remote_answer(answer_map.get("remote_work"))
    if cat == "salaried" and implied_income > local_p75 * 2:
        if matches_remote and (foreign_share >= 0.20 or user_says_remote):
            # Lower the temperature — explained by remote work
            flags.append({
                "type": "income_matches_remote_band",
                "severity": "low",
                "detail": (
                    f"Income of {implied_income:.0f} TND/month is high for the local "
                    f"market but falls within the remote-work band "
                    f"({remote_p25:.0f}-{remote_p75:.0f} TND). Foreign-currency share: "
                    f"{foreign_share * 100:.0f}%."
                ),
                "evidence": {
                    "implied_monthly": round(implied_income, 2),
                    "remote_p25": round(remote_p25, 2),
                    "remote_p75": round(remote_p75, 2),
                    "foreign_share": round(foreign_share, 3),
                    "user_confirmed_remote": user_says_remote,
                },
                "source": "income_plausibility",
            })
        elif user_says_not_remote:
            flags.append({
                "type": "income_above_local_ceiling",
                "severity": "high",
                "detail": (
                    f"Income of {implied_income:.0f} TND/month is more than 2x the local "
                    f"p75 ({local_p75:.0f} TND) for salaried workers, and the user has "
                    f"explicitly confirmed no foreign/remote income source."
                ),
                "evidence": {
                    "implied_monthly": round(implied_income, 2),
                    "local_p75": round(local_p75, 2),
                    "remote_p25": round(remote_p25, 2),
                    "foreign_share": round(foreign_share, 3),
                },
                "source": "income_plausibility",
            })
        else:
            flags.append({
                "type": "income_above_local_ceiling",
                "severity": "medium",
                "detail": (
                    f"Income of {implied_income:.0f} TND/month exceeds 2x the local p75 "
                    f"({local_p75:.0f} TND). This may be remote/foreign income — please "
                    f"confirm."
                ),
                "evidence": {
                    "implied_monthly": round(implied_income, 2),
                    "local_p75": round(local_p75, 2),
                    "remote_band": [round(remote_p25, 2), round(remote_p75, 2)],
                    "foreign_share": round(foreign_share, 3),
                },
                "source": "income_plausibility",
            })

    # 4. Freelance / business owner volatility
    if cat in ("freelance", "business_owner") and aggregates["volatility"] > 1.5:
        flags.append({
            "type": "income_volatility",
            "severity": "low",
            "detail": (
                f"Monthly income volatility is {aggregates['volatility']:.2f} (std/mean) — "
                f"normal for freelance/business income but worth noting."
            ),
            "evidence": {
                "volatility": round(aggregates["volatility"], 2),
                "months_covered": aggregates["months_covered"],
            },
            "source": "income_plausibility",
        })

    # 5. Freelance/business with extremely high income vs even remote band
    if cat in ("freelance", "business_owner") and implied_income > remote_p75 * 1.5:
        flags.append({
            "type": "income_above_remote_band",
            "severity": "high",
            "detail": (
                f"Income of {implied_income:.0f} TND/month exceeds 1.5x the global remote "
                f"p75 ({remote_p75:.0f} TND) for this category. Requires verification."
            ),
            "evidence": {
                "implied_monthly": round(implied_income, 2),
                "remote_p75": round(remote_p75, 2),
            },
            "source": "income_plausibility",
        })

    return flags


# ---------------------------------------------------------------------------
# Question suggestions
# ---------------------------------------------------------------------------


def _suggest_questions(
    flags: list[dict[str, Any]],
    answer_map: dict[str, Any],
) -> list[dict[str, Any]]:
    """Map flag types to canned clarification questions, skipping any that the
    user has already answered."""
    suggested: list[dict[str, Any]] = []
    seen_ids: set[str] = set()

    flag_types = {f["type"] for f in flags}

    if "income_above_local_ceiling" in flag_types or "income_matches_remote_band" in flag_types:
        for q in (QUESTION_REMOTE_WORK, QUESTION_SECONDARY_INCOME):
            if q["id"] not in answer_map and q["id"] not in seen_ids:
                suggested.append(q)
                seen_ids.add(q["id"])

    if "income_inconsistent_with_status" in flag_types:
        if QUESTION_INCONSISTENT_STATUS["id"] not in answer_map:
            suggested.append(QUESTION_INCONSISTENT_STATUS)
            seen_ids.add(QUESTION_INCONSISTENT_STATUS["id"])

    if "income_below_floor" in flag_types:
        if QUESTION_INCOME_BELOW_FLOOR["id"] not in answer_map:
            suggested.append(QUESTION_INCOME_BELOW_FLOOR)
            seen_ids.add(QUESTION_INCOME_BELOW_FLOOR["id"])

    if "occupation_unverifiable" in flag_types:
        if QUESTION_OCCUPATION_UNVERIFIABLE["id"] not in answer_map:
            suggested.append(QUESTION_OCCUPATION_UNVERIFIABLE)
            seen_ids.add(QUESTION_OCCUPATION_UNVERIFIABLE["id"])

    if "income_above_remote_band" in flag_types:
        if QUESTION_SECONDARY_INCOME["id"] not in answer_map and QUESTION_SECONDARY_INCOME["id"] not in seen_ids:
            suggested.append(QUESTION_SECONDARY_INCOME)
            seen_ids.add(QUESTION_SECONDARY_INCOME["id"])

    return suggested


def _llm_question_suggestions(
    transactions: list[dict[str, Any]],
    user_context: dict[str, Any],
    flags: list[dict[str, Any]],
    local_band: tuple[float, float, float],
    remote_band: tuple[float, float, float],
    implied_income: float,
) -> list[dict[str, Any]]:
    """Tiny Sonnet call asking for additional clarifying questions only.

    The model is constrained to return question objects; it cannot influence
    the score. Any failure (no API key, parse error, exception) returns [].
    """
    settings = get_settings()
    if not settings.ANTHROPIC_API_KEY or not flags:
        return []

    system = """\
You are a polite KYC analyst. You receive a summary of a user's income picture
and a list of automated flags. Your ONLY job is to propose 0-2 additional
clarification questions that would help us decide whether the flags are
explained by legitimate facts.

You MUST NOT score, decide, or comment on whether the document is fake. You
MUST NOT repeat questions already implied by the flags.

Return ONLY valid JSON:
{
  "questions": [
    {
      "id": "<short snake_case id>",
      "type": "single_choice | multi_choice | free_text | amount",
      "prompt": "<one sentence question>",
      "options": ["<option 1>", "<option 2>"],
      "linked_flag": "<one of the flag types>"
    }
  ]
}
If no further questions help, return {"questions": []}.
"""

    payload = {
        "occupation": user_context.get("occupation"),
        "occupationCategory": user_context.get("occupationCategory"),
        "governorate": user_context.get("locationGovernorate"),
        "country": user_context.get("locationCountry"),
        "education": user_context.get("educationLevel"),
        "age": user_context.get("age"),
        "implied_monthly_income": round(implied_income, 2),
        "local_band": list(local_band),
        "remote_band": list(remote_band),
        "transaction_count": len(transactions),
        "flags": [{"type": f["type"], "detail": f["detail"]} for f in flags],
    }

    try:
        client = anthropic.Anthropic(api_key=settings.ANTHROPIC_API_KEY)
        res = client.messages.create(
            model=settings.CLAUDE_HAIKU,
            max_tokens=512,
            system=system,
            messages=[{"role": "user", "content": json.dumps(payload, ensure_ascii=False)}],
        )
        raw = res.content[0].text.strip()  # type: ignore[union-attr]
        if raw.startswith("```"):
            raw = "\n".join(raw.split("\n")[1:])
        if raw.endswith("```"):
            raw = raw[: raw.rfind("```")]
        parsed = json.loads(raw)
        questions = parsed.get("questions", []) or []
        out: list[dict[str, Any]] = []
        for q in questions:
            if not isinstance(q, dict):
                continue
            if not q.get("id") or not q.get("prompt"):
                continue
            out.append({
                "id": str(q["id"]),
                "type": str(q.get("type", "free_text")),
                "prompt": str(q["prompt"]),
                "options": list(q.get("options", []) or []),
                "linked_flag": str(q.get("linked_flag", "")),
            })
        return out[:2]
    except Exception as exc:
        logger.warning("LLM question-suggestion call failed: %s", exc)
        return []


def _merge_questions(
    base: list[dict[str, Any]],
    extra: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    seen = {q["id"] for q in base}
    out = list(base)
    for q in extra:
        if q["id"] not in seen:
            out.append(q)
            seen.add(q["id"])
    return out


# ---------------------------------------------------------------------------
# Misc helpers
# ---------------------------------------------------------------------------


def _is_truthy_remote_answer(value: Any) -> bool:
    if not isinstance(value, str):
        return False
    v = value.strip().lower()
    return v.startswith("yes")


def _occupation_is_unverifiable(occupation: str, category: str) -> bool:
    """Heuristic: a free-text occupation is unverifiable if it's empty, a single
    word that is not in a tiny known list, or matches a vague placeholder."""
    if not occupation:
        return True
    o = occupation.strip().lower()
    if o in ("n/a", "none", "other", "self", "freelancer", "worker", "employee", "test"):
        return True
    if len(o.split()) == 1 and len(o) <= 4:
        return True
    return False


def _build_reasoning(
    implied_income: float,
    local_band: tuple[float, float, float],
    remote_band: tuple[float, float, float],
    primary_band_name: str,
    flags: list[dict[str, Any]],
    passed: bool,
) -> str:
    primary = local_band if primary_band_name == "local" else remote_band
    parts = [
        f"Implied monthly income: {implied_income:.0f} TND.",
        (
            f"Primary benchmark: {primary_band_name} "
            f"(p25 {primary[0]:.0f} / p50 {primary[1]:.0f} / p75 {primary[2]:.0f} TND)."
        ),
    ]
    if not flags:
        parts.append("No income-plausibility flags raised.")
    else:
        sevs = Counter(f["severity"] for f in flags)
        parts.append(
            "Flags: " + ", ".join(f"{n} {sev}" for sev, n in sevs.items()) + "."
        )
    parts.append("Verdict: " + ("PASS" if passed else "NEEDS REVIEW"))
    return " ".join(parts)
