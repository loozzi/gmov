"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

import { TvSpatialNav } from "@/components/tv/tv-spatial-nav";
import { TV_STORAGE_KEY, resolveTvMode } from "@/lib/tv";

interface TvContextValue {
  tv: boolean;
  setTvMode: (on: boolean) => void;
}

const TvContext = createContext<TvContextValue>({
  tv: false,
  setTvMode: () => {},
});

export function useTv(): TvContextValue {
  return useContext(TvContext);
}

/**
 * Resolves TV mode on mount (`?tv=` → stored choice → UA sniff, see
 * `lib/tv.ts`) and keeps the `tv-mode` class on `<html>` in sync. The
 * pre-paint `TV_INIT_SCRIPT` in the root layout already applied the class
 * for the first render; this only reconciles React state with it.
 */
export function TvProvider({ children }: { children: ReactNode }) {
  const [tv, setTv] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    let stored: string | null = null;
    try {
      stored = window.localStorage.getItem(TV_STORAGE_KEY);
    } catch {
      stored = null;
    }
    const resolved = resolveTvMode({
      search: params.toString(),
      stored,
      userAgent: window.navigator.userAgent,
    });
    if (resolved.explicit) {
      try {
        window.localStorage.setItem(TV_STORAGE_KEY, resolved.tv ? "1" : "0");
      } catch {
        /* private mode — session-only */
      }
    }
    setTv(resolved.tv);
    document.documentElement.classList.toggle("tv-mode", resolved.tv);
  }, []);

  const setTvMode = useCallback((on: boolean) => {
    try {
      window.localStorage.setItem(TV_STORAGE_KEY, on ? "1" : "0");
    } catch {
      /* private mode — session-only */
    }
    setTv(on);
    document.documentElement.classList.toggle("tv-mode", on);
  }, []);

  return (
    <TvContext.Provider value={{ tv, setTvMode }}>
      <TvSpatialNav active={tv} />
      {children}
    </TvContext.Provider>
  );
}
