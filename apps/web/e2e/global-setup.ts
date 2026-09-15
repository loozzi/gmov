/**
 * Global setup: ensure backend is up, then provide exactly ONE test account
 * for the whole run (register is throttled 3/hour/IP server-side).
 *
 * Reuses `.last-user.json` across runs when its login still works, so local
 * re-runs don't burn the throttle budget. Browser login is NOT done here:
 * refresh rotation invalidates a cookie on first use, so each spec logs in
 * fresh via loginViaApi() (helpers/auth.ts).
 */
import { execFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

import {
  E2E_DIR,
  LAST_USER_FILE,
  loginUser,
  probeMux,
  probeUpstream,
  registerUser,
  waitForBackend,
} from "./helpers/api";

const sh = promisify(execFile);

/**
 * Reset the login/register throttle so every run starts from a clean
 * anti-spam budget. This touches TEST-ENV STATE ONLY (redis keys), never
 * product code or limits — both throttles were verified live blocking
 * correctly. Best-effort: if docker isn't available the run proceeds and
 * may trip the limiters honestly.
 */
async function resetThrottle(): Promise<void> {
  try {
    const root = resolve(LAST_USER_FILE, "..", "..", "..", "..");
    const base = [
      "compose",
      "--project-directory",
      root,
      "exec",
      "-T",
      "redis",
      "redis-cli",
    ];
    const { stdout } = await sh(
      "docker",
      [...base, "--scan", "--pattern", "ratelimit:*"],
      {
        timeout: 30_000,
      },
    );
    const keys = stdout
      .split("\n")
      .map((k) => k.trim())
      .filter(Boolean);
    if (keys.length > 0) {
      await sh("docker", [...base, "DEL", ...keys], { timeout: 30_000 });
    }
    console.log(`[setup] throttle reset (${keys.length} keys)`);
  } catch (e) {
    console.log(`[setup] throttle reset skipped: ${String(e).slice(0, 120)}`);
  }
}

function freshAccount() {
  const stamp = Date.now().toString(36);
  return {
    email: `e2e-${stamp}@gmov.dev`,
    username: `e2e_${stamp}`,
    password: "E2e-password-123",
  };
}

async function tryLogin(acc: {
  email: string;
  username: string;
  password: string;
}): Promise<boolean> {
  try {
    await loginUser(acc);
    return true;
  } catch {
    return false;
  }
}

export default async function globalSetup(): Promise<void> {
  await waitForBackend();
  await resetThrottle();

  // External-network probes, ALWAYS written (before any early return below).
  // Datacenter runners are routinely blocked by the upstream CDN, so
  // data-dependent specs skip (visibly) instead of failing on something
  // outside our code. E2E_NET=down forces the skip path locally.
  const forcedDown = process.env.E2E_NET === "down";
  const [upstream, mux] = forcedDown
    ? [false, false]
    : await Promise.all([probeUpstream(), probeMux()]);
  await writeFile(join(E2E_DIR, ".probe.json"), JSON.stringify({ upstream, mux }));
  console.log(`[setup] external nets: upstream=${upstream} mux=${mux}`);

  try {
    const saved = JSON.parse(await readFile(LAST_USER_FILE, "utf8"));
    if (saved?.username && saved?.password && (await tryLogin(saved))) {
      console.log(`[setup] reusing test account ${saved.username}`);
      return;
    }
  } catch {
    // no usable saved account
  }

  const account = freshAccount();
  await registerUser(account);
  await writeFile(LAST_USER_FILE, JSON.stringify(account));
  console.log(`[setup] registered test account ${account.username}`);
}
