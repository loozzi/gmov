import {
  COUNTRIES,
  GENRES,
  LIST_TYPES,
  YEARS,
  type CatalogEntry,
} from "@/lib/catalog";

/**
 * Which listing a browse page shows. Serializable, so a server page can hand
 * it to the client island that owns infinite scrolling.
 */
export type BrowseSource =
  | { kind: "genre"; slug: string }
  | { kind: "country"; slug: string }
  | { kind: "year"; slug: string }
  | { kind: "list"; slug: string }
  | { kind: "search"; keyword: string };

/** Backend path: used directly by SSR fetches, and same-origin by the client. */
export function browsePath(source: BrowseSource, page: number): string {
  switch (source.kind) {
    case "genre":
      return `/api/v1/movies/genre/${encodeURIComponent(source.slug)}?page=${page}`;
    case "country":
      return `/api/v1/movies/country/${encodeURIComponent(source.slug)}?page=${page}`;
    case "year":
      return `/api/v1/movies/year/${encodeURIComponent(source.slug)}?page=${page}`;
    case "list":
      return `/api/v1/movies/list/${encodeURIComponent(source.slug)}?page=${page}`;
    case "search":
      return `/api/v1/movies/search?keyword=${encodeURIComponent(source.keyword)}&page=${page}`;
  }
}

/** Web URL for a page — the no-JS / crawler fallback link of a browse grid. */
export function browseHref(source: BrowseSource, page: number): string {
  switch (source.kind) {
    case "genre":
      return `/the-loai/${encodeURIComponent(source.slug)}?page=${page}`;
    case "country":
      return `/quoc-gia/${encodeURIComponent(source.slug)}?page=${page}`;
    case "year":
      return `/nam/${encodeURIComponent(source.slug)}?page=${page}`;
    case "list":
      return `/list/${encodeURIComponent(source.slug)}?page=${page}`;
    case "search":
      return `/tim-kiem?keyword=${encodeURIComponent(source.keyword)}&page=${page}`;
  }
}

export interface BrowseChip {
  label: string;
  href: string;
  active: boolean;
}

/** Entries of the same dimension, for the quick switch. Empty for search. */
export function browseChips(source: BrowseSource): BrowseChip[] {
  let entries: CatalogEntry[];
  let base: string;
  let current: string;
  switch (source.kind) {
    case "genre":
      entries = GENRES;
      base = "/the-loai";
      current = source.slug;
      break;
    case "country":
      entries = COUNTRIES;
      base = "/quoc-gia";
      current = source.slug;
      break;
    case "year":
      entries = YEARS;
      base = "/nam";
      current = source.slug;
      break;
    case "list":
      entries = LIST_TYPES;
      base = "/list";
      current = source.slug;
      break;
    case "search":
      return [];
  }
  return entries.map((entry) => ({
    label: entry.label,
    href: `${base}/${entry.slug}`,
    active: entry.slug === current,
  }));
}
