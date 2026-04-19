"""Multi-page Claude Vision ensemble.

The previous Layer-1 only showed Claude the first page of a PDF, so an
attacker only needed one convincing page. This module renders every page (up
to a cap), runs both the existing forensic prompt AND an AI-generation prompt
with two different models, then aggregates per-page votes into a single result.

A page only contributes a failure vote if a model is **confident** the page is
bad (see `_fail_vote`). A page is aggregated as failed only if both per-page
models flag it. `vision_page_flagged` is always emitted at **low** severity so
the UI does not over-weight heuristic LLM commentary on real bank exports.
"""

from __future__ import annotations

import base64
import logging
from typing import Any

import anthropic

from klaro_ml.settings import get_settings

logger = logging.getLogger(__name__)

MAX_PAGES = 6  # cap to control latency / cost

FORENSIC_PROMPT = """\
You are a forensic document analyst inspecting ONE rasterised page from a bank
statement PDF. Your job is to find **definitive** digital tampering — not to
second-guess normal banking data.

CRITICAL — default to passed=true (genuine) unless you see clear tampering:
- **Digital PDF exports** (clean vector/raster text, uniform background, no
  JPEG speckle) are NORMAL. Do NOT treat "no scan noise" or "uniform texture"
  as manipulation.
- **Value date vs operation date** order varies by bank and product (debits vs
  credits). Unusual ordering alone is NOT tampering.
- **Round salary or transfer amounts** (e.g. 300,000 / 1,700,000) are common.
  Not suspicious by itself.
- **Pay period labels** (e.g. "Salaire Mars" near an April operation date) can
  reflect payroll cut-off — not proof of editing.
- **Slight font weight differences** in rasterised PDFs (anti-aliasing, column
  alignment) happen on legitimate exports. Only flag if you see obvious
  copy-paste halos, misaligned baselines, or clashing typefaces in one cell.

Only set passed=false if you see strong evidence such as: visible paste halos,
misaligned table cells, clashing fonts in one amount field, or clear compositing.

Return ONLY valid JSON, no markdown:
{
  "passed": <true unless clear tampering>,
  "confidence": <0.0-1.0, your confidence in *passed*>,
  "signals": [<short strings, empty if none; omit vague "might be" concerns>]
}
"""

AI_GENERATION_PROMPT = """\
You are inspecting ONE page image. Decide if it looks like an **AI-generated
fake image** (diffusion/GAN) or a **fabricated fantasy bank screenshot** — NOT
whether the bank statement *content* is suspicious.

IMPORTANT — these are usually **genuine** (passed=true):
- Normal **digital bank PDFs** exported from a real banking portal: crisp text,
  clean backgrounds, consistent branding. This is NOT "AI art" — it is a real
  product screenshot/PDF render.
- Lack of camera/scanner noise does NOT mean AI; vector PDFs are clean by nature.

Only set passed=false if you see classic **synthetic image** failures: impossible
glyphs, garbled diacritics, hallucinated logos, warped tables, or obvious
diffusion texture — not "round numbers" or "logical date quirks".

Return ONLY valid JSON, no markdown:
{
  "passed": <true for real bank PDF/scan output, false only if clearly AI-synthetic>,
  "confidence": <0.0-1.0>,
  "signals": [<short strings, empty if none>]
}
"""


def analyse(file_bytes: bytes, mime_type: str) -> dict[str, Any]:
    """Run the multi-page Claude Vision ensemble.

    Returns:
        {
          "available": bool,            # whether the LLM call ran
          "pages_analysed": int,
          "page_votes": [{page, model, prompt, passed, confidence, signals}],
          "signals": [aggregated typed signals],
        }
    """
    settings = get_settings()
    if not settings.ANTHROPIC_API_KEY:
        return {
            "available": False,
            "pages_analysed": 0,
            "page_votes": [],
            "signals": [],
        }

    page_images = _render_pages(file_bytes, mime_type)
    if not page_images:
        return {
            "available": False,
            "pages_analysed": 0,
            "page_votes": [],
            "signals": [],
        }

    client = anthropic.Anthropic(api_key=settings.ANTHROPIC_API_KEY)
    page_votes: list[dict[str, Any]] = []

    for page_index, (img_bytes, img_mime) in enumerate(page_images):
        for model_name, prompt_label, system_prompt in (
            (settings.CLAUDE_SONNET, "forensic", FORENSIC_PROMPT),
            (settings.CLAUDE_HAIKU, "ai_generation", AI_GENERATION_PROMPT),
        ):
            try:
                vote = _ask_one(client, model_name, system_prompt, img_bytes, img_mime)
            except Exception as exc:
                logger.warning("vision ensemble call failed (page %d, model %s): %s",
                               page_index + 1, model_name, exc)
                continue
            vote["page"] = page_index + 1
            vote["model"] = model_name
            vote["prompt"] = prompt_label
            page_votes.append(vote)

    return {
        "available": True,
        "pages_analysed": len(page_images),
        "page_votes": page_votes,
        "signals": _aggregate(page_votes, len(page_images)),
    }


# ---------------------------------------------------------------------------
# Per-page rendering
# ---------------------------------------------------------------------------


def _render_pages(file_bytes: bytes, mime_type: str) -> list[tuple[bytes, str]]:
    """Return a list of (bytes, mime) per page. Image inputs become a single page."""
    if mime_type.startswith("image/"):
        return [(file_bytes, mime_type)]

    if mime_type != "application/pdf":
        return []

    try:
        import fitz  # PyMuPDF
    except ImportError:
        return []

    try:
        doc = fitz.open(stream=file_bytes, filetype="pdf")
    except Exception:
        return []

    out: list[tuple[bytes, str]] = []
    try:
        for page_index in range(min(MAX_PAGES, len(doc))):
            try:
                pix = doc[page_index].get_pixmap(matrix=fitz.Matrix(2.0, 2.0))
                out.append((pix.tobytes("png"), "image/png"))
            except Exception:
                continue
    finally:
        doc.close()
    return out


# ---------------------------------------------------------------------------
# Single LLM call
# ---------------------------------------------------------------------------


def _ask_one(
    client: anthropic.Anthropic,
    model: str,
    system_prompt: str,
    image_bytes: bytes,
    image_mime: str,
) -> dict[str, Any]:
    import json

    media_type = image_mime if image_mime in (
        "image/jpeg", "image/jpg", "image/png", "image/webp", "image/gif"
    ) else "image/png"
    b64 = base64.standard_b64encode(image_bytes).decode()

    res = client.messages.create(
        model=model,
        max_tokens=512,
        system=system_prompt,
        messages=[{
            "role": "user",
            "content": [{
                "type": "image",
                "source": {"type": "base64", "media_type": media_type, "data": b64},
            }],
        }],
    )

    raw = res.content[0].text.strip()  # type: ignore[union-attr]
    if raw.startswith("```"):
        raw = "\n".join(raw.split("\n")[1:])
    if raw.endswith("```"):
        raw = raw[: raw.rfind("```")]

    try:
        parsed = json.loads(raw)
    except (json.JSONDecodeError, AttributeError):
        # Treat as a non-vote rather than a forced pass
        return {"passed": True, "confidence": 0.0, "signals": ["llm_parse_error"]}

    return {
        "passed": bool(parsed.get("passed", True)),
        "confidence": float(parsed.get("confidence", 0.5)),
        "signals": list(parsed.get("signals", []) or []),
    }


# ---------------------------------------------------------------------------
# Aggregation
# ---------------------------------------------------------------------------


def _fail_vote(v: dict[str, Any]) -> bool:
    """Only count confident failures; ignore low-confidence rejections."""
    passed = bool(v.get("passed", True))
    conf = float(v.get("confidence", 0.5))
    if not passed:
        return conf >= 0.72
    return conf < 0.30


def _aggregate(page_votes: list[dict[str, Any]], pages_total: int) -> list[dict[str, Any]]:
    """Roll per-page model votes into typed signals for the rule engine."""
    if not page_votes or pages_total == 0:
        return []

    signals: list[dict[str, Any]] = []

    # Group votes by page; only treat a page as failed if both models flagged it
    # (two votes per page when both API calls succeed), or one vote failed when
    # only one vote exists for that page (degraded / partial run).
    by_page: dict[int, list[dict[str, Any]]] = {}
    for v in page_votes:
        by_page.setdefault(v["page"], []).append(v)

    pages_with_fail: dict[int, list[dict[str, Any]]] = {}
    for page, votes in by_page.items():
        fail_votes = [v for v in votes if _fail_vote(v)]
        if len(fail_votes) >= 2:
            pages_with_fail[page] = fail_votes
        elif len(votes) == 1 and len(fail_votes) == 1:
            pages_with_fail[page] = fail_votes

    # Page-level signals — always low severity: LLM commentary must not dominate
    # risk for legitimate digital statements (see prompts).
    for page, fail_votes in pages_with_fail.items():
        models = sorted({v["model"] for v in fail_votes})
        all_signals: list[str] = []
        for v in fail_votes:
            all_signals.extend(v.get("signals", []))
        signals.append({
            "type": "vision_page_flagged",
            "severity": "low",
            "detail": (
                f"Page {page}: vision models noted possible issues (low priority — "
                f"often false on real PDFs): "
                f"{'; '.join(all_signals[:5]) if all_signals else 'no specific signals returned'}."
            ),
            "evidence": {
                "page": page,
                "models_flagging": models,
                "model_signals": all_signals[:12],
            },
            "source": "vision_ensemble",
        })

    # Document-level disagreement signal: when models disagree on the same page
    disagreements = 0
    for v in page_votes:
        peers = [
            o for o in page_votes
            if o["page"] == v["page"] and o["model"] != v["model"] and o["prompt"] == v["prompt"]
        ]
        for peer in peers:
            if peer.get("passed") != v.get("passed"):
                disagreements += 1

    if disagreements > 0:
        signals.append({
            "type": "vision_model_disagreement",
            "severity": "low",
            "detail": (
                f"{disagreements // 2} model pair(s) disagreed on whether a page is genuine. "
                f"Disagreement is itself a confidence-reducing signal."
            ),
            "evidence": {"disagreement_pairs": disagreements // 2},
            "source": "vision_ensemble",
        })

    # Fraction-of-document signal (meaningless for single-page uploads — any hit is 100%)
    if pages_with_fail and pages_total > 1:
        frac = len(pages_with_fail) / pages_total
        if frac > 0.33:
            signals.append({
                "type": "vision_majority_flagged",
                "severity": "low",
                "detail": (
                    f"{len(pages_with_fail)}/{pages_total} pages had confident vision "
                    f"failure votes — review if other layers also fail."
                ),
                "evidence": {
                    "pages_flagged": len(pages_with_fail),
                    "pages_total": pages_total,
                    "fraction": round(frac, 2),
                },
                "source": "vision_ensemble",
            })

    return signals
