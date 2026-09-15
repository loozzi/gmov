"use client";

import { useRouter } from "next/navigation";
import { Heart } from "lucide-react";

import { useAuth } from "@/components/auth/auth-provider";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/errors";
import { useFavoriteStatus, useToggleFavorite } from "@/lib/me";
import { cn } from "@/lib/utils";

interface Props {
  movieSlug: string;
  movieName: string;
  posterUrl: string | null;
}

export function FavoriteButton({ movieSlug, movieName, posterUrl }: Props) {
  const router = useRouter();
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const { data } = useFavoriteStatus(movieSlug, isAuthenticated);
  const toggle = useToggleFavorite(movieSlug);

  const isFavorite = data?.is_favorite ?? false;

  const onClick = () => {
    if (!isAuthenticated) {
      router.push(`/login?next=/phim/${movieSlug}`);
      return;
    }
    toggle.mutate(
      { isFavorite, movie_name: movieName, poster_url: posterUrl },
      {
        onError: (e) => {
          if (e instanceof ApiError && e.status === 401) {
            router.push(`/login?next=/phim/${movieSlug}`);
          }
        },
      },
    );
  };

  return (
    <Button
      variant="secondary"
      onClick={onClick}
      disabled={authLoading || toggle.isPending}
      aria-pressed={isFavorite}
    >
      <Heart
        className={cn(isFavorite && "fill-brand text-brand")}
      />
      {isFavorite ? "Đã yêu thích" : "Yêu thích"}
    </Button>
  );
}
