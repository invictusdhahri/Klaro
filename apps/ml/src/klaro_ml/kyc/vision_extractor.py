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
    "occupation",
    "father_name",
    "mother_name",
    "place_of_birth",
)

_SYSTEM_PROMPT = """\
You are a highly accurate identity-document reader specialised in Tunisian CIN
(Carte d'Identité Nationale), passports, and driver licences.

Your task is to look at the document image(s) and extract the fields below.
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
- The card has two name fields:
    اللقب  (family / last name)
    الاسم  (given name field — but it encodes the full paternal chain)

  The الاسم field follows this exact structure:
      [given_name] بن [father_name] بن [grandfather_name]   (male holder)
      [given_name] بنت [father_name] بن [grandfather_name]  (female holder)

  Rules derived from this structure:
  ① full_name  = ONLY the text that appears BEFORE the first "بن" or "بنت"
                 in الاسم (i.e. the holder's own given name), combined with
                 اللقب (family name).
                 Format: "<given_name> <family_name>"
                 NEVER include بن / بنت or anything after them in full_name.
  ② father_name = the text that appears BETWEEN the first "بن/بنت" and the
                  SECOND "بن" (i.e. the first name of the holder's father).
                  Transliterate to Latin script.
  ③ gender: "M" if the connector is "بن" (son of), "F" if "بنت" (daughter of).
             Also check ذكر / أنثى labels if present.

  Example — الاسم: "أمين بن الشاذلي بن محمد", اللقب: "بن علي"
    → full_name      = "أمين بن علي"
    → full_name_latin = "Amine Ben Ali"
    → father_name    = "Elchadhli"   (transliterated الشاذلي)
    → gender         = "M"
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
- gender: "M" if ذكر / بن / male indicator, "F" if أنثى / بنت / female indicator.
  The بن / بنت connector in الاسم is the primary signal when explicit labels are absent.
- cin_number: 8-digit number only, no spaces or letters.

VERSO / BACK SIDE fields (when a second image is provided or the back is visible):
- occupation: the المهنة / Profession / Emploi field — translate to English
  (e.g. إطار→Executive, مهندس→Engineer, أستاذ→Teacher, طبيب→Doctor,
   موظف→Civil servant, تاجر→Merchant, عامل→Worker, طالب→Student,
   متقاعد→Retired, بدون مهنة→Unemployed).
- father_name: extracted from the الاسم field on the recto (see rules above).
  If a verso is provided and اسم الأب is printed there, use that as a fallback
  or to confirm the recto extraction. Transliterate to Latin script.
- mother_name: اسم الأم — transliterate to Latin script.
- place_of_birth: مكان الولادة — translate/transliterate to English using the
  same city mapping as address.
- Use null for any of these if absent or unreadable.

Output schema (return null for missing/unreadable fields):
{
  "full_name": "<Arabic given + family name, no بن/بنت>",
  "full_name_latin": "<Latin transliteration or printed name>",
  "cin_number": "<8 digits>",
  "date_of_birth": "<YYYY-MM-DD>",
  "expiry_date": "<YYYY-MM-DD>",
  "address": "<English address>",
  "gender": "<M or F>",
  "occupation": "<English occupation or null>",
  "father_name": "<Latin transliteration or null>",
  "mother_name": "<Latin transliteration or null>",
  "place_of_birth": "<English city/place or null>"
}
"""


def extract_fields_via_vision(
    image_bytes: bytes,
    document_type: str,
    settings: Settings,
    quality_score: float = 1.0,
    verso_bytes: bytes | None = None,
) -> tuple[dict[str, str | None], float]:
    """Send the document image(s) to Claude Haiku vision and return (fields, confidence).

    When `verso_bytes` is supplied the back side of the document is included as
    a second image in the same API call, allowing Claude to extract verso-only
    fields (occupation, father/mother names, place of birth) in one pass.
    """
    if not settings.ANTHROPIC_API_KEY:
        logger.error("ANTHROPIC_API_KEY not set; cannot call Claude Vision.")
        return {k: None for k in _KNOWN_FIELDS}, 0.0

    try:
        import anthropic  # type: ignore[import-not-found]
    except ImportError as exc:
        raise RuntimeError("anthropic package is not installed.") from exc

    client = anthropic.Anthropic(api_key=settings.ANTHROPIC_API_KEY)

    def _mime(buf: bytes) -> str:
        if buf[:4] == b"\x89PNG":
            return "image/png"
        if buf[:4] in (b"RIFF", b"WEBP"):
            return "image/webp"
        return "image/jpeg"

    def _img_block(buf: bytes) -> dict:
        return {
            "type": "image",
            "source": {
                "type": "base64",
                "media_type": _mime(buf),
                "data": base64.standard_b64encode(buf).decode("ascii"),
            },
        }

    _empty: dict[str, str | None] = {k: None for k in _KNOWN_FIELDS}

    quality_warning = (
        "WARNING: Image quality is marginal. Be extra conservative — "
        "return null for any field you cannot read with full confidence. "
        "Do NOT guess.\n\n"
        if quality_score < 0.5
        else ""
    )

    if verso_bytes:
        user_content = [
            {"type": "text", "text": "FRONT SIDE (Recto):"},
            _img_block(image_bytes),
            {"type": "text", "text": "BACK SIDE (Verso):"},
            _img_block(verso_bytes),
            {
                "type": "text",
                "text": (
                    f"document_type: {document_type}\n"
                    f"image_quality_score: {quality_score:.2f} (0=unusable, 1=perfect)\n\n"
                    + quality_warning
                    + "Extract all KYC fields from both sides of this document. "
                    "The front contains the photo and personal details; "
                    "the back contains occupation, parents' names, and place of birth."
                ),
            },
        ]
    else:
        user_content = [
            _img_block(image_bytes),
            {
                "type": "text",
                "text": (
                    f"document_type: {document_type}\n"
                    f"image_quality_score: {quality_score:.2f} (0=unusable, 1=perfect)\n\n"
                    + quality_warning
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
