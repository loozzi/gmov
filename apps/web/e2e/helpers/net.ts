/**
 * Visible fail-open for external networks. Datacenter CI runners are
 * routinely blocked by the upstream CDN / sample-stream host — failures there
 * say nothing about our code, so data-dependent specs SKIP (reported, not
 * silent) instead of going red. Auth specs never skip: they only touch
 * services we own.
 */
import { test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { E2E_DIR } from "./api";

function probe(): { upstream: boolean; mux: boolean } {
  try {
    const raw = JSON.parse(readFileSync(join(E2E_DIR, ".probe.json"), "utf8"));
    return { upstream: raw.upstream !== false, mux: raw.mux !== false };
  } catch {
    // Setup always writes .probe.json; default to running.
    return { upstream: true, mux: true };
  }
}

export function skipIfNoUpstream(): void {
  test.skip(
    !probe().upstream,
    "upstream CDN unreachable from this runner",
  );
}

export function skipIfNoMux(): void {
  test.skip(!probe().mux, "sample HLS stream unreachable from this runner");
}
