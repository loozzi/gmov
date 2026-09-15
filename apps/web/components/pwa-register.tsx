"use client";

import { useEffect } from "react";

/** Register the app-shell service worker (production only, once). */
export function PwaRegister() {
  useEffect(() => {
    if (
      process.env.NODE_ENV !== "production" ||
      !("serviceWorker" in navigator)
    ) {
      return;
    }
    void navigator.serviceWorker.register("/sw.js").catch(() => {
      // Offline support is best-effort; the app works fine without it.
    });
  }, []);
  return null;
}
