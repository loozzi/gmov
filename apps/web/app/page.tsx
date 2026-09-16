import { ContinueWatchingRail } from "@/components/movies/continue-watching-rail";
import { HeroCarousel } from "@/components/movies/hero-carousel";
import { MovieRail } from "@/components/movies/movie-rail";
import {
  fetchGenre,
  fetchLatest,
  fetchList,
} from "@/lib/server-movies";

export const dynamic = "force-dynamic";

export default async function Home() {
  const [latest, phimLe, phimBo, hoatHinh, tvShows] = await Promise.all([
    fetchLatest(1),
    fetchList("phim-le", 1),
    fetchList("phim-bo", 1),
    fetchGenre("hoat-hinh", 1),
    fetchList("tv-shows", 1),
  ]);

  const heroMovies = (latest?.items ?? []).slice(0, 5);

  return (
    <div>
      <HeroCarousel movies={heroMovies} />
      <div className="relative z-10 -mt-20 space-y-8 pb-8 sm:-mt-24">
        <ContinueWatchingRail />
        <MovieRail title="Mới cập nhật" movies={(latest?.items ?? []).slice(0, 10)} />
        <MovieRail title="Phim lẻ" href="/list/phim-le" movies={phimLe?.items ?? []} />
        <MovieRail title="Phim bộ" href="/list/phim-bo" movies={phimBo?.items ?? []} />
        <MovieRail
          title="Hoạt hình"
          href="/the-loai/hoat-hinh"
          movies={hoatHinh?.items ?? []}
        />
        <MovieRail title="TV Shows" href="/list/tv-shows" movies={tvShows?.items ?? []} />
      </div>
    </div>
  );
}
