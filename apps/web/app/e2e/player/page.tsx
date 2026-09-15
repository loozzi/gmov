/**
 * DEV-ONLY E2E harness: exercises the real HLS resume machinery
 * (VideoPlayer + heartbeat + reload + seek) against a public sample stream.
 *
 * Upstream episodes only carry embed URLs (see Batch 1 verdict), so this
 * synthetic detail is the only honest way to E2E-test per-second resume.
 * Returns 404 in production builds.
 */
import { notFound } from "next/navigation";

import { WatchView } from "@/components/player/watch-view";
import type { MovieDetail } from "@/lib/types";

const SAMPLE_M3U8 = "https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8";

export default async function E2EPlayerPage({
  searchParams,
}: {
  searchParams: Promise<{ slug?: string }>;
}) {
  if (process.env.NODE_ENV === "production") {
    notFound();
  }
  const { slug = "e2e-hls-film" } = await searchParams;
  const detail: MovieDetail = {
    slug,
    name: "E2E HLS Film",
    original_name: "E2E",
    thumb_url: null,
    poster_url: null,
    description: "Synthetic episode for E2E resume testing.",
    year: "2026",
    quality: "HD",
    language: "Vietsub",
    current_episode: "Tập 1",
    total_episodes: 1,
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
        episodes: [
          { name: "Tập 1", slug: "tap-1", embed_url: null, m3u8_url: SAMPLE_M3U8 },
        ],
      },
    ],
  };
  return <WatchView detail={detail} episodeSlug="tap-1" />;
}
