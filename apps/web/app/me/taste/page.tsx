"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ChevronLeft,
  Lightbulb,
  Plus,
  RotateCcw,
  X,
} from "lucide-react";

import { useAuth } from "@/components/auth/auth-provider";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toaster";
import { COUNTRIES, GENRES, labelFor } from "@/lib/catalog";
import { toVietnameseMessage } from "@/lib/errors";
import {
  TASTE_SOURCE_LABELS,
  usePreferences,
  useResetPreferences,
  useSavePreferences,
  useTaste,
  useUndoRecommendationFeedback,
  type FeedbackKind,
  type Preferences,
} from "@/lib/recommendations";

const ADD_WEIGHT = 2.0;
const MAX_WEIGHT = 3.0;
const WEIGHT_FLOOR = 0.05;

const FEEDBACK_LABELS: Record<FeedbackKind, string> = {
  interested: "Quan tâm",
  not_interested: "Không quan tâm",
};

function shortAmount(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return `${rounded > 0 ? "+" : ""}${rounded}`;
}

function WeightBar({ weight }: { weight: number }) {
  const ratio = Math.max(
    WEIGHT_FLOOR,
    Math.min(1, Math.abs(weight) / MAX_WEIGHT),
  );
  return (
    <div className="bg-muted h-1.5 w-full overflow-hidden rounded-full">
      <div
        className={
          weight >= 0
            ? "bg-brand h-full rounded-full"
            : "h-full rounded-full bg-red-500"
        }
        style={{ width: `${ratio * 100}%` }}
      />
    </div>
  );
}

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="bg-card space-y-3 rounded-xl border border-border p-4 sm:p-5">
      <div className="space-y-0.5">
        <h2 className="font-semibold">{title}</h2>
        {description && (
          <p className="text-muted-foreground text-sm">{description}</p>
        )}
      </div>
      {children}
    </section>
  );
}

function TastePage() {
  const router = useRouter();
  const toast = useToast();
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const { data: prefs, isLoading: prefsLoading } =
    usePreferences(isAuthenticated);
  const { data: taste, isLoading: tasteLoading } = useTaste(isAuthenticated);
  const savePreferences = useSavePreferences();
  const resetPreferences = useResetPreferences();
  const undoFeedback = useUndoRecommendationFeedback();

  if (authLoading || (isAuthenticated && (prefsLoading || tasteLoading))) {
    return (
      <div className="mx-auto max-w-3xl space-y-4 py-4">
        <Skeleton className="h-9 w-40" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="mx-auto flex max-w-md flex-col items-center gap-3 py-16 text-center">
        <h1 className="text-2xl font-bold">Gu của tôi</h1>
        <p className="text-sm text-muted-foreground">
          Bạn cần đăng nhập để xem gu xem phim.
        </p>
        <Button asChild>
          <Link href="/login?next=/me/taste">Đăng nhập</Link>
        </Button>
      </div>
    );
  }

  const explicit: Preferences = prefs ?? {
    genres: {},
    countries: {},
    excluded_genres: [],
    onboarding_completed_at: null,
    skipped: false,
    has_signals: false,
  };

  const save = (next: {
    genres?: Record<string, number>;
    countries?: Record<string, number>;
    excluded_genres?: string[];
  }) => {
    savePreferences.mutate(
      {
        genres: next.genres ?? explicit.genres,
        countries: next.countries ?? explicit.countries,
        excluded_genres: next.excluded_genres ?? explicit.excluded_genres,
      },
      { onError: (error) => toast(toVietnameseMessage(error), "error") },
    );
  };

  const removeGenre = (slug: string) => {
    const genres = { ...explicit.genres };
    delete genres[slug];
    save({
      genres,
      excluded_genres: Array.from(new Set([...explicit.excluded_genres, slug])),
    });
  };

  const addGenre = (slug: string) => {
    save({
      genres: { ...explicit.genres, [slug]: ADD_WEIGHT },
      excluded_genres: explicit.excluded_genres.filter((s) => s !== slug),
    });
  };

  const removeCountry = (slug: string) => {
    const countries = { ...explicit.countries };
    delete countries[slug];
    save({ countries });
  };

  const genreWeights = Object.entries(taste?.genre_weights ?? {}).sort(
    (a, b) => b[1] - a[1],
  );
  const genreSlugs = new Set(genreWeights.map(([slug]) => slug));
  const addableGenres = GENRES.filter(
    (genre) =>
      !genreSlugs.has(genre.slug) &&
      !explicit.excluded_genres.includes(genre.slug),
  );
  const countryWeights = Object.entries(taste?.country_weights ?? {}).sort(
    (a, b) => b[1] - a[1],
  );
  const excluded = explicit.excluded_genres;

  return (
    <section className="mx-auto max-w-3xl space-y-4 py-4">
      <div className="space-y-1">
        <Button asChild variant="ghost" size="sm" className="-ml-2">
          <Link href="/profiles/manage">
            <ChevronLeft /> Quản lý profile
          </Link>
        </Button>
        <h1 className="text-2xl font-bold sm:text-3xl">Gu của tôi</h1>
        <p className="text-muted-foreground text-sm">
          Gu được tổng hợp từ phim bạn yêu thích, đã xem, muốn xem và phản hồi.
          Gỡ một thể loại sẽ loại nó khỏi gợi ý, kể cả khi nó đến từ lịch sử.
        </p>
      </div>

      <Section
        title="Thể loại"
        description={
          genreWeights.length > 0
            ? "Trọng số càng lớn càng ảnh hưởng nhiều tới gợi ý."
            : "Chưa có thể loại nào. Hãy thêm bên dưới hoặc làm onboarding."
        }
      >
        <ul className="space-y-3">
          {genreWeights.map(([slug, weight]) => (
            <li key={slug} className="space-y-1.5">
              <div className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-sm font-medium">
                  {labelFor(GENRES, slug, slug)}
                </span>
                <span className="text-muted-foreground text-xs tabular-nums">
                  {shortAmount(weight)}
                </span>
                <button
                  type="button"
                  aria-label={`Gỡ ${labelFor(GENRES, slug, slug)}`}
                  data-testid={`taste-remove-${slug}`}
                  disabled={savePreferences.isPending}
                  onClick={() => removeGenre(slug)}
                  className="text-muted-foreground hover:text-foreground cursor-pointer disabled:opacity-50"
                >
                  <X className="size-4" />
                </button>
              </div>
              <WeightBar weight={weight} />
              <div className="flex flex-wrap gap-1">
                {Object.entries(taste?.sources[slug] ?? {})
                  .sort((a, b) => b[1] - a[1])
                  .map(([source, amount]) => (
                    <span
                      key={source}
                      className="bg-muted text-muted-foreground rounded-full px-2 py-0.5 text-[11px]"
                    >
                      {TASTE_SOURCE_LABELS[source] ?? source}{" "}
                      {shortAmount(amount)}
                    </span>
                  ))}
              </div>
            </li>
          ))}
        </ul>

        {addableGenres.length > 0 && (
          <div className="space-y-1.5 border-t border-border pt-3">
            <p className="text-muted-foreground text-xs font-medium">
              Thêm thể loại
            </p>
            <div className="flex flex-wrap gap-1.5">
              {addableGenres.map((genre) => (
                <button
                  key={genre.slug}
                  type="button"
                  data-testid={`taste-add-${genre.slug}`}
                  disabled={savePreferences.isPending}
                  onClick={() => addGenre(genre.slug)}
                  className="border-border hover:border-brand hover:text-brand flex cursor-pointer items-center gap-1 rounded-full border px-2.5 py-1 text-xs transition-colors disabled:opacity-50"
                >
                  <Plus className="size-3" /> {genre.label}
                </button>
              ))}
            </div>
          </div>
        )}
      </Section>

      <Section
        title="Quốc gia"
        description="Chỉ lấy từ lựa chọn của bạn lúc onboarding."
      >
        {countryWeights.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            Chưa chọn quốc gia nào.
          </p>
        ) : (
          <ul className="space-y-2">
            {countryWeights.map(([slug, weight]) => (
              <li key={slug} className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-sm">
                  {labelFor(COUNTRIES, slug, slug)}
                </span>
                <span className="text-muted-foreground text-xs tabular-nums">
                  {shortAmount(weight)}
                </span>
                <button
                  type="button"
                  aria-label={`Gỡ ${labelFor(COUNTRIES, slug, slug)}`}
                  disabled={savePreferences.isPending}
                  onClick={() => removeCountry(slug)}
                  className="text-muted-foreground hover:text-foreground cursor-pointer disabled:opacity-50"
                >
                  <X className="size-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {excluded.length > 0 && (
        <Section
          title="Đã ẩn"
          description="Những thể loại này sẽ không xuất hiện trong gợi ý."
        >
          <div className="flex flex-wrap gap-1.5">
            {excluded.map((slug) => (
              <button
                key={slug}
                type="button"
                disabled={savePreferences.isPending}
                onClick={() =>
                  save({
                    excluded_genres: excluded.filter((s) => s !== slug),
                  })
                }
                className="border-border text-muted-foreground hover:text-foreground flex cursor-pointer items-center gap-1 rounded-full border px-2.5 py-1 text-xs disabled:opacity-50"
              >
                {labelFor(GENRES, slug, slug)}
                <Plus className="size-3" /> Thêm lại
              </button>
            ))}
          </div>
        </Section>
      )}

      <Section
        title="Phản hồi gợi ý"
        description="Mỗi lần bạn bấm Quan tâm / Không quan tâm trên dải gợi ý."
      >
        {!taste || taste.feedback.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            Chưa có phản hồi nào.
          </p>
        ) : (
          <ul className="space-y-2">
            {taste.feedback.map((item) => (
              <li
                key={item.movie.slug}
                className="flex items-center gap-2 text-sm"
              >
                <Link
                  href={`/phim/${item.movie.slug}`}
                  className="hover:text-brand min-w-0 flex-1 truncate"
                >
                  {item.movie.name}
                </Link>
                <span className="text-muted-foreground text-xs">
                  {FEEDBACK_LABELS[item.kind]}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  data-testid={`taste-undo-${item.movie.slug}`}
                  disabled={undoFeedback.isPending}
                  onClick={() =>
                    undoFeedback.mutate(item.movie.slug, {
                      onError: (error) =>
                        toast(toVietnameseMessage(error), "error"),
                    })
                  }
                >
                  Hoàn tác
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Làm lại từ đầu">
        <p className="text-muted-foreground flex items-start gap-2 text-sm">
          <Lightbulb className="text-brand mt-0.5 size-4 shrink-0" />
          Xoá gu đã chọn và chạy lại onboarding. Phim yêu thích, lịch sử xem và
          muốn xem không bị ảnh hưởng.
        </p>
        <Button
          type="button"
          variant="outline"
          data-testid="taste-reset"
          disabled={resetPreferences.isPending}
          onClick={() => {
            if (!window.confirm("Làm lại onboarding cho profile này?")) return;
            resetPreferences.mutate(undefined, {
              onSuccess: () => router.push("/onboarding?again=1"),
              onError: (error) =>
                toast(toVietnameseMessage(error), "error"),
            });
          }}
        >
          <RotateCcw /> Chạy lại onboarding
        </Button>
      </Section>
    </section>
  );
}

export default function TastePageRoute() {
  return <TastePage />;
}
