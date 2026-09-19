"use client";

import { useEffect } from "react";

const ARROWS = new Set(["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"]);

interface Candidate {
  el: HTMLElement;
  rect: DOMRect;
}

function isVisible(el: HTMLElement): boolean {
  const rect = el.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return false;
  const style = window.getComputedStyle(el);
  if (style.visibility === "hidden" || style.display === "none") return false;
  return true;
}

function collectCandidates(): Candidate[] {
  const nodes = document.querySelectorAll<HTMLElement>(
    'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
  );
  const out: Candidate[] = [];
  for (const el of nodes) {
    if (el.getAttribute("aria-hidden") === "true") continue;
    if (!isVisible(el)) continue;
    out.push({ el, rect: el.getBoundingClientRect() });
  }
  return out;
}

interface Point {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Arrow-key spatial navigation for TV remotes: moves focus to the nearest
 * focusable element in the pressed direction. Skipped while typing (inputs
 * use arrows natively, e.g. search suggestions) and when the page already
 * consumed the key (player shortcuts call `preventDefault()`).
 */
export function TvSpatialNav({ active }: { active: boolean }) {
  useEffect(() => {
    if (!active) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (!ARROWS.has(e.key)) return;
      if (e.defaultPrevented) return;
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable)
      ) {
        return;
      }

      const current = document.activeElement as HTMLElement | null;
      const origin: Point =
        current && current !== document.body
          ? (() => {
              const r = current.getBoundingClientRect();
              return {
                x: r.left + r.width / 2,
                y: r.top + r.height / 2,
                w: r.width,
                h: r.height,
              };
            })()
          : {
              x: window.innerWidth / 2,
              y:
                e.key === "ArrowUp"
                  ? window.innerHeight
                  : e.key === "ArrowDown"
                    ? 0
                    : window.innerHeight / 2,
              w: 0,
              h: 0,
            };

      let best: Candidate | null = null;
      let bestScore = Infinity;
      for (const c of collectCandidates()) {
        if (current && c.el === current) continue;
        const cx = c.rect.left + c.rect.width / 2;
        const cy = c.rect.top + c.rect.height / 2;
        const dx = cx - origin.x;
        const dy = cy - origin.y;
        let primary: number;
        let secondary: number;
        switch (e.key) {
          case "ArrowRight":
            if (cx <= origin.x + origin.w / 2) continue;
            primary = dx;
            secondary = Math.abs(dy);
            break;
          case "ArrowLeft":
            if (cx >= origin.x - origin.w / 2) continue;
            primary = -dx;
            secondary = Math.abs(dy);
            break;
          case "ArrowDown":
            if (cy <= origin.y + origin.h / 2) continue;
            primary = dy;
            secondary = Math.abs(dx);
            break;
          default:
            if (cy >= origin.y - origin.h / 2) continue;
            primary = -dy;
            secondary = Math.abs(dx);
            break;
        }
        if (primary <= 0) continue;
        const score = primary + secondary * 2.5;
        if (score < bestScore) {
          bestScore = score;
          best = c;
        }
      }

      if (best) {
        e.preventDefault();
        best.el.focus({ preventScroll: true });
        best.el.scrollIntoView({ block: "nearest", behavior: "smooth" });
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [active]);

  return null;
}
