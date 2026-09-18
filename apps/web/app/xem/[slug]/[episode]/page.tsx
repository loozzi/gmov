import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { WatchView } from "@/components/player/watch-view";
import { buildMetadata, movieSocialImage } from "@/lib/seo";
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
  return buildMetadata({
    title,
    description: [title, stripHtml(movie.description)]
      .filter(Boolean)
      .join(" — ")
      .slice(0, 300),
    path: `/xem/${slug}/${episode}`,
    type: "video.episode",
    images: [movieSocialImage(slug, movie.name)],
    // Player pages are thin content and already disallowed in robots.txt.
    noIndex: true,
  });
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
