"use client";

import Link from "next/link";
import { ChevronRight, Sparkles } from "lucide-react";

import { useAuth } from "@/components/auth/auth-provider";
import { usePreferences } from "@/lib/recommendations";

export function OnboardingCta() {
  const { isAuthenticated, isLoading } = useAuth();
  const { data, isLoading: prefsLoading } = usePreferences(isAuthenticated);

  if (isLoading || !isAuthenticated || prefsLoading || !data) return null;
  if (data.onboarding_completed_at || data.has_signals) return null;

  return (
    <Link
      href="/onboarding"
      data-testid="onboarding-cta"
      className="border-border bg-card hover:border-brand/60 flex items-center gap-3 rounded-xl border p-4 transition-colors"
    >
      <Sparkles className="text-brand size-6 shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="font-semibold">Chọn gu để gợi ý sát hơn</p>
        <p className="text-muted-foreground text-sm">
          Trả lời nhanh vài câu để mục Gợi ý cho bạn hiểu bạn hơn.
        </p>
      </div>
      <ChevronRight className="text-muted-foreground size-5 shrink-0" />
    </Link>
  );
}
