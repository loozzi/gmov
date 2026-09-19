/**
 * TV mode detection + resolution.
 *
 * A TV browser has no mouse/hover and is driven by a remote (arrow keys +
 * OK/Back), so the app switches to a 10-foot-friendly mode: larger type,
 * always-visible actions, strong focus ring, and arrow-key spatial nav
 * (see `components/tv/`). Resolution priority:
 *
 *   1. `?tv=1` / `?tv=0` query override (also persisted),
 *   2. previously stored choice (`localStorage`),
 *   3. TV user-agent sniffing.
 */

export const TV_STORAGE_KEY = "gmov-tv";

/** Matches Smart-TV browsers: Tizen, webOS, Android/Google TV, Fire TV… */
const TV_UA_PATTERN =
  /smart[- ]?tv|tizen|webos|googletv|android tv|aft[stkm]|viera|netcast|hbbtv|smarthub|tv browser|bravia|roku|fire tv|philips.*tv|panasonic.*tv/i;

export function isTvUserAgent(userAgent: string): boolean {
  return TV_UA_PATTERN.test(userAgent || "");
}

export interface TvResolutionInput {
  /** Raw query string, e.g. `window.location.search`. */
  search?: string;
  /** Stored choice: `"1"`, `"0"`, or null when never chosen. */
  stored?: string | null;
  /** `navigator.userAgent`. */
  userAgent?: string;
}

export interface TvResolution {
  tv: boolean;
  /** True when the result came from an explicit `?tv=` override. */
  explicit: boolean;
}

export function resolveTvMode(input: TvResolutionInput): TvResolution {
  const params = new URLSearchParams(input.search || "");
  if (params.has("tv")) {
    return { tv: params.get("tv") !== "0", explicit: true };
  }
  if (input.stored === "1") return { tv: true, explicit: false };
  if (input.stored === "0") return { tv: false, explicit: false };
  return { tv: isTvUserAgent(input.userAgent || ""), explicit: false };
}

/**
 * Pre-paint init script (same pattern as `THEME_INIT_SCRIPT`): toggles the
 * `tv-mode` class on `<html>` before first render so TV browsers don't flash
 * the desktop styling. The UA pattern here must stay in sync with
 * `TV_UA_PATTERN` above.
 */
export const TV_INIT_SCRIPT = `(function(){try{var q=new URLSearchParams(location.search);var v=q.get("tv");if(v===null){v=localStorage.getItem("${TV_STORAGE_KEY}");}if(v===null){v=/smart[- ]?tv|tizen|webos|googletv|android tv|aft[stkm]|viera|netcast|hbbtv|smarthub|tv browser|bravia|roku|fire tv|philips.*tv|panasonic.*tv/i.test(navigator.userAgent||"")?"1":"0";}if(v!==null&&v!=="0"){document.documentElement.classList.add("tv-mode");}}catch(e){}})();`;
