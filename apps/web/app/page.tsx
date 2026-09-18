import { ContinueWatchingRail } from "@/components/movies/continue-watching-rail";
import { HeroCarousel } from "@/components/movies/hero-carousel";
import { MovieRail } from "@/components/movies/movie-rail";
import { OnboardingCta } from "@/components/movies/onboarding-cta";
import { RecommendationsRail } from "@/components/movies/recommendations-rail";
import { Reveal } from "@/components/ui/reveal";
import { fetchGenre, fetchLatest, fetchList } from "@/lib/server-movies";

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
        <Reveal>
          <OnboardingCta />
        </Reveal>
        <Reveal>
          <RecommendationsRail />
        </Reveal>
        <Reveal>
          <ContinueWatchingRail />
        </Reveal>
        <Reveal>
          <MovieRail
            title="Mới cập nhật"
            movies={(latest?.items ?? []).slice(0, 10)}
          />
        </Reveal>
        <Reveal>
          <MovieRail
            title="Phim lẻ"
            href="/list/phim-le"
            movies={phimLe?.items ?? []}
          />
        </Reveal>
        <Reveal>
          <MovieRail
            title="Phim bộ"
            href="/list/phim-bo"
            movies={phimBo?.items ?? []}
          />
        </Reveal>
        <Reveal>
          <MovieRail
            title="Hoạt hình"
            href="/the-loai/hoat-hinh"
            movies={hoatHinh?.items ?? []}
          />
        </Reveal>
        <Reveal>
          <MovieRail
            title="TV Shows"
            href="/list/tv-shows"
            movies={tvShows?.items ?? []}
          />
        </Reveal>
      </div>
    </div>
  );
}
