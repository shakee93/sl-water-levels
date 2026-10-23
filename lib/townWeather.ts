// Rain at one town's own coordinates (Open-Meteo, keyless). Unlike lib/weather.ts, which averages
// rain over a gauge's upstream catchment, this is the point value where people live: it is what
// fills the streets and canals of the town itself.
//
// Fails soft like the rest of the weather code: { ok: false, reason } and the caller says so.
// Hours are keyed by their END in epoch ms (Open-Meteo reports the sum over the preceding hour).
import { getJson, type Fetched } from "./weather";

/** One quick retry: Open-Meteo sometimes answers 429/5xx under bursts, and a failure would otherwise be cached into the page for its whole ISR window. */
async function getJsonRetry(url: string, revalidate: number) {
  const first = await getJson(url, revalidate);
  if (first.ok) return first;
  await new Promise((r) => setTimeout(r, 500));
  return getJson(url, revalidate);
}

const HOUR_MS = 3_600_000;
const REVALIDATE_S = 1800;
/** Rounding the coordinates to 0.1 deg (~11 km, about the model grid) lets nearby towns share one cached response. */
const cell = (v: number) => Math.round(v * 10) / 10;

export type TownRain = {
  /** The hour treated as "now"; hours up to it are the analysis, later ones the forecast. */
  nowHour: number;
  /** Hourly mm, 24 hours up to now (oldest first). */
  past: { end: number; mm: number }[];
  /** Hourly mm, the next 24 hours (soonest first). */
  next: { end: number; mm: number }[];
  past6hMm: number;
  past24hMm: number;
  next6hMm: number;
  next24hMm: number;
  /** 90th percentile of the ensemble members' next-24h total; null when the ensemble was unavailable. */
  next24hP90Mm: number | null;
  /** Same for the next 6 hours. */
  next6hP90Mm: number | null;
};

type Hourly = { hourly?: { time?: string[]; [k: string]: unknown } };

export async function getTownRain(lat: number, lon: number, now = Date.now()): Promise<Fetched<TownRain>> {
  const la = cell(lat), lo = cell(lon);
  const nowHour = Math.floor(now / HOUR_MS) * HOUR_MS;
  const [det, ens] = await Promise.all([
    getJsonRetry(`https://api.open-meteo.com/v1/forecast?latitude=${la}&longitude=${lo}&hourly=precipitation&past_days=1&forecast_days=2&timezone=UTC`, REVALIDATE_S),
    getJson(`https://ensemble-api.open-meteo.com/v1/ensemble?latitude=${la}&longitude=${lo}&hourly=precipitation&models=ecmwf_ifs025&past_days=0&forecast_days=2&timezone=UTC`, REVALIDATE_S),
  ]);
  if (!det.ok) return { ok: false, reason: `rain forecast unavailable (${det.reason})` };
  const h = (det.data as Hourly).hourly;
  const times = h?.time;
  const vals = h?.precipitation as (number | null)[] | undefined;
  if (!times || !vals) return { ok: false, reason: "rain forecast response was empty" };
  const byEnd = new Map<number, number>();
  times.forEach((t, i) => {
    const v = vals[i];
    if (v != null && Number.isFinite(v)) byEnd.set(Date.parse(`${t}Z`), v);
  });
  const win = (from: number, to: number) => {
    const out: { end: number; mm: number }[] = [];
    for (let e = from + HOUR_MS; e <= to; e += HOUR_MS) {
      const mm = byEnd.get(e);
      if (mm == null) return null;
      out.push({ end: e, mm });
    }
    return out;
  };
  const past = win(nowHour - 24 * HOUR_MS, nowHour);
  const next = win(nowHour, nowHour + 24 * HOUR_MS);
  if (!past || !next) return { ok: false, reason: "rain forecast was incomplete" };
  const sum = (xs: { mm: number }[]) => xs.reduce((s, x) => s + x.mm, 0);

  let p90_24: number | null = null;
  let p90_6: number | null = null;
  if (ens.ok) {
    const eh = (ens.data as Hourly).hourly;
    const et = eh?.time;
    if (eh && et) {
      const cols = Object.keys(eh).filter((k) => k === "precipitation" || k.startsWith("precipitation_member"));
      const t24: number[] = [];
      const t6: number[] = [];
      for (const c of cols) {
        const arr = eh[c] as (number | null)[];
        let a = 0, b = 0, ok = true;
        et.forEach((t, i) => {
          const e = Date.parse(`${t}Z`);
          if (e <= nowHour || e > nowHour + 24 * HOUR_MS) return;
          const v = arr[i];
          if (v == null || !Number.isFinite(v)) ok = false;
          else {
            a += v;
            if (e <= nowHour + 6 * HOUR_MS) b += v;
          }
        });
        if (ok) { t24.push(a); t6.push(b); }
      }
      if (t24.length >= 10) {
        const q = (xs: number[]) => xs.sort((x, y) => x - y)[Math.round(0.9 * (xs.length - 1))];
        p90_24 = q(t24);
        p90_6 = q(t6);
      }
    }
  }
  return {
    ok: true,
    data: {
      nowHour, past, next,
      past6hMm: sum(past.slice(-6)), past24hMm: sum(past),
      next6hMm: sum(next.slice(0, 6)), next24hMm: sum(next),
      next24hP90Mm: p90_24, next6hP90Mm: p90_6,
    },
  };
}
