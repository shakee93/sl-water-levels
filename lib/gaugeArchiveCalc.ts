// Pure helpers for lib/gaugeArchive.ts (no next/cache, so node tests can import them).
const LK = 5.5 * 3_600_000;
const DAY = 86_400_000;
export type ArchivePoint = { ts: number; m: number };

/** The Colombo days covering [now - days, now], oldest first. */
export function archiveDays(days: number, now = Date.now()): string[] {
  const out: string[] = [];
  for (let t = now - days * DAY; t <= now + DAY; t += DAY) {
    const d = new Date(t + LK).toISOString().slice(0, 10);
    if (!out.includes(d)) out.push(d);
  }
  const today = new Date(now + LK).toISOString().slice(0, 10);
  return out.filter((d) => d <= today);
}

/** Archive points merged under the live series: live wins where both exist (anything at or after the live series' first point is dropped). */
export function mergeArchive(archive: ArchivePoint[], live: ArchivePoint[], fromTs: number): ArchivePoint[] {
  const firstLive = live.length ? Math.min(...live.map((p) => p.ts)) : Infinity;
  const seen = new Set<number>();
  const old = archive
    .filter((p) => p.ts >= fromTs && p.ts < firstLive)
    .sort((a, b) => a.ts - b.ts)
    .filter((p) => (seen.has(p.ts) ? false : (seen.add(p.ts), true)));
  return [...old, ...live];
}
