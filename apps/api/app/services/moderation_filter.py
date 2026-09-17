"""Keyword filter for comments (auto-moderation).

Pure functions: the caller (`comment_service.create`) decides what to do with a
match. Matching is case-, accent- and whitespace-insensitive, so a configured
"cá độ" also catches "CA DO" and "cá   độ" (Vietnamese spam is often typed
without diacritics). Deliberately NOT handled: character-level obfuscation
("s.p.a.m", zero-width joins) — that needs heuristics far beyond a blocklist.
"""

import unicodedata
from collections.abc import Sequence


def normalize(text: str) -> str:
    """Casefold, strip diacritics, collapse runs of whitespace."""
    decomposed = unicodedata.normalize("NFD", text.casefold())
    stripped = "".join(ch for ch in decomposed if not unicodedata.combining(ch))
    # Vietnamese đ/Đ does not decompose into d + a combining mark.
    return " ".join(stripped.replace("đ", "d").split())


def matched_keywords(body: str, keywords: Sequence[str]) -> list[str]:
    """Configured keywords present in `body`, in configuration order."""
    haystack = normalize(body)
    if not haystack:
        return []
    hits: list[str] = []
    for keyword in keywords:
        needle = normalize(keyword)
        if needle and needle in haystack:
            hits.append(keyword)
    return hits
