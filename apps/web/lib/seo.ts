import type { Metadata } from "next";

import { GENRES, labelFor } from "@/lib/catalog";
import type { MovieDetail } from "@/lib/types";

export const SITE_NAME = "gmov";
export const SITE_LOCALE = "vi_VN";
export const SITE_DESCRIPTION =
  "Web xem phim: duyệt, tìm kiếm và theo dõi phim yêu thích.";

/** Public base URL. Server-only on purpose: `NEXT_PUBLIC_*` is inlined at build
 * time, so changing the domain would require a rebuild; every consumer here
 * (metadata, sitemap, robots) runs on the server where runtime env is enough. */
export function siteUrl(): string {
  return (process.env.SITE_URL ?? "http://localhost:3000").replace(/\/+$/, "");
}

export function absoluteUrl(path = "/"): string {
  return `${siteUrl()}${path.startsWith("/") ? path : `/${path}`}`;
}

export function relativeOrAbsolute(url: string | null | undefined): string | null {
  if (!url) return null;
  return /^https?:\/\//i.test(url) ? url : absoluteUrl(url);
}

export interface SocialImage {
  url: string;
  width?: number;
  height?: number;
  alt?: string;
}

type OpenGraphType =
  | "website"
  | "article"
  | "video.movie"
  | "video.episode"
  | "video.tv_show";

export function defaultSocialImage(): SocialImage {
  return {
    url: absoluteUrl("/opengraph-image"),
    width: 1200,
    height: 630,
    alt: SITE_NAME,
  };
}

interface BuildMetadataInput {
  title: string;
  description?: string;
  path: string;
  type?: OpenGraphType;
  images?: SocialImage[];
  noIndex?: boolean;
  /** Skip the layout's "%s | gmov" template (use for the home page). */
  absoluteTitle?: boolean;
}

export function buildMetadata({
  title,
  description = SITE_DESCRIPTION,
  path,
  type = "website",
  images,
  noIndex = false,
  absoluteTitle = false,
}: BuildMetadataInput): Metadata {
  const url = absoluteUrl(path);
  const social = images?.length ? images : [defaultSocialImage()];
  return {
    title: absoluteTitle ? { absolute: title } : title,
    description,
    alternates: { canonical: url },
    openGraph: {
      type,
      url,
      title,
      description,
      siteName: SITE_NAME,
      locale: SITE_LOCALE,
      images: social,
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: social.map((image) => image.url),
    },
    ...(noIndex ? { robots: { index: false, follow: true } } : {}),
  };
}

export function movieSocialImage(slug: string, name: string): SocialImage {
  return {
    url: absoluteUrl(`/phim/${slug}/opengraph-image`),
    width: 1200,
    height: 630,
    alt: `Thông tin phim ${name} trên ${SITE_NAME}`,
  };
}

function plainText(html: string | null | undefined): string {
  if (!html) return "";
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function websiteJsonLd(): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: SITE_NAME,
    url: siteUrl(),
    inLanguage: "vi",
    potentialAction: {
      "@type": "SearchAction",
      target: {
        "@type": "EntryPoint",
        urlTemplate: `${siteUrl()}/tim-kiem?keyword={search_term_string}`,
      },
      "query-input": "required name=search_term_string",
    },
  };
}

export function breadcrumbJsonLd(
  items: { name: string; path: string }[],
): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      item: absoluteUrl(item.path),
    })),
  };
}

export function movieJsonLd(movie: MovieDetail): Record<string, unknown> {
  const episodeCount = movie.servers.reduce(
    (total, server) => total + server.episodes.length,
    0,
  );
  const genres = movie.genres.map((genre) => labelFor(GENRES, genre, genre));
  const image = relativeOrAbsolute(movie.poster_url ?? movie.thumb_url);
  const description = plainText(movie.description);
  const casts = (movie.casts ?? "")
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean)
    .slice(0, 10);

  return {
    "@context": "https://schema.org",
    "@type": episodeCount > 1 ? "TVSeries" : "Movie",
    name: movie.name,
    ...(movie.original_name ? { alternateName: movie.original_name } : {}),
    ...(description ? { description } : {}),
    ...(image ? { image } : {}),
    ...(movie.year ? { datePublished: movie.year } : {}),
    ...(genres.length ? { genre: genres } : {}),
    ...(movie.director ? { director: { "@type": "Person", name: movie.director } } : {}),
    ...(casts.length
      ? { actor: casts.map((name) => ({ "@type": "Person", name })) }
      : {}),
    ...(episodeCount > 1 ? { numberOfEpisodes: episodeCount } : {}),
    url: absoluteUrl(`/phim/${movie.slug}`),
    inLanguage: "vi",
  };
}
