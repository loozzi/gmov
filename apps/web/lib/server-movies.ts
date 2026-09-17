import "server-only";

import { browsePath } from "@/lib/browse";
import type { MovieDetail, PaginatedMovies, RelatedMovies } from "@/lib/types";

const BACKEND_URL = process.env.BACKEND_URL ?? "http://localhost:8000";

async function get<T>(path: string, revalidate: number): Promise<T | null> {
  try {
    const res = await fetch(`${BACKEND_URL}${path}`, {
      next: { revalidate },
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

const LIST_REVALIDATE = 600;

export function fetchLatest(page = 1) {
  return get<PaginatedMovies>(
    `/api/v1/movies/latest?page=${page}`,
    LIST_REVALIDATE,
  );
}

export function fetchList(listType: string, page = 1) {
  return get<PaginatedMovies>(
    browsePath({ kind: "list", slug: listType }, page),
    LIST_REVALIDATE,
  );
}

export function fetchGenre(slug: string, page = 1) {
  return get<PaginatedMovies>(
    browsePath({ kind: "genre", slug }, page),
    LIST_REVALIDATE,
  );
}

export function fetchCountry(slug: string, page = 1) {
  return get<PaginatedMovies>(
    browsePath({ kind: "country", slug }, page),
    LIST_REVALIDATE,
  );
}

export function fetchYear(year: string, page = 1) {
  return get<PaginatedMovies>(
    browsePath({ kind: "year", slug: year }, page),
    LIST_REVALIDATE,
  );
}

export function fetchSearch(keyword: string, page = 1) {
  return get<PaginatedMovies>(
    browsePath({ kind: "search", keyword }, page),
    300,
  );
}

export function fetchMovieDetail(slug: string) {
  return get<MovieDetail>(`/api/v1/movies/${slug}`, 1800);
}

export function fetchRelated(slug: string, limit = 12) {
  return get<RelatedMovies>(
    `/api/v1/movies/${slug}/related?limit=${limit}`,
    1800,
  );
}

export function stripHtml(html: string | null): string {
  if (!html) return "";
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
