import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { WatchView } from "@/components/player/watch-view";
import { fetchMovieDetail, stripHtml } from "@/lib/server-movies";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string; episode: string }>;
}): Promise<Metadata> {
  const { slug, episode } = await params;
  const movie = await fetchMovieDetail(slug);
  if (!movie) return { title: "Không tìm thấy phim" };
  const ep = movie.servers
    .flatMap((s) => s.episodes)
    .find((e) => (e.slug ?? e.name) === episode);
  const title = `Xem ${movie.name}${ep ? ` - ${ep.name}` : ""}`;
  return {
    title,
    description: stripHtml(movie.description).slice(0, 160),
    openGraph: {
      title,
      images: movie.poster_url ? [movie.poster_url] : [],
    },
  };
}

export default async function WatchPage({
  params,
}: {
  params: Promise<{ slug: string; episode: string }>;
}) {
  const { slug, episode } = await params;
  const movie = await fetchMovieDetail(slug);
  if (!movie) notFound();
  const exists = movie.servers
    .flatMap((s) => s.episodes)
    .some((e) => (e.slug ?? e.name) === episode);
  if (!exists) notFound();

  return <WatchView detail={movie} episodeSlug={episode} />;
}
