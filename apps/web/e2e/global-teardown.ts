/**
 * Global teardown: best-effort cleanup of data created by this run's account
 * (progress rows + favorites). The user row itself stays — there is no
 * delete-account endpoint, and one row per run is harmless.
 */
import { readFile } from "node:fs/promises";

import { LAST_USER_FILE, api, authHeaders, loginUser } from "./helpers/api";

export default async function globalTeardown() {
  try {
    const account = JSON.parse(await readFile(LAST_USER_FILE, "utf8"));
    const { access_token } = await loginUser(account);
    const h = authHeaders(access_token);
    const cw = await api("/api/v1/me/continue-watching", { headers: h });
    for (const item of cw.items ?? []) {
      await api(`/api/v1/me/progress/${item.movie_slug}`, {
        method: "DELETE",
        headers: h,
      });
    }
    const favs = await api("/api/v1/me/favorites", { headers: h });
    for (const item of favs.items ?? []) {
      await api(`/api/v1/me/favorites/${item.movie_slug}`, {
        method: "DELETE",
        headers: h,
      });
    }
    console.log("[teardown] progress + favorites cleaned");
  } catch (e) {
    console.log(`[teardown] best-effort cleanup failed: ${String(e)}`);
  }
}
