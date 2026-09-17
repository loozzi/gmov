"""Related movies for a detail page, computed from upstream listing data.

Upstream has no "related" endpoint, and its search does not index people
(probed 2026-09-17: searching a known actor or director returns 0 items — only
titles match). What the listing endpoints DO return is `casts`, `director` and
`year` per item, so we build a candidate pool from the current movie's own
category lists (genre/country/year), score it on shared people and metadata,
and rank. No per-candidate detail fetch is needed.

Search being title-only is still useful in one place: a name carrying a part
marker ("(Phần 2)") also searches its franchise root, which is the reliable way
to reach sibling parts.

The whole result is cached, so the ~10 upstream listing calls happen at most
once per movie per TTL.
"""

import asyncio
import re
from collections.abc import Sequence

from app.schemas.movie import (
    CandidateCard,
    CandidatePage,
    MovieCard,
    MovieDetail,
    RelatedMovies,
)
from app.services import cache, nguonc
from app.services.cache import DETAIL_TTL
from app.services.catalog_map import country_slug, genre_slug

RELATED_TTL = 1800  # 30 minutes, mirrors DETAIL_TTL
DEFAULT_LIMIT = 12
MAX_LIMIT = 24
CANDIDATE_PAGES = 3
MAX_GENRE_LISTS = 2

# Ranking weights: people are the strongest signal, then the franchise root,
# then year, then how many of the movie's genre lists the candidate appears in,
# then country.
DIRECTOR_WEIGHT = 6
CAST_WEIGHT = 3
MAX_CAST_MATCHES = 3
YEAR_WEIGHT = 2
GENRE_WEIGHT = 2
COUNTRY_WEIGHT = 1
TITLE_WEIGHT = 5

# Browse listings are ordered newest-first, so a country/genre list is mostly
# recent releases. Without this, a 2015 film's "related" rail fills up with
# 2026 titles that merely share a country. Capped so a real people/genre match
# still wins at any distance.
MAX_YEAR_PENALTY = 4

Job = tuple[str, str, int]  # (kind, key, page)

# "(Phần 2)", "[Season 3]", "Tập 12"... — the harmless tail of a franchise name.
_PART_SUFFIX = re.compile(
    r"\s*[(\[]?\s*(?:phần|phan|season|tập|tap|part)\s*\d+\s*[)\]]?",
    re.IGNORECASE,
)


def _year_of(value: str | None) -> int | None:
    text = (value or "").strip()
    return int(text) if len(text) == 4 and text.isdigit() else None


def base_title(name: str) -> str:
    """'Đế Chế Đại Hàn (Phần 2)' -> 'Đế Chế Đại Hàn', 'Foo - Tập 12' -> 'Foo'.

    Upstream search matches TITLES only, so the franchise root is the one
    reliable way to reach sibling parts. When there is no part marker the
    result is the name itself and the caller skips the search (it would only
    return the film again).
    """
    stripped = _PART_SUFFIX.sub(" ", name).strip()
    stripped = stripped.strip(" -–—:|·").strip()
    return stripped if len(stripped) >= 3 else name.strip()


def _people(value: str | None) -> set[str]:
    """Cast/director names as alphanumeric keys.

    Upstream spells the same person differently across films ("Woo Min-ho" vs
    "Woo Min Ho", "Jung Woo-sung" vs "Jung Woo Sung"), so punctuation,
    hyphens and spacing must not decide a match.
    """
    if not value:
        return set()
    names: set[str] = set()
    for chunk in value.replace(";", ",").split(","):
        key = "".join(ch for ch in chunk.casefold() if ch.isalnum())
        if key:
            names.add(key)
    return names


def candidate_jobs(detail: MovieDetail) -> list[Job]:
    jobs: list[Job] = []
    genres = [s for label in detail.genres if (s := genre_slug(label))]
    for slug in genres[:MAX_GENRE_LISTS]:
        jobs += [("genre", slug, page) for page in range(1, CANDIDATE_PAGES + 1)]
    country = next(
        (s for label in detail.countries if (s := country_slug(label))), None
    )
    if country:
        jobs += [
            ("country", country, page) for page in range(1, CANDIDATE_PAGES + 1)
        ]
    year = _year_of(detail.year)
    if year is not None:
        jobs += [("year", str(year), page) for page in range(1, CANDIDATE_PAGES + 1)]
    root = base_title(detail.name)
    if root and root != detail.name.strip():
        jobs.append(("search", root, 1))
    return jobs


def rank_candidates(
    detail: MovieDetail,
    jobs: Sequence[Job],
    pages: Sequence[CandidatePage | BaseException],
    limit: int,
) -> list[MovieCard]:
    own_directors = _people(detail.director)
    own_casts = _people(detail.casts)

    pool: dict[str, CandidateCard] = {}
    genre_hits: dict[str, set[str]] = {}
    country_hits: set[str] = set()
    title_hits: set[str] = set()

    for (kind, key, _page), page in zip(jobs, pages):
        if isinstance(page, BaseException):
            # One dead listing must not blank the whole rail.
            continue
        for card in page.items:
            if not card.slug or card.slug == detail.slug:
                continue
            pool.setdefault(card.slug, card)
            if kind == "genre":
                genre_hits.setdefault(card.slug, set()).add(key)
            elif kind == "country":
                country_hits.add(card.slug)
            elif kind == "search":
                title_hits.add(card.slug)

    scored: list[tuple[int, str, CandidateCard]] = []
    own_year = _year_of(detail.year)
    for slug, card in pool.items():
        score = DIRECTOR_WEIGHT * len(own_directors & _people(card.director))
        score += CAST_WEIGHT * min(
            len(own_casts & _people(card.casts)), MAX_CAST_MATCHES
        )
        card_year = _year_of(card.year)
        if own_year is not None and card_year is not None:
            if own_year == card_year:
                score += YEAR_WEIGHT
            else:
                score -= min(abs(own_year - card_year), MAX_YEAR_PENALTY)
        score += GENRE_WEIGHT * len(genre_hits.get(slug, ()))
        if slug in country_hits:
            score += COUNTRY_WEIGHT
        if slug in title_hits:
            score += TITLE_WEIGHT
        if score > 0:
            scored.append((score, slug, card))

    # Deterministic: strongest first, slug breaks ties so cached order is stable.
    scored.sort(key=lambda row: (-row[0], row[1]))
    top = [MovieCard.model_validate(card.model_dump()) for _, _, card in scored[:limit]]
    return top


async def related(slug: str, limit: int = DEFAULT_LIMIT) -> RelatedMovies:
    detail, _ = await cache.cached_fetch(
        cache.cache_key(f"detail:{slug}", {}),
        DETAIL_TTL,
        MovieDetail,
        lambda: nguonc.fetch_detail(slug),
    )
    limit = max(1, min(limit, MAX_LIMIT))

    jobs = candidate_jobs(detail)
    if not jobs:
        return RelatedMovies(items=[])

    # return_exceptions=True: a single dead listing is skipped in ranking.
    pages = await asyncio.gather(
        *(nguonc.fetch_candidate_page(kind, key, page) for kind, key, page in jobs),
        return_exceptions=True,
    )
    return RelatedMovies(items=rank_candidates(detail, jobs, pages, limit))
