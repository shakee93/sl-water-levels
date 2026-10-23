// "What we know" about each reservoir, for the strips, cards and pages that used to say
// "No release data" for the CEB and Mahaweli dams (nobody publishes their gate releases live).
// Combines the live reservoir record (storage, level), our archive of the daily Mahaweli report
// (data branch, releases/*.jsonl: yesterday's level and storage, so we can say filling or not)
// and the weekly operational plan (lib/wmsWeekly.ts). Pure maths: lib/reservoirStatusCalc.ts.
// Never throws; a missing archive or weekly PDF only removes that part.

import { unstable_cache } from "next/cache";
import { archiveKey, historyKey, type RV } from "./reservoirData";
import { getWeekly } from "./wmsWeekly";
import { computeKnown, type KnownStatus } from "./reservoirStatusCalc";

export * from "./reservoirStatusCalc";

const RAW = "https://raw.githubusercontent.com/shakee93/sl-water-levels/data/releases";
const DAY_MS = 86_400_000;
const COLOMBO_MS = 5.5 * 3_600_000;
const colomboDay = (ms: number) => new Date(ms + COLOMBO_MS).toISOString().slice(0, 10);
const LOOKBACK_DAYS = 5;

type DayPt = { day: string; levelMsl: number | null; pct: number | null };

/** One Mahaweli daily reading per reservoir per report day, from the archive's snapshots (the last snapshot of a day wins). */
const wmsDaily = unstable_cache(
  async (days: string[]): Promise<Record<string, DayPt[]>> => {
    const files = await Promise.all(
      days.map(async (day) => {
        try {
          const res = await fetch(`${RAW}/${day.slice(0, 4)}/${day}.jsonl`, { cache: "no-store", signal: AbortSignal.timeout(12_000) });
          return res.ok ? { day, text: await res.text() } : null;
        } catch {
          return null;
        }
      }),
    );
    const byKey = new Map<string, Map<string, DayPt>>();
    for (const f of files.filter((x): x is { day: string; text: string } => !!x).sort((a, b) => (a.day < b.day ? -1 : 1))) {
      for (const line of f.text.split("\n")) {
        if (!line.trim()) continue;
        try {
          const snap = JSON.parse(line) as { wms?: { rows?: { name: string; day: string | null; levelMsl: number | null; storagePct: number | null }[] } };
          for (const r of snap.wms?.rows ?? []) {
            if (!r.day) continue;
            const k = archiveKey(r.name, "wms");
            if (k.skip) continue;
            const m = byKey.get(k.key) ?? new Map<string, DayPt>();
            m.set(r.day, { day: r.day, levelMsl: r.levelMsl, pct: r.storagePct });
            byKey.set(k.key, m);
          }
        } catch {
          /* skip a bad line */
        }
      }
    }
    return Object.fromEntries([...byKey].map(([k, m]) => [k, [...m.values()].sort((a, b) => (a.day < b.day ? -1 : 1))]));
  },
  ["reservoir-wms-daily-v1"],
  { revalidate: 600 },
);

/** What is known about each reservoir, keyed by slug. Reservoirs with nothing known are left out. */
export async function getKnownStatuses(items: RV[], now = Date.now()): Promise<Map<string, KnownStatus>> {
  const out = new Map<string, KnownStatus>();
  const today = colomboDay(now);
  const days = Array.from({ length: LOOKBACK_DAYS }, (_, i) => colomboDay(now - i * DAY_MS)).reverse();
  const [weekly, daily] = await Promise.all([getWeekly().catch(() => null), wmsDaily(days).catch(() => ({}) as Record<string, DayPt[]>)]);
  for (const rv of items) {
    const w = weekly?.items.find((x) => x.slug === rv.slug || (!!rv.catalogueId && x.reservoirId === rv.catalogueId)) ?? null;
    const series = daily[historyKey(rv)] ?? [];
    const prev = rv.wms ? [...series].reverse().find((p) => p.day < rv.wms!.day) ?? null : null;
    const st = computeKnown({
      today,
      storage: rv.storage,
      wms: rv.wms ? { day: rv.wms.day, fresh: rv.wms.fresh, levelMsl: rv.wms.levelMsl } : null,
      prev,
      catalogueId: rv.catalogueId,
      flow: rv.flow,
      weekly: weekly ? { item: w, meetingDate: weekly.meetingDate, nextWeek: weekly.nextWeek } : null,
    });
    if (st.known) out.set(rv.slug, st);
  }
  return out;
}

export async function getKnownStatus(rv: RV): Promise<KnownStatus | null> {
  return (await getKnownStatuses([rv])).get(rv.slug) ?? null;
}
