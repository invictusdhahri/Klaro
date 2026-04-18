"""Claude Vision-based field extractor for identity documents.

Sends the raw document image directly to Claude Haiku (vision) so it can
read and understand the document layout visually, rather than relying on
PaddleOCR's text extraction which struggles with stylised Arabic card text.
"""

from __future__ import annotations

import base64
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
You are a highly accurate identity-document reader specialised in Tunisian CIN
(Carte d'Identité Nationale), passports, and driver licences.

Your task is to look at the document image and extract the fields below.
Return ONLY valid JSON — no markdown fences, no explanations, nothing else.

ANTI-HALLUCINATION RULES — read these first:
- ONLY extract text you can clearly and unambiguously see in the image.
- If a field is blurry, obscured, cut off, or genuinely unreadable → return null.
- NEVER guess, infer, or fill in plausible values from memory or context.
- NEVER combine a readable field with a guessed field. Partial reads → null.
- If the image is too zoomed-in, low-resolution, or a photo-of-a-photo and
  most text is illegible, return null for ALL fields rather than hallucinate.
- The image has been auto-rotated to upright before being sent to you, but if
  text appears rotated or sideways, still attempt to read it — never return
  all-null solely because of orientation.

IMPORTANT rules for Tunisian CINs:
- The card has two main name fields:
    اللقب  (family/last name)
    الاسم  (given/first name)
  Concatenate them as  "given_name family_name"  for full_name.
- "بن" / "ابن" (son of) and "بنت" / "ابنة" (daughter of) are document-structure
  labels that appear before the father's name. Do NOT include them in full_name.
  They indicate gender (M / F respectively).
- full_name_latin: always provide a Latin-script version.
  If it is printed on the card, use it verbatim.
  Otherwise transliterate using standard Tunisian romanisation:
    أمين→Amine  محمد→Mohamed  الدلاشي→Delachi  رمضان→Ramadan
    علي→Ali  فاطمة→Fatma  مريم→Maryem  يوسف→Youssef  خالد→Khaled
  CRITICAL letter rules for Tunisian names:
    ظ → "dh" (e.g. يرهاظ→Yarhaddhi, ظافر→Dhafar). NEVER use "z" for ظ.
    ذ → "dh"  (e.g. رذي→Rdhi)
    ث → "th"
    غ → "gh"
    خ → "kh"
    ح → "h"  (not "kh")
    ع → omit or use "a/i/u" based on vowel context
- date_of_birth / expiry_date: output as YYYY-MM-DD regardless of what is printed.
- address: translate/transliterate to English (e.g. تونس→Tunis, قفصة→Gafsa,
  صفاقس→Sfax, سوسة→Sousse, نابل→Nabeul, المنستير→Monastir, باجة→Beja,
  بنزرت→Bizerte, قابس→Gabes, القيروان→Kairouan, سيدي بوزيد→Sidi Bouzid,
  مدنين→Medenine, تطاوين→Tataouine, قبلي→Kebili, توزر→Tozeur,
  جندوبة→Jendouba, زغوان→Zaghouan).
- gender: "M" if ذكر / ابن / male indicator, "F" if أنثى / ابنة / female indicator.
- cin_number: 8-digit number only, no spaces or letters.
- Use null for any field that is genuinely unreadable or absent.

Output schema:
{
  "full_name": "<Arabic given + family name, no بن/بنت>",
  "full_name_latin": "<Latin transliteration or printed name>",
  "cin_number": "<8 digits>",
  "date_of_birth": "<YYYY-MM-DD>",
  "expiry_date": "<YYYY-MM-DD>",
  "address": "<English address>",
  "gender": "<M or F>"
}
"""


def extract_fields_via_vision(
    image_bytes: bytes,
    document_type: str,
    settings: Settings,
    quality_score: float = 1.0,
) -> tuple[dict[str, str | None], float]:
    """Send the document image to Claude Haiku vision and return (fields, confidence).

    This replaces the PaddleOCR → text → Haiku text pipeline with a single
    vision call that reads the document directly, yielding far better accuracy
    on stylised Arabic card text, tilted images, and glare.

    Falls back to an empty dict with confidence 0.0 on any API error.
    """
    if not settings.ANTHROPIC_API_KEY:
        logger.error("ANTHROPIC_API_KEY not set; cannot call Claude Vision.")
        return {k: None for k in _KNOWN_FIELDS}, 0.0

    try:
        import anthropic  # type: ignore[import-not-found]
    except ImportError as exc:
        raise RuntimeError("anthropic package is not installed.") from exc

    client = anthropic.Anthropic(api_key=settings.ANTHROPIC_API_KEY)

    # Detect MIME type from magic bytes
    mime = "image/jpeg"
    if image_bytes[:4] == b"\x89PNG":
        mime = "image/png"
    elif image_bytes[:4] == b"RIFF" or image_bytes[:4] == b"WEBP":
        mime = "image/webp"

    b64_image = base64.standard_b64encode(image_bytes).decode("ascii")
    _empty: dict[str, str | None] = {k: None for k in _KNOWN_FIELDS}

    user_content = [
        {
            "type": "image",
            "source": {"type": "base64", "media_type": mime, "data": b64_image},
        },
        {
            "type": "text",
            "text": (
                f"document_type: {document_type}\n"
                f"image_quality_score: {quality_score:.2f} (0=unusable, 1=perfect)\n\n"
                + (
                    "WARNING: Image quality is marginal. Be extra conservative — "
                    "return null for any field you cannot read with full confidence. "
                    "Do NOT guess.\n\n"
                    if quality_score < 0.5
                    else ""
                )
                + "Extract all KYC fields from this document image."
            ),
        },
    ]

    try:
        message = client.messages.create(
            model=settings.CLAUDE_HAIKU,
            max_tokens=768,
            system=_SYSTEM_PROMPT,
            messages=[{"role": "user", "content": user_content}],
        )
    except Exception as exc:
        logger.error("Claude Vision API call failed: %s", exc)
        return _empty, 0.0

    raw_response = message.content[0].text.strip()
    logger.debug("Vision response: %s", raw_response)

    # Strip accidental markdown fences
    if raw_response.startswith("```"):
        raw_response = "\n".join(
            line for line in raw_response.splitlines() if not line.startswith("```")
        ).strip()

    try:
        parsed: dict[str, str | None] = json.loads(raw_response)
    except json.JSONDecodeError:
        logger.error("Vision response was not valid JSON: %s", raw_response)
        return _empty, 0.0

    fields: dict[str, str | None] = {k: parsed.get(k) or None for k in _KNOWN_FIELDS}
    non_null = sum(1 for v in fields.values() if v is not None)
    confidence = round(non_null / len(_KNOWN_FIELDS), 4)

    return fields, confidence
