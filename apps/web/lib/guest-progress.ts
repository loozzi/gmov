"use client";

import { useMemo, useSyncExternalStore } from "react";

/**
 * Progress for viewers who are not logged in. Kept in localStorage under a
 * versioned key so a shape change can be shipped without migrating old data.
 * This module is the single writer: components never touch localStorage
 * directly, which keeps snapshot identity stable for useSyncExternalStore.
 */
export interface GuestProgressEntry {
  movie_slug: string;
  movie_name: string;
  poster_url: string | null;
  episode_slug: string;
  episode_name: string;
  server_name: string | null;
  episode_index: number | null;
  total_episodes: number | null;
  position_seconds: number;
  duration_seconds: number | null;
  updated_at: string;
}

export type GuestProgressInput = Omit<GuestProgressEntry, "updated_at">;

export type GuestProgressStore = Record<string, GuestProgressEntry>;

export const GUEST_PROGRESS_KEY = "gmov:progress:v1";

// Enough history to be useful, small enough to stay far from the 5MB quota.
const MAX_ENTRIES = 50;

const EMPTY: GuestProgressStore = Object.freeze({});

let cache: GuestProgressStore | null = null;
const listeners = new Set<() => void>();
let storageBound = false;

function isEntry(value: unknown): value is GuestProgressEntry {
  if (!value || typeof value !== "object") return false;
  const entry = value as Record<string, unknown>;
  return (
    typeof entry.movie_slug === "string" &&
    typeof entry.movie_name === "string" &&
    typeof entry.episode_slug === "string" &&
    typeof entry.episode_name === "string" &&
    typeof entry.updated_at === "string"
  );
}

function parse(raw: string | null): GuestProgressStore {
  if (!raw) return EMPTY;
  try {
    const data = JSON.parse(raw) as unknown;
    if (!data || typeof data !== "object" || Array.isArray(data)) return EMPTY;
    const out: GuestProgressStore = {};
    for (const [slug, value] of Object.entries(
      data as Record<string, unknown>,
    )) {
      if (isEntry(value)) out[slug] = value;
    }
    return out;
  } catch {
    // Corrupt payload: start clean rather than crash every render.
    return EMPTY;
  }
}

function read(): GuestProgressStore {
  if (typeof window === "undefined") return EMPTY;
  try {
    return parse(window.localStorage.getItem(GUEST_PROGRESS_KEY));
  } catch {
    // Private mode can throw on access.
    return EMPTY;
  }
}

function bindStorage() {
  if (storageBound || typeof window === "undefined") return;
  storageBound = true;
  window.addEventListener("storage", (event) => {
    if (event.key !== null && event.key !== GUEST_PROGRESS_KEY) return;
    cache = read();
    listeners.forEach((listener) => listener());
  });
}

function getSnapshot(): GuestProgressStore {
  if (cache === null) cache = read();
  return cache;
}

function getServerSnapshot(): GuestProgressStore {
  return EMPTY;
}

function subscribe(listener: () => void): () => void {
  bindStorage();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function commit(next: GuestProgressStore) {
  cache = next;
  if (typeof window !== "undefined") {
    try {
      if (Object.keys(next).length === 0) {
        window.localStorage.removeItem(GUEST_PROGRESS_KEY);
      } else {
        window.localStorage.setItem(GUEST_PROGRESS_KEY, JSON.stringify(next));
      }
    } catch {
      // Quota / private mode: keep the in-memory copy so this tab still works.
    }
  }
  listeners.forEach((listener) => listener());
}

/** Keep the newest MAX_ENTRIES by updated_at (ISO strings sort lexically). */
function prune(store: GuestProgressStore): GuestProgressStore {
  const entries = Object.entries(store);
  if (entries.length <= MAX_ENTRIES) return store;
  entries.sort((a, b) => b[1].updated_at.localeCompare(a[1].updated_at));
  return Object.fromEntries(entries.slice(0, MAX_ENTRIES));
}

export function getGuestProgress(movieSlug: string): GuestProgressEntry | null {
  return getSnapshot()[movieSlug] ?? null;
}

export function listGuestProgress(): GuestProgressEntry[] {
  return Object.values(getSnapshot()).sort((a, b) =>
    b.updated_at.localeCompare(a.updated_at),
  );
}

export function saveGuestProgress(
  input: GuestProgressInput,
): GuestProgressEntry {
  const entry: GuestProgressEntry = {
    ...input,
    updated_at: new Date().toISOString(),
  };
  commit(prune({ ...getSnapshot(), [entry.movie_slug]: entry }));
  return entry;
}

export function removeGuestProgress(movieSlug: string): void {
  const current = getSnapshot();
  if (!(movieSlug in current)) return;
  const next = { ...current };
  delete next[movieSlug];
  commit(next);
}

export function clearGuestProgress(): void {
  if (Object.keys(getSnapshot()).length === 0) return;
  commit({});
}

/** The payload the API expects — everything but the local bookkeeping field. */
export function guestProgressPayload(
  entry: GuestProgressEntry,
): GuestProgressInput {
  return {
    movie_slug: entry.movie_slug,
    movie_name: entry.movie_name,
    poster_url: entry.poster_url,
    episode_slug: entry.episode_slug,
    episode_name: entry.episode_name,
    server_name: entry.server_name,
    episode_index: entry.episode_index,
    total_episodes: entry.total_episodes,
    position_seconds: entry.position_seconds,
    duration_seconds: entry.duration_seconds,
  };
}

export function useGuestProgressStore(): GuestProgressStore {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

export function useGuestProgressList(): GuestProgressEntry[] {
  const store = useGuestProgressStore();
  return useMemo(
    () =>
      Object.values(store).sort((a, b) =>
        b.updated_at.localeCompare(a.updated_at),
      ),
    [store],
  );
}

export function useGuestProgressEntry(
  movieSlug: string,
): GuestProgressEntry | null {
  const store = useGuestProgressStore();
  return store[movieSlug] ?? null;
}
