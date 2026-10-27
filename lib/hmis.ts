// HMIS (hmis.gov.lk), the Irrigation Department's Hydro-Meteorological Information System: server-only fetcher for the
// public dashboard's JSON (owner decision 27 Oct 2026: public data, "Public Access", no login). Maths and tables: lib/hmisCalc.ts.
//
// Politeness: one request per endpoint per 10 minutes, shared by every page and language through the Next data cache
// (unstable_cache; the request is made INSIDE it so an error is never cached and the last good copy keeps serving), User-Agent with
// the site URL and the owner's address, 12 s timeout, shape validated. The browser never calls HMIS. Callers wait at most
// HMIS_BUDGET_MS (soft(): the fetch carries on in the background and the next render finds it cached) and show nothing when it
// has nothing. No D1 here: the optional archive is scripts/hmis-snapshot.mjs writing JSON to the data branch.
import { unstable_cache } from "next/cache";
import { soft } from "./soft";
import {
  normaliseLevelRows,
  normaliseRain,
  type HmisDevice,
  type HmisRainDevice,
} from "./hmisCalc";

export * from "./hmisCalc";

const BASE = "https://hmis.gov.lk/api/v1";
const UA = "sl-water-levels (+https://waterlevels.lk; shakee.zats@gmail.com)";
export const HMIS_BUDGET_MS = 2500;
const REVALIDATE_S = 600;

async function getJson(path: string): Promise<unknown> {
  const res = await fetch(`${BASE}/${path}`, { headers: { "User-Agent": UA, Accept: "application/json" }, signal: AbortSignal.timeout(12_000), cache: "no-store" });
  if (!res.ok) throw new Error(`HMIS ${path} -> HTTP ${res.status}`);
  return res.json();
}
const dataOf = (j: unknown): unknown => (j && typeof j === "object" ? (j as { data?: unknown }).data : undefined);

export type HmisLevels = { fetchedAt: number; devices: HmisDevice[] };
export type HmisRain = { fetchedAt: number; devices: HmisRainDevice[] };
/** One warning as HMIS publishes it. The list is empty on a calm day; the item shape is unknown, so every field is optional. */
export type HmisWarning = { title: string; text: string; ts: number | null; raw: Record<string, unknown> };
export type HmisWarnings = { fetchedAt: number; items: HmisWarning[] };

async function loadLevels(): Promise<HmisLevels> {
  const rows = dataOf(await getJson("getwaterlevelsummary/1_day/live"));
  if (!Array.isArray(rows) || rows.length === 0) throw new Error("HMIS water levels: no rows");
  const devices = normaliseLevelRows(rows);
  if (devices.length < 10) throw new Error(`HMIS water levels: only ${devices.length} devices`);
  return { fetchedAt: Date.now(), devices };
}
async function loadRain(): Promise<HmisRain> {
  const rows = dataOf(await getJson("getrainfalldevices"));
  if (!Array.isArray(rows) || rows.length === 0) throw new Error("HMIS rain: no rows");
  const devices = normaliseRain(rows);
  if (devices.length < 20) throw new Error(`HMIS rain: only ${devices.length} usable devices`);
  return { fetchedAt: Date.now(), devices };
}
async function loadWarnings(): Promise<HmisWarnings> {
  const rows = dataOf(await getJson("warnings"));
  if (!Array.isArray(rows)) throw new Error("HMIS warnings: no list");
  const items: HmisWarning[] = [];
  for (const r of rows) {
    if (!r || typeof r !== "object") continue;
    const o = r as Record<string, unknown>;
    const s = (...keys: string[]) => keys.map((k) => o[k]).find((v) => typeof v === "string" && v.trim()) as string | undefined;
    const text = s("message", "description", "text", "warning", "body", "content") ?? "";
    const title = s("title", "name", "subject", "type", "level") ?? text.slice(0, 80);
    if (!title && !text) continue;
    const when = s("timestamp", "created_at", "createdAt", "issued_at", "date", "time");
    const ms = when ? Date.parse(when) : NaN;
    items.push({ title: title.trim(), text: text.trim(), ts: Number.isFinite(ms) ? ms : null, raw: o });
  }
  return { fetchedAt: Date.now(), items };
}

const levelsCached = unstable_cache(loadLevels, ["hmis-levels-v1"], { revalidate: REVALIDATE_S });
const rainCached = unstable_cache(loadRain, ["hmis-rain-v1"], { revalidate: REVALIDATE_S });
const warningsCached = unstable_cache(loadWarnings, ["hmis-warnings-v1"], { revalidate: REVALIDATE_S });

/** Every HMIS water-level device with its last 24 h (real UTC, metres); null when HMIS is slow or down. Never throws. */
export const getHmisLevels = (budgetMs = HMIS_BUDGET_MS): Promise<HmisLevels | null> => soft(levelsCached().catch(() => null), budgetMs, null);
/** The ground rain gauges (24 h sums); null when HMIS is slow or down. */
export const getHmisRain = (budgetMs = HMIS_BUDGET_MS): Promise<HmisRain | null> => soft(rainCached().catch(() => null), budgetMs, null);
/** Official HMIS warnings; null when unavailable, items empty when there are none. */
export const getHmisWarnings = (budgetMs = HMIS_BUDGET_MS): Promise<HmisWarnings | null> => soft(warningsCached().catch(() => null), budgetMs, null);

/** For the health check: straight to HMIS, nothing cached or stored. */
export async function hmisDirect(): Promise<{ levels: HmisLevels; rain: HmisRain; warnings: HmisWarnings }> {
  const [levels, rain, warnings] = await Promise.all([loadLevels(), loadRain(), loadWarnings()]);
  return { levels, rain, warnings };
}
