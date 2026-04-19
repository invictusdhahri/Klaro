"""Pass 1 — Format-aware transaction extraction.

Routing logic:
  image/*           → Claude Vision (base64)
  application/pdf   → PyMuPDF text extraction; if sparse → Claude Vision on rendered pages
  text/csv          → pandas auto-delimiter → Claude Haiku
  application/vnd.* (Excel) → pandas read_excel → Claude Haiku
"""

from __future__ import annotations

import base64
import csv
import io
import json
from typing import Any

import anthropic

from klaro_ml.settings import get_settings

EXTRACTION_PROMPT = """\
You are a financial data extraction expert specialising in Tunisian and North African bank statements.
The document may be in Arabic, French, or a mix of both.

Extract ALL transactions visible in the document and return ONLY valid JSON in this exact schema:

{
  "transactions": [
    {
      "date": "YYYY-MM-DD",
      "description": "<original description, transliterated if Arabic>",
      "amount": <positive float, always positive>,
      "type": "credit" | "debit",
      "category": "<one of: salary, transfer, bill, atm, purchase, loan_repayment, other>"
    }
  ]
}

Rules:
- Amounts are always positive; use "type" to indicate direction.
- NUMBER FORMAT: Tunisian bank statements use French formatting. Two common styles:
    Style A (comma-decimal):  "1 200,000" = 1200.000 TND | "342,800" = 342.800 TND | "87,500" = 87.500 TND
    Style B (period-decimal): "1 200.000" = 1200.000 TND | "342.800" = 342.800 TND | "87.500" = 87.500 TND
  In both styles a SPACE separates thousands from hundreds. A single comma or period at the end
  is always the DECIMAL mark, not a thousands separator.
  NEVER interpret "100,000" as one-hundred-thousand; it means 100.000 (one hundred dinars).
  NEVER split a number with a space into two separate values.
- Dashes (— or -) in debit or credit columns mean the column is empty (zero / not applicable).
- If a date is ambiguous, prefer DD/MM/YYYY then MM/DD/YYYY.
- If no transactions are visible, return {"transactions": []}.
- Output ONLY the JSON object, no markdown fences, no explanations.
"""

IMAGE_MIMES = {
    "image/jpeg", "image/jpg", "image/png",
    "image/webp", "image/gif", "image/tiff",
}

TABULAR_MIMES = {
    "text/csv",
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
}


def extract_transactions(file_bytes: bytes, mime_type: str) -> list[dict[str, Any]]:
    """Route to the correct extractor and return a list of transaction dicts."""
    settings = get_settings()
    if not settings.ANTHROPIC_API_KEY:
        return []

    client = anthropic.Anthropic(api_key=settings.ANTHROPIC_API_KEY)

    if mime_type in IMAGE_MIMES:
        return _extract_via_vision(client, file_bytes, mime_type)

    if mime_type == "application/pdf":
        return _extract_pdf(client, file_bytes, mime_type)

    if mime_type in TABULAR_MIMES:
        return _extract_tabular(client, file_bytes, mime_type)

    # Fallback: try vision on unknown types
    return _extract_via_vision(client, file_bytes, "image/jpeg")


# ---------------------------------------------------------------------------
# Image → Claude Vision
# ---------------------------------------------------------------------------

def _extract_via_vision(
    client: anthropic.Anthropic,
    image_bytes: bytes,
    mime_type: str,
    extra_text: str = "",
) -> list[dict[str, Any]]:
    media_type = mime_type if mime_type in IMAGE_MIMES else "image/jpeg"
    b64 = base64.standard_b64encode(image_bytes).decode()

    content: list[Any] = [
        {
            "type": "image",
            "source": {"type": "base64", "media_type": media_type, "data": b64},
        }
    ]
    if extra_text:
        content.append({"type": "text", "text": extra_text})
    content.append({"type": "text", "text": EXTRACTION_PROMPT})

    settings = get_settings()
    res = client.messages.create(
        model=settings.CLAUDE_SONNET,
        max_tokens=4096,
        messages=[{"role": "user", "content": content}],
    )
    return _parse_transactions(res.content[0].text)  # type: ignore[union-attr]


# ---------------------------------------------------------------------------
# PDF → PyMuPDF (text or rendered pages)
# ---------------------------------------------------------------------------

def _extract_pdf(
    client: anthropic.Anthropic,
    pdf_bytes: bytes,
    _mime_type: str,
) -> list[dict[str, Any]]:
    try:
        import fitz  # PyMuPDF
    except ImportError:
        # Fallback: treat as generic binary, skip extraction
        return []

    doc = fitz.open(stream=pdf_bytes, filetype="pdf")

    # Try text extraction first
    full_text = "\n".join(page.get_text() for page in doc)

    if len(full_text.strip()) >= 200:
        # Text-based PDF: use Haiku with extracted text
        return _extract_via_text(client, full_text)

    # Scanned PDF: render first 3 pages as images and use Vision
    results: list[dict[str, Any]] = []
    for page_num in range(min(3, len(doc))):
        page = doc[page_num]
        mat = fitz.Matrix(2.0, 2.0)  # 2× zoom for better OCR quality
        pix = page.get_pixmap(matrix=mat)
        img_bytes = pix.tobytes("png")
        page_txs = _extract_via_vision(client, img_bytes, "image/png",
                                       extra_text=f"[Page {page_num + 1} of {len(doc)}]")
        results.extend(page_txs)

    # Deduplicate by (date, amount, description) across pages
    seen: set[tuple[str, float, str]] = set()
    unique: list[dict[str, Any]] = []
    for tx in results:
        key = (tx.get("date", ""), float(tx.get("amount", 0)), tx.get("description", ""))
        if key not in seen:
            seen.add(key)
            unique.append(tx)

    return unique


# ---------------------------------------------------------------------------
# CSV / Excel → pandas → Claude Haiku
# ---------------------------------------------------------------------------

def _extract_tabular(
    client: anthropic.Anthropic,
    file_bytes: bytes,
    mime_type: str,
) -> list[dict[str, Any]]:
    try:
        import pandas as pd
    except ImportError:
        # Minimal CSV fallback without pandas
        text = _csv_to_text(file_bytes)
        return _extract_via_text(client, text)

    try:
        if mime_type in ("application/vnd.ms-excel",
                         "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"):
            df = pd.read_excel(io.BytesIO(file_bytes))
        else:
            df = pd.read_csv(io.BytesIO(file_bytes), sep=None, engine="python",
                             encoding_errors="replace")

        # Limit to first 500 rows to stay within context window
        table_text = df.head(500).to_string(index=False)
    except Exception:
        table_text = _csv_to_text(file_bytes)

    return _extract_via_text(client, table_text)


def _extract_via_text(client: anthropic.Anthropic, text: str) -> list[dict[str, Any]]:
    settings = get_settings()
    # Truncate to ~12 000 chars to stay within Haiku context
    truncated = text[:12_000]
    res = client.messages.create(
        model=settings.CLAUDE_HAIKU,
        max_tokens=4096,
        messages=[{
            "role": "user",
            "content": f"{EXTRACTION_PROMPT}\n\n---\nDOCUMENT CONTENT:\n{truncated}",
        }],
    )
    return _parse_transactions(res.content[0].text)  # type: ignore[union-attr]


def _csv_to_text(file_bytes: bytes) -> str:
    """Minimal CSV to plain-text without pandas."""
    text = file_bytes.decode("utf-8", errors="replace")
    reader = csv.reader(io.StringIO(text))
    rows = ["\t".join(row) for row in reader]
    return "\n".join(rows[:500])


def _parse_transactions(raw: str) -> list[dict[str, Any]]:
    """Parse Claude's JSON response, tolerating markdown fences."""
    cleaned = raw.strip()
    if cleaned.startswith("```"):
        cleaned = "\n".join(cleaned.split("\n")[1:])
    if cleaned.endswith("```"):
        cleaned = cleaned[: cleaned.rfind("```")]
    try:
        data = json.loads(cleaned)
        return data.get("transactions", [])
    except (json.JSONDecodeError, AttributeError):
        return []
