export const BACKEND_URL =
  process.env.BACKEND_URL ??
  process.env.NEXT_PUBLIC_API_URL ??
  "http://localhost:8000";

export const REFRESH_COOKIE = "gmov_refresh";
const THIRTY_DAYS = 60 * 60 * 24 * 30;

export const refreshCookieOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: THIRTY_DAYS,
};
