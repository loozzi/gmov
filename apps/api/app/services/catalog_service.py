"""Snapshot of upstream listings (genre/country/year) for recommendations.

Mirrors the fan-out pattern of `related_service`: every listing page is
gathered with `return_exceptions=True`, so one dead listing only logs + counts
instead of blanking the whole refresh. Cards are staged in memory (dedupe by
slug, union genres), then upserted, so an item that appears in several
listings yields one row with the metadata of all of them.

`kinds` entries are listing keys: a genre slug, a country slug, or a 4-digit
year. `source` records the originating listing as `"<kind>:<key>"`.
"""

import asyncio
import logging
import uuid
from collections.abc import Sequence
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.interval import IntervalTrigger
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.db.models.catalog_item import CatalogItem
from app.db.session import get_redis_client, session_factory
from app.schemas.movie import CandidateCard
from app.services import nguonc
from app.services.catalog_map import COUNTRY_SLUGS, GENRE_SLUGS

logger = logging.getLogger("gmov.catalog")

YEARS: tuple[int, ...] = tuple(range(2016, 2027))
GENRE_SET = frozenset(GENRE_SLUGS.values())
COUNTRY_SET = frozenset(COUNTRY_SLUGS.values())

LOCK_KEY = "catalog:refresh:lock"
LOCK_TTL_SECONDS = 300
JOB_ID = "catalog_refresh"


@dataclass
class RefreshStats:
    listings_ok: int = 0
    listings_failed: int = 0
    items_upserted: int = 0


@dataclass
class _Staged:
    slug: str
    name: str = ""
    original_name: str | None = None
    poster_url: str = ""
    thumb_url: str = ""
    year: int | None = None
    genres: set[str] = field(default_factory=set)
    country: str | None = None
    casts: str | None = None
    director: str | None = None
    source: str = ""


def _year_of(value: str | None) -> int | None:
    text = (value or "").strip()
    return int(text) if len(text) == 4 and text.isdigit() else None


def _kind_of(key: str) -> str | None:
    if key in GENRE_SET:
        return "genre"
    if key in COUNTRY_SET:
        return "country"
    if len(key) == 4 and key.isdigit():
        return "year"
    return None


def _default_kinds() -> list[str]:
    return [
        *GENRE_SLUGS.values(),
        *COUNTRY_SLUGS.values(),
        *(str(year) for year in YEARS),
    ]


def _jobs(kinds: Sequence[str], pages: int) -> list[tuple[str, str, int]]:
    jobs: list[tuple[str, str, int]] = []
    for key in kinds:
        kind = _kind_of(key)
        if kind is None:
            logger.warning("catalog: skipping unknown listing key %r", key)
            continue
        jobs += [(kind, key, page) for page in range(1, pages + 1)]
    return jobs


def _stage(
    staged: dict[str, _Staged],
    kind: str,
    key: str,
    card: CandidateCard,
) -> None:
    if not card.slug:
        return
    entry = staged.get(card.slug)
    if entry is None:
        entry = _Staged(slug=card.slug, source=f"{kind}:{key}")
        staged[card.slug] = entry
    if card.name:
        entry.name = card.name
    if card.original_name:
        entry.original_name = card.original_name
    if card.poster_url:
        entry.poster_url = card.poster_url
    if card.thumb_url:
        entry.thumb_url = card.thumb_url
    if card.casts:
        entry.casts = card.casts
    if card.director:
        entry.director = card.director
    if entry.year is None:
        own = _year_of(card.year)
        if own is not None:
            entry.year = own
        elif kind == "year":
            entry.year = _year_of(key)
    if kind == "genre":
        entry.genres.add(key)
    elif kind == "country" and entry.country is None:
        entry.country = key


async def _upsert(db: AsyncSession, staged: dict[str, _Staged]) -> int:
    if not staged:
        return 0
    now = datetime.now(UTC)
    existing = {
        row.slug: row
        for row in (
            await db.execute(
                select(CatalogItem).where(CatalogItem.slug.in_(list(staged)))
            )
        ).scalars()
    }
    for slug, data in staged.items():
        row = existing.get(slug)
        if row is None:
            row = CatalogItem(slug=slug)
            db.add(row)
        row.name = data.name
        row.original_name = data.original_name
        row.poster_url = data.poster_url
        row.thumb_url = data.thumb_url
        row.genres = sorted(data.genres)
        row.source = data.source
        row.fetched_at = now
        if data.year is not None:
            row.year = data.year
        if data.country is not None:
            row.country = data.country
        if data.casts is not None:
            row.casts = data.casts
        if data.director is not None:
            row.director = data.director
    await db.commit()
    return len(staged)


async def refresh(
    db: AsyncSession,
    *,
    kinds: Sequence[str] | None = None,
    pages: int = 1,
) -> RefreshStats:
    keys = list(kinds) if kinds is not None else _default_kinds()
    jobs = _jobs(keys, max(1, pages))
    stats = RefreshStats()

    results = await asyncio.gather(
        *(nguonc.fetch_candidate_page(kind, key, page) for kind, key, page in jobs),
        return_exceptions=True,
    )

    staged: dict[str, _Staged] = {}
    for (kind, key, page), result in zip(jobs, results):
        if isinstance(result, BaseException):
            stats.listings_failed += 1
            logger.warning(
                "catalog listing failed: %s:%s page %d (%s)",
                kind,
                key,
                page,
                result,
            )
            continue
        stats.listings_ok += 1
        for card in result.items:
            _stage(staged, kind, key, card)

    stats.items_upserted = await _upsert(db, staged)
    logger.info(
        "catalog refresh: %d items (%d listings ok, %d failed)",
        stats.items_upserted,
        stats.listings_ok,
        stats.listings_failed,
    )
    return stats


async def is_stale(db: AsyncSession, ttl_hours: int) -> bool:
    latest = (await db.execute(select(func.max(CatalogItem.fetched_at)))).scalar()
    if latest is None:
        return True
    if latest.tzinfo is None:
        latest = latest.replace(tzinfo=UTC)
    return datetime.now(UTC) - latest > timedelta(hours=ttl_hours)


async def list_items(
    db: AsyncSession, *, limit: int | None = None
) -> list[CatalogItem]:
    stmt = select(CatalogItem).order_by(CatalogItem.slug)
    if limit is not None:
        stmt = stmt.limit(limit)
    return list((await db.execute(stmt)).scalars().all())


async def by_slugs(db: AsyncSession, slugs: Sequence[str]) -> list[CatalogItem]:
    wanted = list(slugs)
    if not wanted:
        return []
    rows = (
        await db.execute(select(CatalogItem).where(CatalogItem.slug.in_(wanted)))
    ).scalars()
    found = {row.slug: row for row in rows}
    return [found[slug] for slug in wanted if slug in found]


async def count(db: AsyncSession) -> int:
    total = (await db.execute(select(func.count()).select_from(CatalogItem))).scalar()
    return int(total or 0)


async def run_with_lock() -> RefreshStats | None:
    try:
        acquired = await get_redis_client().set(
            LOCK_KEY, str(uuid.uuid4()), nx=True, ex=LOCK_TTL_SECONDS
        )
    except Exception as exc:
        logger.warning("catalog refresh skipped (redis unavailable): %s", exc)
        return None
    if not acquired:
        logger.info("catalog refresh skipped (another worker holds the lock)")
        return None
    try:
        async with session_factory() as db:
            if not await is_stale(db, settings.catalog_ttl_hours):
                logger.info("catalog refresh skipped (snapshot fresh)")
                return None
            return await refresh(db, pages=settings.catalog_refresh_pages)
    except Exception as exc:
        logger.warning("catalog refresh failed: %s", exc)
        return None


async def warm_up_if_empty() -> None:
    try:
        async with session_factory() as db:
            if await count(db) > 0:
                return
        await run_with_lock()
    except Exception as exc:
        logger.warning("catalog warm-up skipped: %s", exc)


def schedule_catalog_jobs(scheduler: AsyncIOScheduler) -> None:
    scheduler.add_job(
        run_with_lock,
        IntervalTrigger(minutes=settings.catalog_refresh_interval_minutes),
        id=JOB_ID,
        max_instances=1,
        coalesce=True,
    )
    scheduler.add_job(
        warm_up_if_empty,
        id=f"{JOB_ID}_warmup",
        next_run_time=datetime.now(UTC),
        max_instances=1,
    )
