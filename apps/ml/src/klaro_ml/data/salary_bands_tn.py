"""Static salary band reference for Income Plausibility (Layer 3.5).

Numbers are *coarse* monthly net income medians in TND for the local Tunisian
labour market and TND-equivalents for typical abroad/remote scenarios. They
exist as a deterministic fallback so the layer always has a sane benchmark
even when Tavily is unreachable; live web-search results override these when
present.

Sources (cross-checked, March 2026):
- INS (Institut National de la Statistique) wage bulletin 2024-Q4
- BCT minimum wage tables (SMIG / SMAG)
- Numbeo Tunisia cost-of-living + reported wages (community data)
- Payscale.com / Glassdoor pages for "Tunisia software engineer", "Tunisia
  accountant", "Tunisia ride-share driver"
- Reported freelance hourly rates from Upwork / Toptal Tunisia profiles
- Gulf labour-export agency wage tables (low-skill abroad bands)

These are reference points for "is the user's income plausible", NOT
ground truth. The comparator combines them with live search results and
profile-aware tolerance bands.

Schema
------
LOCAL_BANDS_TND: dict[occupationCategory, (p25, p50, p75)]
REMOTE_BANDS_TND: dict[occupationCategory, (p25, p50, p75)]   # converted USD -> TND
GOVERNORATE_MULTIPLIERS: dict[governorate, float]             # tilt for capital region
EDUCATION_MULTIPLIERS: dict[education_level, float]
"""

from __future__ import annotations

# Coarse local monthly net income bands (TND/month).
LOCAL_BANDS_TND: dict[str, tuple[float, float, float]] = {
    "student":         (   0.0,   200.0,   600.0),
    "unemployed":      (   0.0,     0.0,   300.0),
    "retired":         ( 400.0,   700.0,  1500.0),
    "salaried":        ( 700.0,  1400.0,  3000.0),
    "freelance":       ( 600.0,  2000.0,  6000.0),
    "business_owner":  ( 800.0,  3000.0, 10000.0),
}

# Coarse remote / abroad bands (TND/month, USD-converted at ~3.1 TND/USD).
# Wider spread reflects the very different ceilings between low-skill (Gulf
# manual labour) and high-skill (EU/US tech contractors) remote work.
REMOTE_BANDS_TND: dict[str, tuple[float, float, float]] = {
    "student":         (    0.0,   500.0,   3000.0),  # part-time remote tutoring etc.
    "unemployed":      (    0.0,     0.0,    500.0),
    "retired":         (    0.0,   500.0,   2000.0),
    "salaried":        ( 3000.0,  9000.0,  25000.0),  # remote employee for EU/US co.
    "freelance":       ( 2500.0, 10000.0,  35000.0),  # contractor billing in USD/EUR
    "business_owner":  ( 3000.0, 12000.0,  60000.0),  # exporter / online merchant
}

# Tilt the local bands up for the capital region (higher cost of living and
# wages) and down for inland governorates. Multiplier is applied to p25/p50/p75.
GOVERNORATE_MULTIPLIERS: dict[str, float] = {
    "tunis":      1.20,
    "ariana":     1.15,
    "ben arous":  1.10,
    "manouba":    1.10,
    "nabeul":     1.00,
    "sousse":     1.05,
    "monastir":   1.05,
    "mahdia":     0.95,
    "sfax":       1.05,
    "bizerte":    1.00,
    "beja":       0.90,
    "jendouba":   0.85,
    "kef":        0.85,
    "siliana":    0.85,
    "zaghouan":   0.95,
    "kairouan":   0.90,
    "kasserine":  0.85,
    "sidi bouzid": 0.85,
    "gafsa":      0.95,
    "tozeur":     0.95,
    "kebili":     0.90,
    "gabes":      0.95,
    "medenine":   1.00,
    "tataouine":  0.95,
}

# Education multipliers — applied only to "salaried", "freelance" and
# "business_owner" categories where a higher degree has a real wage premium.
EDUCATION_MULTIPLIERS: dict[str, float] = {
    "primary":              0.80,
    "secondary":            0.90,
    "vocational":           0.95,
    "bachelor":             1.10,
    "engineer":             1.30,
    "master":               1.30,
    "phd":                  1.50,
    "doctorate":            1.50,
    "professional":         1.20,
}

# Default conversion rate cached when web search can't fetch a live one.
DEFAULT_USD_TND_RATE: float = 3.10
DEFAULT_EUR_TND_RATE: float = 3.40


def normalise_governorate(value: str | None) -> str | None:
    if not value:
        return None
    return value.strip().lower().replace("-", " ").replace("_", " ")


def normalise_education(value: str | None) -> str | None:
    if not value:
        return None
    v = value.strip().lower()
    # Map common variants to our dict keys
    if "phd" in v or "doctor" in v:
        return "phd"
    if "master" in v or "msc" in v or "m.sc" in v or "mba" in v:
        return "master"
    if "engineer" in v or "ingenieur" in v or "ingénieur" in v:
        return "engineer"
    if "bachelor" in v or "license" in v or "licence" in v or "bsc" in v:
        return "bachelor"
    if "vocational" in v or "bts" in v or "btp" in v:
        return "vocational"
    if "secondary" in v or "high school" in v or "bac" == v or "baccalaureate" in v:
        return "secondary"
    if "primary" in v or "elementary" in v:
        return "primary"
    if "professional" in v or "executive" in v:
        return "professional"
    return None


def lookup_local_band(
    occupation_category: str | None,
    governorate: str | None,
    education_level: str | None,
) -> tuple[float, float, float]:
    """Return (p25, p50, p75) local monthly TND band, applying region/edu tilts."""
    cat = (occupation_category or "salaried").lower()
    base = LOCAL_BANDS_TND.get(cat, LOCAL_BANDS_TND["salaried"])

    gov = normalise_governorate(governorate)
    gov_mult = GOVERNORATE_MULTIPLIERS.get(gov, 1.0) if gov else 1.0

    edu = normalise_education(education_level)
    edu_mult = (
        EDUCATION_MULTIPLIERS.get(edu, 1.0)
        if edu and cat in ("salaried", "freelance", "business_owner")
        else 1.0
    )

    mult = gov_mult * edu_mult
    return (base[0] * mult, base[1] * mult, base[2] * mult)


def lookup_remote_band(
    occupation_category: str | None,
    education_level: str | None,
) -> tuple[float, float, float]:
    """Return (p25, p50, p75) abroad/remote monthly TND band."""
    cat = (occupation_category or "salaried").lower()
    base = REMOTE_BANDS_TND.get(cat, REMOTE_BANDS_TND["salaried"])

    edu = normalise_education(education_level)
    edu_mult = (
        EDUCATION_MULTIPLIERS.get(edu, 1.0)
        if edu and cat in ("salaried", "freelance", "business_owner")
        else 1.0
    )
    return (base[0] * edu_mult, base[1] * edu_mult, base[2] * edu_mult)
