"""Tavily web-search wrapper shared by all layers that need live data.

Originally inlined inside `consistency.py`. Extracted so that
`income_plausibility` can call it too without duplicating the API client.
Returns a plain text snippet — the caller is responsible for parsing.
"""

from __future__ import annotations

import logging

import httpx

from klaro_ml.settings import get_settings

logger = logging.getLogger(__name__)


def web_search(query: str, max_results: int = 3) -> str:
    """Run one Tavily search. Returns a multi-line snippet, or a sentinel
    string starting with `[skipped]` / `[error]` when the call did not run.
    """
    settings = get_settings()
    api_key = settings.TAVILY_API_KEY
    if not api_key:
        return f"[skipped] no TAVILY_API_KEY set, query was: {query}"

    try:
        resp = httpx.post(
            "https://api.tavily.com/search",
            json={
                "api_key": api_key,
                "query": query,
                "search_depth": "basic",
                "max_results": max_results,
            },
            timeout=10.0,
        )
        if resp.status_code != 200:
            return f"[error] tavily HTTP {resp.status_code}"
        data = resp.json()
        results = data.get("results", []) or []
        if not results:
            return "[empty] no results."
        snippets = [
            f"- {(r.get('title') or '')}: {(r.get('content') or '')[:300]}"
            for r in results
        ]
        return "\n".join(snippets)
    except Exception as exc:
        logger.warning("tavily search failed: %s", exc)
        return f"[error] {exc}"
