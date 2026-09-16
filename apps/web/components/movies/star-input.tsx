"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Star } from "lucide-react";

import { useAuth } from "@/components/auth/auth-provider";
import { useToast } from "@/components/ui/toaster";
import { ApiError } from "@/lib/errors";
import { useMyRating, useRate, useRemoveRating } from "@/lib/reviews";
import { cn } from "@/lib/utils";

interface Props {
  movieSlug: string;
}

export function StarInput({ movieSlug }: Props) {
  const router = useRouter();
  const toast = useToast();
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const { data } = useMyRating(movieSlug, isAuthenticated);
  const rate = useRate(movieSlug);
  const remove = useRemoveRating(movieSlug);
  const [hover, setHover] = useState<number | null>(null);
  const [popStar, setPopStar] = useState<number | null>(null);

  const current = data?.stars ?? 0;
  const display = hover ?? current;
  const pending = rate.isPending || remove.isPending;

  const handleRate = (stars: number) => {
    if (!isAuthenticated) {
      router.push(`/login?next=/phim/${movieSlug}`);
      return;
    }
    rate.mutate(stars, {
      onSuccess: () => {
        setPopStar(stars);
        toast(`Đã đánh giá ${stars} sao.`, "success");
      },
      onError: (e) => {
        if (e instanceof ApiError && e.status === 401) {
          router.push(`/login?next=/phim/${movieSlug}`);
        } else {
          toast("Không thể gửi đánh giá. Thử lại nhé.", "error");
        }
      },
    });
  };

  const handleRemove = () => {
    remove.mutate(undefined, {
      onSuccess: () => toast("Đã gỡ đánh giá.", "success"),
      onError: (e) => {
        if (e instanceof ApiError && e.status === 401) {
          router.push(`/login?next=/phim/${movieSlug}`);
        } else {
          toast("Không thể gỡ đánh giá. Thử lại nhé.", "error");
        }
      },
    });
  };

  return (
    <div className="flex items-center gap-2">
      <div
        role="radiogroup"
        aria-label="Đánh giá phim"
        className="flex items-center gap-1"
      >
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={current === n}
            aria-label={`Đánh giá ${n} sao`}
            title={`Đánh giá ${n} sao`}
            onClick={() => handleRate(n)}
            onMouseEnter={() => setHover(n)}
            onMouseLeave={() => setHover(null)}
            onFocus={() => setHover(n)}
            onBlur={() => setHover(null)}
            disabled={authLoading || pending}
            className="ease-back cursor-pointer rounded p-0.5 transition-transform duration-150 hover:scale-110 active:scale-95 disabled:opacity-50 disabled:hover:scale-100"
          >
            <Star
              onAnimationEnd={() => setPopStar(null)}
              className={cn(
                "size-5 transition-colors duration-150",
                n <= display
                  ? "fill-brand text-brand"
                  : "text-muted-foreground",
                popStar === n && "animate-pop",
              )}
            />
          </button>
        ))}
      </div>
      {current > 0 && (
        <button
          type="button"
          onClick={handleRemove}
          disabled={authLoading || pending}
          aria-label="Gỡ đánh giá"
          className="text-muted-foreground hover:text-foreground cursor-pointer text-xs underline-offset-4 hover:underline disabled:opacity-50"
        >
          Gỡ
        </button>
      )}
    </div>
  );
}
