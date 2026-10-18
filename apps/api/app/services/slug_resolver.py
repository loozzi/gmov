"""Follow upstream slug renames (e.g. `bac-si-x-phan-1` -> `bac-si-x`).

NguonC occasionally re-slugs a title (typically an airing series renamed when
new episodes land); the old slug then 404s and every stored reference to it
(watch history, favorites, ...) dead-ends. Upstream has no redirect, so we use
what we stored about the old slug (name + poster) to find it again via search:
a matching poster URL is decisive, otherwise a unique exact-name match.

Once found, profile data is moved to the new slug so it stays correct even
without the redirect.
"""

import logging
import re
import unicodedata

from sqlalchemy import delete, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import AppException
from app.db.models.catalog_item import CatalogItem
from app.db.models.watch_progress import WatchProgress
from app.db.session import get_redis_client
from app.services import nguonc

logger = logging.getLogger("gmov.slug_resolver")

FOUND_TTL = 86400  # 24h
MISS_TTL = 3600  # 1h: don't re-search upstream on every 404 hit

# Tables referencing a movie by slug, with the columns (besides movie_slug)
# of their unique key. Empty key = no uniqueness, rename everything.
SLUG_TABLES: dict[str, tuple[str, ...]] = {
    "watch_progress": ("profile_id", "episode_slug"),
    "favorites": ("profile_id",),
    "watchlist": ("profile_id",),
    "ratings": ("profile_id",),
    "recommendation_feedback": ("profile_id",),
    "comments": (),
}

_SEASON_SUFFIX = re.compile(r"\s*\((phần|season|mùa)\s*\d+\)\s*$", re.IGNORECASE)


def _norm(name: str) -> str:
    name = _SEASON_SUFFIX.sub("", name)
    name = unicodedata.normalize("NFC", name).casefold()
    return re.sub(r"\s+", " ", name).strip()


async def _hints(db: AsyncSession, slug: str) -> tuple[set[str], set[str]]:
    """(normalized names, image URLs) we know for `slug`."""
    names: set[str] = set()
    images: set[str] = set()
    rows = await db.execute(
        select(WatchProgress.movie_name, WatchProgress.poster_url)
        .where(WatchProgress.movie_slug == slug)
        .limit(1)
    )
    for name, poster in rows:
        names.add(name)
        images.add(poster or "")
    item = await db.get(CatalogItem, slug)
    if item is not None:
        names.add(item.name)
        images.update({item.poster_url, item.thumb_url})
    images.discard("")
    return {n for n in names if n.strip()}, images


async def _search(slug: str, names: set[str], images: set[str]) -> str | None:
    by_name: set[str] = set()
    wanted = {_norm(n) for n in names}
    for keyword in wanted:
        try:
            page = await nguonc.search(keyword)
        except AppException:
            continue
        for card in page.items:
            if card.slug == slug:
                continue
            if images & {card.poster_url, card.thumb_url}:
                return card.slug
            if _norm(card.name) in wanted:
                by_name.add(card.slug)
    return by_name.pop() if len(by_name) == 1 else None


async def migrate(db: AsyncSession, old: str, new: str) -> None:
    """Move profile data from `old` to `new`; rows already present under
    `new` win (they are the newer activity)."""
    for table, key in SLUG_TABLES.items():
        clash = "".join(f" AND n.{c} = {table}.{c}" for c in key)
        params = {"old": old, "new": new}
        if key:
            await db.execute(
                text(
                    f"DELETE FROM {table} WHERE movie_slug = :old AND EXISTS "
                    f"(SELECT 1 FROM {table} n WHERE n.movie_slug = :new{clash})"
                ),
                params,
            )
        await db.execute(
            text(f"UPDATE {table} SET movie_slug = :new WHERE movie_slug = :old"),
            params,
        )
    await db.execute(delete(CatalogItem).where(CatalogItem.slug == old))
    await db.commit()


async def resolve(db: AsyncSession, slug: str) -> str | None:
    """New slug for a renamed `slug`, or None if unknown/unresolvable."""
    redis = get_redis_client()
    key = f"slug_alias:{slug}"
    try:
        cached = await redis.get(key)
    except Exception:  # redis down: just resolve uncached
        cached = None
    if cached is not None:
        value = cached.decode() if isinstance(cached, bytes) else cached
        return value or None

    names, images = await _hints(db, slug)
    new = await _search(slug, names, images) if names else None
    if new:
        logger.info("slug renamed upstream: %s -> %s", slug, new)
        await migrate(db, slug, new)
    try:
        await redis.set(key, new or "", ex=FOUND_TTL if new else MISS_TTL)
    except Exception:
        pass
    return new
