/** Upstream episode names are bare numbers ("1", "2"); read them as "tập 2". */
export function episodeLabel(name: string): string {
  const trimmed = name.trim();
  return /^\d+$/.test(trimmed) ? `tập ${trimmed}` : trimmed;
}

/** "tập 2/12" when the saved row carries a series position, else null. */
export function seriesLabel(
  index: number | null | undefined,
  total: number | null | undefined,
): string | null {
  return index != null && total != null && total > 0
    ? `tập ${index}/${total}`
    : null;
}

export function progressLabel(
  index: number | null | undefined,
  total: number | null | undefined,
  name: string,
): string {
  return seriesLabel(index, total) ?? episodeLabel(name);
}

/** 0–100 series position; falls back to the time ratio when no position. */
export function progressPercent(
  index: number | null | undefined,
  total: number | null | undefined,
  position: number,
  duration: number | null | undefined,
): number {
  if (index != null && total != null && total > 0) {
    return Math.min(100, Math.max(0, (index / total) * 100));
  }
  if (duration != null && duration > 0) {
    return Math.min(100, Math.max(0, (position / duration) * 100));
  }
  return 0;
}
