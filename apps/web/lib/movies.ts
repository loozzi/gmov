"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";

import { apiFetch } from "@/lib/api";
import type { MovieDetail, PaginatedMovies } from "@/lib/types";

export function useLatest(page: number) {
  return useQuery({
    queryKey: ["movies", "latest", page],
    queryFn: () => apiFetch<PaginatedMovies>(`/api/v1/movies/latest?page=${page}`, { auth: false }),
    placeholderData: keepPreviousData,
  });
}

export function useList(listType: string, page: number) {
  return useQuery({
    queryKey: ["movies", "list", listType, page],
    queryFn: () =>
      apiFetch<PaginatedMovies>(`/api/v1/movies/list/${listType}?page=${page}`, { auth: false }),
    placeholderData: keepPreviousData,
  });
}

export function useGenre(slug: string, page: number) {
  return useQuery({
    queryKey: ["movies", "genre", slug, page],
    queryFn: () =>
      apiFetch<PaginatedMovies>(`/api/v1/movies/genre/${slug}?page=${page}`, { auth: false }),
    placeholderData: keepPreviousData,
  });
}

export function useCountry(slug: string, page: number) {
  return useQuery({
    queryKey: ["movies", "country", slug, page],
    queryFn: () =>
      apiFetch<PaginatedMovies>(`/api/v1/movies/country/${slug}?page=${page}`, { auth: false }),
    placeholderData: keepPreviousData,
  });
}

export function useYear(year: string, page: number) {
  return useQuery({
    queryKey: ["movies", "year", year, page],
    queryFn: () =>
      apiFetch<PaginatedMovies>(`/api/v1/movies/year/${year}?page=${page}`, { auth: false }),
    placeholderData: keepPreviousData,
  });
}

export function useSearch(keyword: string, page: number) {
  return useQuery({
    queryKey: ["movies", "search", keyword, page],
    queryFn: () =>
      apiFetch<PaginatedMovies>(
        `/api/v1/movies/search?keyword=${encodeURIComponent(keyword)}&page=${page}`,
        { auth: false },
      ),
    placeholderData: keepPreviousData,
    enabled: keyword.trim().length > 0,
  });
}

export function useMovieDetail(slug: string) {
  return useQuery({
    queryKey: ["movies", "detail", slug],
    queryFn: () => apiFetch<MovieDetail>(`/api/v1/movies/${slug}`, { auth: false }),
  });
}
