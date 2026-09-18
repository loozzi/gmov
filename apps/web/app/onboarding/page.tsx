"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import type { Dispatch, SetStateAction } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { GenreStep } from "@/components/onboarding/genre-step";
import { PosterStep } from "@/components/onboarding/poster-step";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toaster";
import { COUNTRIES, GENRES, labelFor } from "@/lib/catalog";
import { toVietnameseMessage } from "@/lib/errors";
import {
  usePosterFeedback,
  usePreferences,
  useSavePreferences,
  type Preferences,
} from "@/lib/recommendations";

const QUIZ_WEIGHT = 2.0;
const GENRE_CAP = 3.0;

type Step = 1 | 2 | 3;

const STEP_TITLES: Record<Step, string> = {
  1: "Gu của bạn là gì?",
  2: "Chọn poster bạn thích",
  3: "Sẵn sàng xem phim!",
};

function mergeGenres(
  base: Record<string, number>,
  extra: Record<string, number>,
): Record<string, number> {
  const merged: Record<string, number> = { ...base };
  for (const [slug, weight] of Object.entries(extra)) {
    merged[slug] = Math.min(GENRE_CAP, (merged[slug] ?? 0) + weight);
  }
  return merged;
}

function OnboardingSkeleton() {
  return (
    <div className="mx-auto max-w-4xl space-y-6 py-6">
      <Skeleton className="h-8 w-56" />
      <Skeleton className="h-4 w-80" />
      <div className="flex flex-wrap gap-2">
        {Array.from({ length: 10 }).map((_, i) => (
          <Skeleton key={i} className="h-9 w-24 rounded-full" />
        ))}
      </div>
    </div>
  );
}

function OnboardingFlow() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const again = searchParams.get("again") === "1";
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const toast = useToast();

  const { data: prefs, isLoading: prefsLoading } =
    usePreferences(isAuthenticated);
  const savePreferences = useSavePreferences();
  const posterFeedback = usePosterFeedback();

  const [step, setStep] = useState<Step>(1);
  const [genres, setGenres] = useState<string[]>([]);
  const [countries, setCountries] = useState<string[]>([]);
  const [liked, setLiked] = useState<string[]>([]);
  const [skippedPosters, setSkippedPosters] = useState<string[]>([]);
  const [posterPrefs, setPosterPrefs] = useState<Preferences | null>(null);
  const [submittedLikes, setSubmittedLikes] = useState<string[]>([]);
  const [ready, setReady] = useState(false);

  // Client-side gate: middleware cannot see the access token, so a finished
  // profile must be bounced here on mount (unless entering via "Làm lại").
  useEffect(() => {
    if (ready || authLoading || !isAuthenticated || prefsLoading) return;
    // A profile that already has signals manages taste at /me/taste; the quiz
    // is only for empty profiles (or an explicit "Làm lại" with ?again=1).
    if (!again && prefs?.has_signals) {
      router.replace("/me/taste");
      return;
    }
    if (!again && prefs?.onboarding_completed_at) {
      router.replace("/");
      return;
    }
    setReady(true);
  }, [ready, authLoading, isAuthenticated, prefsLoading, again, prefs, router]);

  const quizGenres = useMemo(
    () =>
      Object.fromEntries(genres.map((slug) => [slug, QUIZ_WEIGHT])) as Record<
        string,
        number
      >,
    [genres],
  );
  const quizCountries = useMemo(
    () =>
      Object.fromEntries(countries.map((slug) => [slug, QUIZ_WEIGHT])) as Record<
        string,
        number
      >,
    [countries],
  );

  const toggle = (
    setter: Dispatch<SetStateAction<string[]>>,
    slug: string,
  ) => {
    setter((prev) =>
      prev.includes(slug)
        ? prev.filter((item) => item !== slug)
        : [...prev, slug],
    );
  };

  const toggleLike = (slug: string) => {
    setLiked((prev) =>
      prev.includes(slug)
        ? prev.filter((item) => item !== slug)
        : [...prev, slug],
    );
    setSkippedPosters((prev) => prev.filter((item) => item !== slug));
  };

  const togglePosterSkip = (slug: string) => {
    setSkippedPosters((prev) =>
      prev.includes(slug)
        ? prev.filter((item) => item !== slug)
        : [...prev, slug],
    );
    setLiked((prev) => prev.filter((item) => item !== slug));
  };

  const submitSkip = () => {
    savePreferences.mutate(
      { genres: {}, countries: {}, skipped: true },
      {
        onSuccess: () => router.push("/"),
        onError: (error) => toast(toVietnameseMessage(error), "error"),
      },
    );
  };

  const goToSummary = async () => {
    const freshLikes = liked.filter((slug) => !submittedLikes.includes(slug));
    try {
      if (freshLikes.length > 0) {
        const updated = await posterFeedback.mutateAsync({ liked: freshLikes });
        setPosterPrefs(updated);
        setSubmittedLikes((prev) => [...prev, ...freshLikes]);
      }
      setStep(3);
    } catch (error) {
      toast(toVietnameseMessage(error), "error");
    }
  };

  const finish = () => {
    const finalGenres = mergeGenres(
      quizGenres,
      posterPrefs?.genres ?? {},
    );
    savePreferences.mutate(
      { genres: finalGenres, countries: quizCountries, skipped: false },
      {
        onSuccess: () => router.push("/"),
        onError: (error) => toast(toVietnameseMessage(error), "error"),
      },
    );
  };

  if (authLoading || (isAuthenticated && !ready)) {
    return <OnboardingSkeleton />;
  }

  if (!isAuthenticated) {
    return (
      <div className="mx-auto flex max-w-md flex-col items-center gap-3 py-16 text-center">
        <h1 className="text-2xl font-bold">Thiết lập gu xem phim</h1>
        <p className="text-sm text-muted-foreground">
          Bạn cần đăng nhập để thiết lập sở thích.
        </p>
        <Button asChild>
          <Link href="/login?next=/onboarding">Đăng nhập</Link>
        </Button>
      </div>
    );
  }

  const saving = savePreferences.isPending || posterFeedback.isPending;

  return (
    <section className="mx-auto max-w-4xl space-y-8 py-6">
      <header className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <p className="text-muted-foreground text-sm font-medium">
            Bước {step}/3
          </p>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            data-testid="onboarding-skip"
            onClick={submitSkip}
            disabled={saving}
          >
            Bỏ qua
          </Button>
        </div>
        <h1 className="text-2xl font-bold sm:text-3xl">{STEP_TITLES[step]}</h1>
        <div className="bg-muted h-1.5 w-full overflow-hidden rounded-full">
          <div
            className="bg-brand h-full rounded-full transition-all duration-300"
            style={{ width: `${(step / 3) * 100}%` }}
          />
        </div>
      </header>

      {step === 1 && (
        <GenreStep
          genres={genres}
          countries={countries}
          onToggleGenre={(slug) => toggle(setGenres, slug)}
          onToggleCountry={(slug) => toggle(setCountries, slug)}
          onNext={() => setStep(2)}
        />
      )}

      {step === 2 && (
        <PosterStep
          selectedGenres={genres}
          selectedCountries={countries}
          liked={liked}
          skipped={skippedPosters}
          onToggleLike={toggleLike}
          onToggleSkip={togglePosterSkip}
          onBack={() => setStep(1)}
          onNext={() => void goToSummary()}
          pending={posterFeedback.isPending}
        />
      )}

      {step === 3 && (
        <div className="space-y-6">
          <div className="bg-card space-y-4 rounded-xl border border-border p-5">
            <div className="space-y-1">
              <h2 className="font-semibold">Thể loại bạn chọn</h2>
              <p className="text-muted-foreground text-sm">
                {genres.length > 0
                  ? genres
                      .map((slug) => labelFor(GENRES, slug, slug))
                      .join(", ")
                  : "Chưa chọn thể loại nào."}
              </p>
            </div>
            <div className="space-y-1">
              <h2 className="font-semibold">Quốc gia bạn chọn</h2>
              <p className="text-muted-foreground text-sm">
                {countries.length > 0
                  ? countries
                      .map((slug) => labelFor(COUNTRIES, slug, slug))
                      .join(", ")
                  : "Chưa chọn quốc gia nào."}
              </p>
            </div>
            <div className="space-y-1">
              <h2 className="font-semibold">Poster bạn thích</h2>
              <p className="text-muted-foreground text-sm">
                {liked.length > 0
                  ? `${liked.length} poster`
                  : "Chưa thích poster nào."}
              </p>
            </div>
          </div>
          <div className="flex items-center justify-between gap-3">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setStep(2)}
              disabled={saving}
            >
              Quay lại
            </Button>
            <Button
              type="button"
              data-testid="onboarding-finish"
              onClick={finish}
              disabled={saving}
            >
              Bắt đầu xem
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}

export default function OnboardingPage() {
  return (
    <Suspense fallback={<OnboardingSkeleton />}>
      <OnboardingFlow />
    </Suspense>
  );
}
