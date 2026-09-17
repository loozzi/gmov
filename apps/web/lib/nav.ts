/** Guards the `next` query param against open redirects: only same-origin,
 * absolute paths ("/me/favorites") are accepted; "//evil.com" is not. */
export function safeNextPath(
  next: string | null | undefined,
): string | null {
  if (!next) return null;
  if (!next.startsWith("/") || next.startsWith("//")) return null;
  return next;
}
