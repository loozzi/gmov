import { NextResponse } from "next/server";

/**
 * Runtime public config. Read from process env ON EACH REQUEST (no-store),
 * so changing PUBLIC_API_URL only needs a container restart — never a rebuild.
 * Falls back to the legacy build-time var for compatibility.
 */
export async function GET() {
  const apiUrl =
    process.env.PUBLIC_API_URL ??
    process.env.NEXT_PUBLIC_API_URL ??
    "http://localhost:8000";
  return NextResponse.json(
    { apiUrl },
    { headers: { "Cache-Control": "no-store" } },
  );
}
