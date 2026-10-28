// RiverNet (rivernet.lk, Leecom SCADA Systems for the Disaster Management Centre): server-only fetcher for the public dashboard JSON
// (owner decision 28 Oct 2026). Maths and tables: lib/rivernetCalc.ts. Pattern: lib/hmis.ts, lib/curw.ts.
//
// REMOVAL SWITCH (if RiverNet objects): make getRivernetLevels() return null. Every caller then shows nothing: no RiverNet gauge in
// getNational / fetchStations / fetchStationData, no "Latest (1-minute sensor)" note, a skipped health check.
//
// Politeness: the API serves only cached paths, one device per call, so each device we read costs 2 small requests (title ~3-6 KB for the
// real newest-reading time, chart ~270 KB for the last 24 h) per 10 minutes, shared by every page and language (unstable_cache; the request
// is made INSIDE it so an error is never cached and the last good copy keeps serving). At most 3 requests in flight, User-Agent with the site
// URL and the owner's address, 12 s timeout, shapes validated, the browser never calls RiverNet. The cache entry keeps 10-minute points
// (the Next data cache refuses entries over 2 MB). Callers wait at most RIVERNET_BUDGET_MS (soft(): the fetch carries on in the background).
import { unstable_cache } from "next/cache";
import { soft } from "./soft";
import { buildDevice, RIVERNET_READ, type RivernetDevice } from "./rivernetCalc";

export * from "./rivernetCalc";

const API = "https://api.rivernet.lk/cache-api.php";
const UA = "waterlevels.lk (https://waterlevels.lk; shakee.zats@gmail.com)";
export const RIVERNET_BUDGET_MS = 2500;
const REVALIDATE_S = 600;
// Window in the path is ignored by the cache API (it returns the last 24 h) but the path shape must look like the dashboard's.
const WINDOW = () => {
  const to = Math.floor(Date.now() / 3_600_000) * 3_600_000;
  return `${to - 86_400_000}/${to}`;
};

let inFlight = 0;
const waiting: (() => void)[] = [];
async function slot<T>(f: () => Promise<T>): Promise<T> {
  if (inFlight >= 6) await new Promise<void>((r) => waiting.push(r));
  inFlight++;
  try { return await f(); } finally { inFlight--; waiting.shift()?.(); }
}

async function getJson(path: string): Promise<unknown> {
  return slot(async () => {
    const url = `${API}?path=${encodeURIComponent(path)}`;
    const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" }, signal: AbortSignal.timeout(12_000), cache: "no-store" });
    if (!res.ok) throw new Error(`RiverNet ${path.split("?")[0]} -> HTTP ${res.status}`);
    return res.json();
  });
}

export type RivernetLevels = { fetchedAt: number; devices: RivernetDevice[] };

async function loadDevice(key: string): Promise<RivernetDevice> {
  const w = WINDOW();
  const q = `keys=${key}&last24HoursData=1&isPublic=1`;
  const [title, chart] = await Promise.all([
    getJson(`api/reports/river-level/title/minute/${w}?${q}`),
    getJson(`api/reports/river-level/chart/minute/${w}?${q}`),
  ]);
  const d = buildDevice(key, title, chart);
  if (!d) throw new Error(`RiverNet device ${key}: unexpected shape`);
  return d;
}

const cachedFor = new Map<string, () => Promise<RivernetDevice>>();
function deviceCached(key: string) {
  let f = cachedFor.get(key);
  if (!f) { f = unstable_cache(() => loadDevice(key), ["rivernet-device-v1", key], { revalidate: REVALIDATE_S }); cachedFor.set(key, f); }
  return f;
}

async function loadAll(): Promise<RivernetLevels> {
  const got = await Promise.all(RIVERNET_READ.map((e) => deviceCached(e.key)().catch(() => null)));
  const devices = got.filter((d): d is RivernetDevice => d != null);
  if (devices.length === 0) throw new Error("RiverNet: no device could be read");
  return { fetchedAt: Date.now(), devices };
}

/**
 * Every device we read (new gauges and the duplicates' sensors), each with its last 24 h in real UTC metres at 10-minute spacing; a device
 * that is not reporting has an empty series. null when RiverNet is slow, down, or switched off here. Never throws.
 */
export const getRivernetLevels = (budgetMs = RIVERNET_BUDGET_MS): Promise<RivernetLevels | null> => soft(loadAll().catch(() => null), budgetMs, null);

/** For the health check: straight to RiverNet, one device at a time, nothing cached. */
export async function rivernetDirect(keys: string[]): Promise<RivernetDevice[]> {
  const out: RivernetDevice[] = [];
  for (const k of keys) out.push(await loadDevice(k));
  return out;
}

/** One device (2 requests, same per-device cache as getRivernetLevels): a gauge page must not wait for all 19 on a cold cache. null when slow or down. */
export const getRivernetDevice = (key: string, budgetMs = 4000): Promise<RivernetDevice | null> => soft(deviceCached(key)().catch(() => null), budgetMs, null);
