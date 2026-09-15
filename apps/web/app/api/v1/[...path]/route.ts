import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Same-origin API proxy (RUNTIME, dev + standalone prod).
 *
 * The browser only ever talks to the Next.js origin: every `/api/v1/*`
 * request is forwarded server-side to BACKEND_URL. There is deliberately
 * NO client-side base URL — no CORS, no PUBLIC_API_URL, no port confusion
 * in devtools. Changing BACKEND_URL needs only a restart, never a rebuild.
 *
 * NOTE: rewrites() in next.config cannot do this — the destination URL is
 * baked into routes-manifest.json at BUILD time. A Route Handler runs per
 * request, so process.env is always fresh here.
 *
 * Local Route Handlers (/api/auth/*) live alongside this proxy but never
 * collide: Next.js prefers the more specific route for its own prefix.
 */

function backendBase(): string {
  return (process.env.BACKEND_URL ?? "http://localhost:8000").replace(
    /\/$/,
    "",
  );
}

// Hop-by-hop headers must never be forwarded (fetch recomputes framing).
const SKIP_REQUEST = new Set([
  "host",
  "connection",
  "content-length",
  "transfer-encoding",
  "keep-alive",
  "upgrade",
]);
const SKIP_RESPONSE = new Set([
  "connection",
  "content-encoding",
  "content-length",
  "keep-alive",
  "transfer-encoding",
  "upgrade",
]);

async function proxy(
  req: NextRequest,
  ctx: { params: Promise<{ path: string[] }> },
): Promise<NextResponse> {
  const { path } = await ctx.params;
  const incoming = new URL(req.url);
  const target = `${backendBase()}/api/v1/${path.map(encodeURIComponent).join("/")}${incoming.search}`;

  const headers = new Headers();
  req.headers.forEach((value, key) => {
    if (!SKIP_REQUEST.has(key.toLowerCase())) headers.set(key, value);
  });

  let upstream: Response;
  try {
    upstream = await fetch(target, {
      method: req.method,
      headers,
      body:
        req.method === "GET" || req.method === "HEAD"
          ? undefined
          : (req.body as BodyInit | null | undefined),
      // Required by undici when the request body is a stream.
      ...(req.method === "GET" || req.method === "HEAD"
        ? {}
        : { duplex: "half" as const }),
    });
  } catch {
    return NextResponse.json(
      { detail: "Không kết nối được máy chủ.", code: "UPSTREAM_ERROR" },
      { status: 502 },
    );
  }

  const outHeaders = new Headers();
  upstream.headers.forEach((value, key) => {
    if (!SKIP_RESPONSE.has(key.toLowerCase())) outHeaders.set(key, value);
  });
  // Stream the upstream body straight through — no buffering.
  return new NextResponse(
    upstream.status === 204 || upstream.status === 304 ? null : upstream.body,
    { status: upstream.status, headers: outHeaders },
  );
}

export const GET = proxy;
export const POST = proxy;
export const PUT = proxy;
export const PATCH = proxy;
export const DELETE = proxy;
