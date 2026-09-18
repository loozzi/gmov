import { ImageResponse } from "next/og";

// Default social image — original brand artwork (gradient + play mark),
// deliberately NOT a movie poster (no copyrighted artwork as site default).
export const runtime = "edge";
// Rendered on demand: prerendering at build has no origin, so the bundled
// font's asset URL cannot be fetched there.
export const dynamic = "force-dynamic";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// Vietnamese-capable font (satori's fallback lacks diacritics). Loaded lazily:
// a module-scope fetch also runs when the build imports this route, where the
// bundled asset URL has no origin and fails to parse.
let fontBold: Promise<ArrayBuffer> | null = null;
function loadBoldFont() {
  fontBold ??= fetch(
    new URL("../assets/fonts/Roboto-Bold.ttf", import.meta.url),
  ).then((res) => res.arrayBuffer());
  return fontBold;
}

export default async function OgImage() {
  const bold = await loadBoldFont();
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background: "linear-gradient(135deg, #0a0a0f 0%, #1c0a12 60%, #2b0e18 100%)",
          color: "#f4f4f5",
          fontFamily: "Roboto",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 28,
          }}
        >
          <div
            style={{
              width: 120,
              height: 120,
              borderRadius: 30,
              background: "linear-gradient(135deg, #fb4d6d, #e11d48)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 56,
              color: "#fff",
            }}
          >
            ▶
          </div>
          <div style={{ fontSize: 110, fontWeight: 800, letterSpacing: -4 }}>
            gmov
          </div>
        </div>
        <div style={{ marginTop: 24, fontSize: 36, color: "#a1a1aa" }}>
          Xem phim mỗi ngày — miễn phí, không giới hạn
        </div>
      </div>
    ),
    {
      ...size,
      fonts: [{ name: "Roboto", data: bold, weight: 700, style: "normal" }],
    },
  );
}
