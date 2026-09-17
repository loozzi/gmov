"use client";

import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { useAuth } from "@/components/auth/auth-provider";
import { apiFetch } from "@/lib/api";
import {
  guestProgressPayload,
  listGuestProgress,
  removeGuestProgress,
} from "@/lib/guest-progress";
import type { PaginatedProgress } from "@/lib/me";

/**
 * Absorbs guest progress (localStorage) into the account right after login.
 * The server row wins when it is at least as fresh; otherwise the local row is
 * replayed through the normal upsert. Entries are deleted only after a
 * successful write, and a rate limit / network failure stops the loop so the
 * remainder is retried on the next login instead of being lost.
 *
 * One merge per JS context: StrictMode remounts and repeated auth transitions
 * must not double-write.
 */
let mergeInFlight: Promise<boolean> | null = null;

async function mergeGuestProgress(): Promise<boolean> {
  const entries = listGuestProgress();
  if (entries.length === 0) return false;

  let serverRows: Map<string, string>;
  try {
    const page = await apiFetch<PaginatedProgress>(
      "/api/v1/me/continue-watching?page=1&per_page=100",
    );
    serverRows = new Map(
      page.items.map((row) => [row.movie_slug, row.updated_at]),
    );
  } catch {
    // Offline or auth hiccup: keep every local entry for the next login.
    return false;
  }

  let merged = false;
  for (const entry of entries) {
    const serverAt = serverRows.get(entry.movie_slug);
    const serverMs = serverAt ? Date.parse(serverAt) : Number.NaN;
    const localMs = Date.parse(entry.updated_at);
    if (!Number.isNaN(serverMs) && serverMs >= localMs) {
      // The account already knows more than this device does.
      removeGuestProgress(entry.movie_slug);
      continue;
    }
    try {
      await apiFetch("/api/v1/me/progress", {
        method: "PUT",
        body: JSON.stringify(guestProgressPayload(entry)),
      });
      removeGuestProgress(entry.movie_slug);
      merged = true;
    } catch {
      // 429 / offline mid-loop: leave the rest untouched and try again later.
      break;
    }
  }
  return merged;
}

export function GuestProgressMerge() {
  const { isAuthenticated } = useAuth();
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!isAuthenticated) return;
    if (!mergeInFlight) mergeInFlight = mergeGuestProgress();
    void mergeInFlight.then((merged) => {
      mergeInFlight = null;
      if (merged) void queryClient.invalidateQueries({ queryKey: ["me"] });
    });
  }, [isAuthenticated, queryClient]);

  return null;
}
