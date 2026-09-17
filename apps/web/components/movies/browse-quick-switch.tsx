"use client";

import Link from "next/link";

import { browseChips, type BrowseSource } from "@/lib/browse";
import { cn } from "@/lib/utils";

const RAIL_LABELS: Record<BrowseSource["kind"], string> = {
  genre: "Chuyển nhanh thể loại",
  country: "Chuyển nhanh quốc gia",
  year: "Chuyển nhanh năm",
  list: "Chuyển nhanh danh mục",
  search: "",
};

export function BrowseQuickSwitch({ source }: { source: BrowseSource }) {
  const chips = browseChips(source);

  if (chips.length === 0) {
    return null;
  }

  return (
    <nav
      aria-label={RAIL_LABELS[source.kind]}
      className="bg-background/90 border-border sticky top-16 z-30 -mx-4 border-b px-4 backdrop-blur"
    >
      <div className="rail-scroll flex gap-2 overflow-x-auto py-2">
        {chips.map((chip) => (
          <Link
            key={chip.href}
            href={chip.href}
            aria-current={chip.active ? "page" : undefined}
            className={cn(
              "rounded-full px-3 py-1 text-xs font-medium whitespace-nowrap transition-colors",
              chip.active
                ? "bg-brand text-brand-foreground"
                : "bg-muted text-muted-foreground hover:bg-border hover:text-foreground",
            )}
          >
            {chip.label}
          </Link>
        ))}
      </div>
    </nav>
  );
}
