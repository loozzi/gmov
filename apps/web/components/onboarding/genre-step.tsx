"use client";

import { Check } from "lucide-react";

import { Button } from "@/components/ui/button";
import { COUNTRIES, GENRES, type CatalogEntry } from "@/lib/catalog";
import { cn } from "@/lib/utils";

interface ChipProps {
  entry: CatalogEntry;
  active: boolean;
  testId: string;
  onToggle: (slug: string) => void;
}

function Chip({ entry, active, testId, onToggle }: ChipProps) {
  return (
    <button
      type="button"
      aria-pressed={active}
      data-testid={testId}
      onClick={() => onToggle(entry.slug)}
      className={cn(
        "inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors",
        active
          ? "border-brand bg-brand/10 text-brand"
          : "border-border bg-card text-muted-foreground hover:border-foreground/30 hover:text-foreground",
      )}
    >
      {active && <Check className="size-3.5" />}
      {entry.label}
    </button>
  );
}

interface GenreStepProps {
  genres: string[];
  countries: string[];
  onToggleGenre: (slug: string) => void;
  onToggleCountry: (slug: string) => void;
  onNext: () => void;
}

export function GenreStep({
  genres,
  countries,
  onToggleGenre,
  onToggleCountry,
  onNext,
}: GenreStepProps) {
  const hasSelection = genres.length > 0 || countries.length > 0;

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Bạn thích thể loại nào?</h2>
        <p className="text-muted-foreground text-sm">
          Chọn ít nhất một thể loại hoặc quốc gia để chúng tôi gợi ý sát gu hơn.
        </p>
        <div className="flex flex-wrap gap-2">
          {GENRES.map((entry) => (
            <Chip
              key={entry.slug}
              entry={entry}
              active={genres.includes(entry.slug)}
              testId={`onboarding-genre-${entry.slug}`}
              onToggle={onToggleGenre}
            />
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Bạn thích phim nước nào?</h2>
        <div className="flex flex-wrap gap-2">
          {COUNTRIES.map((entry) => (
            <Chip
              key={entry.slug}
              entry={entry}
              active={countries.includes(entry.slug)}
              testId={`onboarding-country-${entry.slug}`}
              onToggle={onToggleCountry}
            />
          ))}
        </div>
      </section>

      <div className="flex justify-end">
        <Button
          type="button"
          data-testid="onboarding-next"
          onClick={onNext}
          disabled={!hasSelection}
        >
          Tiếp tục
        </Button>
      </div>
    </div>
  );
}
