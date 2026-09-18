import { ImageResponse } from "next/og";

import { GENRES, labelFor } from "@/lib/catalog";
import { fetchMovieDetail } from "@/lib/server-movies";

// Per-movie social card: upstream poster as a dimmed backdrop, title plus
// year/genres on top. Cached a day because posters rarely change.
// Edge runtime (like the default image route): the node runtime turns the
// font's `new URL` asset into a relative "/_next/..." path that its `fetch`
// cannot parse.
export const runtime = "edge";
export const revalidate = 86400;
export const alt = "Thông tin phim trên gmov";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// Bundled Roboto (Apache-2.0) subset to latin + vietnamese: satori's built-in
// fallback lacks Vietnamese glyphs, which would show up as tofu boxes.
// Fetched lazily: a module-scope fetch also runs when the build imports this
// route, where the bundled asset URL has no origin and fails to parse.
let fontBold: Promise<ArrayBuffer> | null = null;
let fontRegular: Promise<ArrayBuffer> | null = null;

function loadBoldFont() {
  fontBold ??= fetch(
    new URL("../../../assets/fonts/Roboto-Bold.ttf", import.meta.url),
  ).then((res) => res.arrayBuffer());
  return fontBold;
}

function loadRegularFont() {
  fontRegular ??= fetch(
    new URL("../../../assets/fonts/Roboto-Regular.ttf", import.meta.url),
  ).then((res) => res.arrayBuffer());
  return fontRegular;
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
  }
  return btoa(binary);
}

async function posterDataUrl(url: string | null | undefined) {
  if (!url) return null;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const type = res.headers.get("content-type") ?? "";
    // satori supports png/jpeg; skip anything else (webp/svg) rather than
    // render a broken image.
    if (!type.startsWith("image/") || /webp|svg/.test(type)) return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    return `data:${type};base64,${toBase64(bytes)}`;
  } catch {
    return null;
  }
}

export default async function MovieOgImage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const movie = await fetchMovieDetail(slug);
  const [bold, regular, poster] = await Promise.all([
    loadBoldFont(),
    loadRegularFont(),
    posterDataUrl(movie?.poster_url ?? movie?.thumb_url),
  ]);

  const title = movie?.name ?? "gmov — Xem phim";
  const genres = (movie?.genres ?? [])
    .slice(0, 3)
    .map((genre) => labelFor(GENRES, genre, genre))
    .join(" · ");
  const subtitle = [movie?.year, genres].filter(Boolean).join("   •   ");

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          position: "relative",
          background: "linear-gradient(135deg, #0a0a0f 0%, #1c0a12 60%, #2b0e18 100%)",
          color: "#f4f4f5",
          fontFamily: "Roboto",
        }}
      >
        {poster ? (
          <img
            src={poster}
            alt=""
            width={size.width}
            height={size.height}
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width: "100%",
              height: "100%",
              objectFit: "cover",
              opacity: 0.5,
            }}
          />
        ) : null}
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            display: "flex",
            background:
              "linear-gradient(180deg, rgba(10,10,15,0.2) 0%, rgba(10,10,15,0.7) 55%, rgba(10,10,15,0.97) 100%)",
          }}
        />
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
            padding: "56px 64px",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
            <div
              style={{
                width: 64,
                height: 64,
                borderRadius: 18,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                background: "linear-gradient(135deg, #fb4d6d, #e11d48)",
                fontSize: 30,
                color: "#fff",
              }}
            >
              ▶
            </div>
            <div style={{ fontSize: 42, fontWeight: 700, letterSpacing: -1 }}>
              gmov
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div
              style={{
                display: "flex",
                fontSize: 68,
                fontWeight: 700,
                lineHeight: 1.15,
                maxWidth: 1072,
                overflow: "hidden",
                whiteSpace: "nowrap",
                textOverflow: "ellipsis",
              }}
            >
              {title}
            </div>
            {subtitle ? (
              <div
                style={{
                  display: "flex",
                  marginTop: 20,
                  fontSize: 32,
                  color: "#d4d4d8",
                }}
              >
                {subtitle}
              </div>
            ) : null}
          </div>
        </div>
      </div>
    ),
    {
      ...size,
      fonts: [
        { name: "Roboto", data: regular, weight: 400, style: "normal" },
        { name: "Roboto", data: bold, weight: 700, style: "normal" },
      ],
    },
  );
}
