"""Claude Haiku OCR field parser.

Sends raw PaddleOCR text lines to Claude Haiku and receives a structured
JSON object containing the KYC fields extracted from the document.
"""

from __future__ import annotations

import json
import logging

from klaro_ml.settings import Settings

logger = logging.getLogger(__name__)

_KNOWN_FIELDS = (
    "full_name",
    "full_name_latin",
    "cin_number",
    "date_of_birth",
    "expiry_date",
    "address",
    "gender",
)

_SYSTEM_PROMPT = """\
You are a document OCR parser specialised in Tunisian identity documents (CIN).
Given raw text lines extracted by an OCR engine from a scanned ID document,
extract AND convert the structured fields listed below.

Rules:
- Return ONLY valid JSON — no markdown fences, no explanations, nothing else.
- Use null for any field you cannot find or are uncertain about.
- Dates must be formatted as YYYY-MM-DD.

Field-specific instructions:

full_name / full_name_latin:
  The name lines arrive as spatially-ordered fragments (right-to-left within
  each row). Reconstruct the full name by joining them in the order given.
  Ignore isolated particles like a lone "بن" or "بنت" that appear as the very
  last token with no preceding name — these are OCR artefacts.
  Keep the original Arabic script in full_name.
  For full_name_latin: if a Latin name is present on the document, use it.
  If only Arabic is present, transliterate using standard Tunisian romanisation:
  "محمد"→Mohamed, "أمين"→Amine, "علي"→Ali, "الله"→Allah, "عبد"→Abd,
  "بن"→Ben, "بنت"→Bent, "رمضان"→Ramadan, "الدلاشي"→Delachi,
  "بوعزيزي"→Bouazizi, "الطرابلسي"→Trabelsi, "بن علي"→Ben Ali.
  Never leave full_name_latin null if full_name is present.
  CRITICAL letter rules for Tunisian names:
    ظ → "dh" (e.g. يرهاظ→Yarhadhh, ظافر→Dhafar). NEVER use "z" for ظ.
    ذ → "dh",  ث → "th",  غ → "gh",  خ → "kh"

cin_number:
  The 8-digit national ID number. Digits only, no spaces.

date_of_birth / expiry_date:
  Parse any date format found (DD/MM/YYYY, DD-MM-YYYY, written Arabic) and
  output as YYYY-MM-DD.

address:
  Translate or transliterate the address to English/Latin script.
  Common Tunisian cities: تونس→Tunis, صفاقس→Sfax, سوسة→Sousse,
  قفصة→Gafsa, بنزرت→Bizerte, قابس→Gabes, نابل→Nabeul, المنستير→Monastir,
  القيروان→Kairouan, باجة→Beja, جندوبة→Jendouba, زغوان→Zaghouan,
  سيدي بوزيد→Sidi Bouzid, مدنين→Medenine, تطاوين→Tataouine,
  قبلي→Kebili, توزر→Tozeur.
  If the city is not in this list, transliterate it.

gender:
  Map Arabic or abbreviated indicators to "M" or "F":
  ذكر, م, M, Male → "M"
  أنثى, إناث, أ, F, Female → "F"
  Return null only if genuinely absent.

Output schema (JSON only):
{
  "full_name": "<original Arabic name or null>",
  "full_name_latin": "<Latin/English name — never null if full_name present>",
  "cin_number": "<8-digit number or null>",
  "date_of_birth": "<YYYY-MM-DD or null>",
  "expiry_date": "<YYYY-MM-DD or null>",
  "address": "<Latin-script address or null>",
  "gender": "<M or F or null>"
}
"""


def parse_ocr_to_fields(
    raw_lines: list[str],
    document_type: str,
    settings: Settings,
) -> tuple[dict[str, str | None], float]:
    """Send *raw_lines* to Claude Haiku and return ``(fields, confidence)``.

    ``confidence`` is the fraction of the seven known fields that were
    successfully extracted (non-null value).  Raises ``RuntimeError`` if the
    Anthropic API key is not configured or the response cannot be parsed.
    """
    if not settings.ANTHROPIC_API_KEY:
        raise RuntimeError("ANTHROPIC_API_KEY is not set; cannot call Claude Haiku.")

    try:
        import anthropic  # type: ignore[import-not-found]
    except ImportError as exc:
        raise RuntimeError("anthropic package is not installed.") from exc

    client = anthropic.Anthropic(api_key=settings.ANTHROPIC_API_KEY)

    user_content = (
        f"document_type: {document_type}\n\n"
        f"raw_text_lines:\n"
        + "\n".join(f"- {line}" for line in raw_lines)
    )

    _empty: dict[str, str | None] = {k: None for k in _KNOWN_FIELDS}

    try:
        message = client.messages.create(
            model=settings.CLAUDE_HAIKU,
            max_tokens=768,
            system=_SYSTEM_PROMPT,
            messages=[{"role": "user", "content": user_content}],
        )
    except Exception as exc:
        logger.error("Haiku API call failed: %s", exc)
        return _empty, 0.0

    raw_response = message.content[0].text.strip()
    logger.debug("Haiku raw response: %s", raw_response)

    # Strip markdown code fences if the model wraps the JSON in ```json ... ```
    if raw_response.startswith("```"):
        lines = raw_response.splitlines()
        raw_response = "\n".join(
            line for line in lines if not line.startswith("```")
        ).strip()

    try:
        parsed: dict[str, str | None] = json.loads(raw_response)
    except json.JSONDecodeError:
        logger.error("Haiku returned non-JSON: %s", raw_response)
        return _empty, 0.0

    # Normalise: keep only known fields, coerce missing keys to None.
    fields: dict[str, str | None] = {k: parsed.get(k) or None for k in _KNOWN_FIELDS}

    non_null = sum(1 for v in fields.values() if v is not None)
    confidence = round(non_null / len(_KNOWN_FIELDS), 4)

    return fields, confidence