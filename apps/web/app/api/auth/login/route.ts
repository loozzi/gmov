import { NextResponse } from "next/server";
import { cookies } from "next/headers";

import {
  BACKEND_URL,
  REFRESH_COOKIE,
  refreshCookieOptions,
} from "@/lib/server";

export async function POST(request: Request) {
  const { username, password } = (await request.json()) as {
    username?: string;
    password?: string;
  };
  if (!username || !password) {
    return NextResponse.json(
      { detail: "Thiếu tên đăng nhập hoặc mật khẩu.", code: "VALIDATION_ERROR" },
      { status: 400 },
    );
  }
  const form = new URLSearchParams({ username, password });
  const backend = await fetch(`${BACKEND_URL}/api/v1/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form,
  });
  const data = await backend.json();
  if (!backend.ok) {
    return NextResponse.json(data, { status: backend.status });
  }
  const res = NextResponse.json({
    access_token: data.access_token,
    token_type: data.token_type,
  });
  const store = await cookies();
  store.set(REFRESH_COOKIE, data.refresh_token, refreshCookieOptions);
  return res;
}
