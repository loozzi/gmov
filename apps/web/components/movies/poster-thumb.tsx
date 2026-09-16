"use client";

import Image from "next/image";
import { useState } from "react";
import { Clapperboard } from "lucide-react";

import { cn } from "@/lib/utils";

// Tiny shimmer placeholder (base64 SVG) while posters load.
const BLUR_PLACEHOLDER =
  "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI0MDAiIGhlaWdodD0iNjAwIj48cmVjdCB3aWR0aD0iMTAwJSIgaGVpZ2h0PSIxMDAlIiBmaWxsPSIjMWMxYzIyIi8+PC9zdmc+";

interface Props {
  src: string | null;
  alt: string;
  sizes?: string;
  className?: string;
}

/** Fills a `relative` parent with a movie poster, falling back to a
 * placeholder box when the poster is missing or fails to load. */
export function PosterThumb({ src, alt, sizes = "288px", className }: Props) {
  const [failed, setFailed] = useState(false);

  if (!src || failed) {
    return (
      <span
        aria-hidden
        className={cn(
          "from-muted via-card to-muted text-muted-foreground absolute inset-0 flex items-center justify-center bg-gradient-to-br",
          className,
        )}
      >
        <Clapperboard className="size-8" />
      </span>
    );
  }

  return (
    <Image
      src={src}
      alt={alt}
      fill
      sizes={sizes}
      placeholder="blur"
      blurDataURL={BLUR_PLACEHOLDER}
      onError={() => setFailed(true)}
      className={cn("animate-fade-in object-cover", className)}
    />
  );
}
