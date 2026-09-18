import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Calendar, Clock, MonitorPlay } from "lucide-react";

import { FavoriteButton } from "@/components/movies/favorite-button";
import { RatingSummary } from "@/components/movies/rating-summary";
import { ResumeButton } from "@/components/movies/resume-button";
import { StarInput } from "@/components/movies/star-input";
import { CommentSection } from "@/components/movies/comment-section";
import { MovieRail } from "@/components/movies/movie-rail";
import { WatchlistButton } from "@/components/movies/watchlist-button";
import { JsonLd } from "@/components/seo/json-ld";
import { Button } from "@/components/ui/button";
import { Reveal } from "@/components/ui/reveal";
import { GENRES, labelFor } from "@/lib/catalog";
import {
  breadcrumbJsonLd,
  buildMetadata,
  movieJsonLd,
  movieSocialImage,
} from "@/lib/seo";
import { fetchMovieDetail, fetchRelated, stripHtml } from "@/lib/server-movies";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const movie = await fetchMovieDetail(slug);
  if (!movie) {
    return { title: "Không tìm thấy phim", robots: { index: false } };
  }
  const genres = movie.genres
    .map((genre) => labelFor(GENRES, genre, genre))
    .slice(0, 3);
  const facts = [movie.year, genres.join(", ")].filter(Boolean).join(" · ");
  const description = [facts, stripHtml(movie.description)]
    .filter(Boolean)
    .join(" — ")
    .slice(0, 300);
  return buildMetadata({
    title: movie.name,
    description,
    path: `/phim/${slug}`,
    type: "video.movie",
    images: [movieSocialImage(slug, movie.name)],
  });
}

function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <p className="text-sm">
      <span className="text-muted-foreground">{label}: </span>
      <span>{value}</span>
    </p>
  );
}

export default async function MovieDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const [movie, related] = await Promise.all([
    fetchMovieDetail(slug),
    fetchRelated(slug),
  ]);
  if (!movie) notFound();

  const poster = movie.poster_url || movie.thumb_url;
  const firstEpisode = movie.servers.flatMap((s) => s.episodes)[0] ?? null;
  const description = stripHtml(movie.description);

  return (
    <div className="space-y-8">
      <JsonLd data={movieJsonLd(movie)} />
      <JsonLd
        data={breadcrumbJsonLd([
          { name: "Trang chủ", path: "/" },
          { name: movie.name, path: `/phim/${slug}` },
        ])}
      />
      <section className="border-border relative overflow-hidden rounded-2xl border">
        {poster && (
          <>
            <Image
              src={poster}
              alt=""
              fill
              sizes="100vw"
              className="object-cover opacity-20 blur-2xl"
              aria-hidden
            />
            <div className="from-card via-card/70 absolute inset-0 bg-gradient-to-t to-transparent" />
          </>
        )}
        <div className="relative flex flex-col gap-6 p-5 sm:flex-row sm:p-8">
          <div className="border-border relative aspect-[2/3] w-40 shrink-0 overflow-hidden rounded-xl border sm:w-56">
            {poster && (
              <Image
                src={poster}
                alt={movie.name}
                fill
                sizes="(max-width: 640px) 160px, 224px"
                className="object-cover"
                priority
              />
            )}
          </div>
          <div className="min-w-0 flex-1 space-y-3">
            <div>
              <h1 className="text-2xl font-bold sm:text-3xl">{movie.name}</h1>
              {movie.original_name && (
                <p className="text-muted-foreground mt-1">
                  {movie.original_name}
                </p>
              )}
            </div>
            <div className="text-muted-foreground flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
              {movie.year && (
                <span className="flex items-center gap-1">
                  <Calendar className="size-4" /> {movie.year}
                </span>
              )}
              {movie.time && (
                <span className="flex items-center gap-1">
                  <Clock className="size-4" /> {movie.time}
                </span>
              )}
              {movie.quality && <span>{movie.quality}</span>}
              {movie.language && <span>{movie.language}</span>}
              {movie.current_episode && (
                <span className="bg-brand text-brand-foreground rounded-md px-2 py-0.5 text-xs font-semibold">
                  {movie.current_episode}
                </span>
              )}
            </div>
            {movie.genres.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {movie.genres.map((g) => (
                  <span
                    key={g}
                    className="border-border rounded-full border px-3 py-1 text-xs"
                  >
                    {g}
                  </span>
                ))}
              </div>
            )}
            <div className="space-y-1">
              {movie.director && (
                <MetaRow label="Đạo diễn" value={movie.director} />
              )}
              {movie.casts && <MetaRow label="Diễn viên" value={movie.casts} />}
              {movie.countries.length > 0 && (
                <MetaRow label="Quốc gia" value={movie.countries.join(", ")} />
              )}
            </div>
            <div className="flex flex-wrap gap-2 pt-1">
              <ResumeButton
                movieSlug={movie.slug}
                firstEpisode={firstEpisode}
              />
              <FavoriteButton
                movieSlug={movie.slug}
                movieName={movie.name}
                posterUrl={poster}
              />
              <WatchlistButton
                movieSlug={movie.slug}
                movieName={movie.name}
                posterUrl={poster}
              />
            </div>
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <RatingSummary movieSlug={movie.slug} />
              <StarInput movieSlug={movie.slug} />
            </div>
          </div>
        </div>
      </section>

      {description && (
        <Reveal>
          <section className="space-y-2">
            <h2 className="text-xl font-bold">Nội dung phim</h2>
            <p className="text-muted-foreground max-w-4xl text-sm leading-relaxed">
              {description}
            </p>
          </section>
        </Reveal>
      )}

      <Reveal>
        <section className="space-y-4">
          <h2 className="flex items-center gap-2 text-xl font-bold">
            <MonitorPlay className="text-brand size-5" /> Danh sách tập
          </h2>
          {movie.servers.length === 0 && (
            <div className="border-border bg-card text-muted-foreground rounded-xl border p-8 text-center text-sm">
              Phim chưa cập nhật tập nào. Quay lại sau nhé.
            </div>
          )}
          {movie.servers.map((server) => (
            <div
              key={server.name}
              className="border-border bg-card space-y-3 rounded-xl border p-4"
            >
              <h3 className="text-brand text-sm font-semibold">
                {server.name}
              </h3>
              {server.episodes.length === 0 ? (
                <p className="text-muted-foreground text-sm">
                  Server này chưa có tập phim.
                </p>
              ) : (
                <div className="grid grid-cols-4 gap-2 sm:grid-cols-6 md:grid-cols-8 lg:grid-cols-10">
                  {server.episodes.map((ep) => (
                    <Button
                      key={`${server.name}-${ep.slug ?? ep.name}`}
                      variant="secondary"
                      size="sm"
                      asChild
                      className="min-w-0"
                    >
                      <Link
                        href={`/xem/${movie.slug}/${ep.slug ?? ep.name}`}
                        title={ep.name}
                      >
                        <span className="truncate">{ep.name}</span>
                      </Link>
                    </Button>
                  ))}
                </div>
              )}
            </div>
          ))}
        </section>
      </Reveal>

      <Reveal>
        <MovieRail title="Phim liên quan" movies={related?.items ?? []} />
      </Reveal>

      <Reveal>
        <section className="space-y-4">
          <h2 className="text-xl font-bold">Bình luận</h2>
          <CommentSection movieSlug={movie.slug} />
        </section>
      </Reveal>
    </div>
  );
}
