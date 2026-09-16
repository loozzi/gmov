/**
 * DEV-ONLY E2E harness: exercises the real embed-mode watch machinery
 * (WatchView + per-episode history registration) with no upstream dependency,
 * because real upstream episodes only carry cross-origin embed URLs.
 *
 * `?episode=` selects the episode. The in-page links switch episodes with
 * client-side navigation on the SAME route, exactly like the real
 * `/xem/[slug]/[episode]` route (so the WatchView island stays mounted).
 * Returns 404 in production builds.
 */
import Link from "next/link";
import { notFound } from "next/navigation";

import { WatchView } from "@/components/player/watch-view";
import type { MovieDetail } from "@/lib/types";

const EPISODES = [
  { name: "Tập 1", slug: "tap-1" },
  { name: "Tập 2", slug: "tap-2" },
  { name: "Tập 3", slug: "tap-3" },
];

export default async function E2EEmbedPage({
  searchParams,
}: {
  searchParams: Promise<{ slug?: string; episode?: string }>;
}) {
  if (process.env.NODE_ENV === "production") {
    notFound();
  }
  const { slug = "e2e-embed-film", episode = "tap-1" } = await searchParams;
  const detail: MovieDetail = {
    slug,
    name: `E2E Embed ${slug}`,
    original_name: "E2E",
    thumb_url: null,
    poster_url: null,
    description: "Synthetic embed-only episodes for E2E history testing.",
    year: "2026",
    quality: "HD",
    language: "Vietsub",
    current_episode: "Tập 1",
    total_episodes: EPISODES.length,
    time: "60 phút",
    provider_id: "e2e",
    director: null,
    casts: null,
    formats: [],
    genres: [],
    countries: [],
    servers: [
      {
        name: "E2E Server",
        episodes: EPISODES.map((e) => ({
          name: e.name,
          slug: e.slug,
          embed_url: "about:blank",
          m3u8_url: null,
        })),
      },
    ],
  };
  return (
    <div className="space-y-4">
      <nav aria-label="E2E episode switcher" className="flex gap-2 text-sm">
        {EPISODES.map((e) => (
          <Link
            key={e.slug}
            data-testid={`e2e-go-${e.slug}`}
            href={`/e2e/embed?slug=${slug}&episode=${e.slug}`}
            className="rounded-md border border-border px-3 py-1"
          >
            {e.name}
          </Link>
        ))}
      </nav>
      <WatchView detail={detail} episodeSlug={episode} />
    </div>
  );
}
