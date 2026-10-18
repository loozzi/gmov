import { redirect } from "next/navigation";

// `/xem/<slug>` without an episode: the detail page picks the episode
// (resume point or first) and follows upstream slug renames.
export default async function WatchMovieRedirect({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  redirect(`/phim/${slug}`);
}
