/** Guards the `next` query param against open redirects: only same-origin,
 * absolute paths ("/me/favorites") are accepted. Backslashes and control
 * characters are rejected because the WHATWG URL parser turns "/\evil.com"
 * and "/\tevil.com" into "//evil.com" (a cross-origin target). */
export function safeNextPath(
  next: string | null | undefined,
): string | null {
  if (!next) return null;
  if (/[\u0000-\u001f\u007f\\]/.test(next)) return null;
  if (!next.startsWith("/") || next.startsWith("//")) return null;
  return next;
}
