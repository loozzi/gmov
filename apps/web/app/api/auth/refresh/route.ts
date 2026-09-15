import { NextResponse } from "next/server";
import { cookies } from "next/headers";

import {
  BACKEND_URL,
  REFRESH_COOKIE,
  refreshCookieOptions,
} from "@/lib/server";

export async function POST() {
  const store = await cookies();
  const refreshToken = store.get(REFRESH_COOKIE)?.value;
  if (!refreshToken) {
    return NextResponse.json(
      { detail: "No refresh token.", code: "UNAUTHORIZED" },
      { status: 401 },
    );
  }
  const backend = await fetch(`${BACKEND_URL}/api/v1/auth/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refresh_token: refreshToken }),
  });
  const data = await backend.json();
  if (!backend.ok) {
    const res = NextResponse.json(data, { status: backend.status });
    res.cookies.delete(REFRESH_COOKIE);
    return res;
  }
  const res = NextResponse.json({
    access_token: data.access_token,
    token_type: data.token_type,
  });
  res.cookies.set(REFRESH_COOKIE, data.refresh_token, refreshCookieOptions);
  return res;
}
