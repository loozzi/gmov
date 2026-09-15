"use client";

import Link from "next/link";
import { Check } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { ServerGroup } from "@/lib/types";

interface Props {
  movieSlug: string;
  servers: ServerGroup[];
  activeServer: string;
  activeEpisode: string | null;
  watched: Set<string>;
  onServer: (name: string) => void;
}

export function EpisodeGrid({
  movieSlug,
  servers,
  activeServer,
  activeEpisode,
  watched,
  onServer,
}: Props) {
  if (servers.length === 0) {
    return (
      <p className="rounded-xl border border-border bg-card p-6 text-center text-sm text-muted-foreground">
        Phim chưa cập nhật tập nào. Quay lại sau nhé.
      </p>
    );
  }
  const server = servers.find((s) => s.name === activeServer) ?? servers[0];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {servers.map((s) => (
          <Button
            key={s.name}
            size="sm"
            variant={s.name === server.name ? "default" : "secondary"}
            onClick={() => onServer(s.name)}
          >
            {s.name}
          </Button>
        ))}
      </div>
      <div className="grid grid-cols-4 gap-2 sm:grid-cols-6 md:grid-cols-8 lg:grid-cols-10">
        {server.episodes.map((ep) => {
          const key = ep.slug ?? ep.name;
          const isActive = key === activeEpisode;
          const isWatched = watched.has(key);
          return (
            <Button
              key={`${server.name}-${key}`}
              variant={isActive ? "default" : "secondary"}
              size="sm"
              asChild
              className="relative min-w-0"
            >
              <Link href={`/xem/${movieSlug}/${key}`} title={ep.name}>
                <span className="truncate">{ep.name}</span>
                {isWatched && !isActive && (
                  <Check className="absolute -top-1 -right-1 size-3.5 rounded-full bg-green-600 p-0.5 text-white" />
                )}
              </Link>
            </Button>
          );
        })}
      </div>
    </div>
  );
}
