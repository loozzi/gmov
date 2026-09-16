"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

import { cn } from "@/lib/utils";

interface Props {
  children: ReactNode;
  /** Stagger in ms, e.g. `index * 60` when mapping a list of sections. */
  delay?: number;
  className?: string;
}

/**
 * Fades content up as it scrolls into view.
 *
 * Content renders visible by default, so it is never lost without JS or with
 * reduced motion: only elements below the fold are hidden, and only after
 * mount when the user has not opted out of motion.
 */
export function Reveal({ children, delay = 0, className }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    // Above the fold already: never hide it, or the user sees a flash.
    if (el.getBoundingClientRect().top < window.innerHeight * 0.9) return;

    setHidden(true);
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setHidden(false);
          observer.disconnect();
        }
      },
      { rootMargin: "0px 0px -10% 0px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      style={delay ? { transitionDelay: `${delay}ms` } : undefined}
      className={cn(
        "ease-emphasized transition-[opacity,transform] duration-500 motion-reduce:transition-none",
        hidden && "translate-y-3 opacity-0",
        className,
      )}
    >
      {children}
    </div>
  );
}
