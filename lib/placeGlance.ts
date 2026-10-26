// Server side of "My places": turns place keys (lib/myPlaces.ts) into the one-glance answer for each place, using
// exactly the same code the pages use (getNational for gauges, loadTown + assessTown for towns), so the home card, the
// push messages and the page a visitor opens can never disagree. Fails soft: a place we cannot resolve is dropped, a
// place we cannot read comes back with tone "stale" (never "normal").
import { getNational, type NationalStation } from "./arcgis";
import { assessTown } from "./townRisk";
import { getStationVerdicts } from "./stationVerdict";
import { soft } from "./soft";
import { loadTown } from "./townData";
import { placeBySlug } from "./places";
import { stationDisplayName } from "./displayName";
import { formatLevel } from "./units";
import { STEADY_M_PER_H } from "../app/verdict";
import { getReleases, releaseAffectingFrom } from "./releases";
import { getBasinWeather, hasCatchment } from "./weather";
import { rainRiskOf } from "./rainRisk";
import { forecastRainFor, measuredAtGauge } from "./stationRain";
import { measuredAt } from "./forecast";
import type { Glance, ParsedKey } from "./myPlaces";

const trendOf = (rateM: number | null): Glance["trend"] => (rateM == null ? "unknown" : Math.abs(rateM) < STEADY_M_PER_H ? "steady" : rateM > 0 ? "up" : "down");

function stationGlance(s: NationalStation, verdict?: NationalStation["tier"]): Glance {
  return {
    key: `s:${s.station}`,
    kind: "s",
    name: stationDisplayName(s.station),
    href: s.href,
    tone: verdict ?? s.tier,
    street: null,
    trend: s.tier === "stale" ? "unknown" : trendOf(s.rate3hM),
    levelText: s.latest?.water_level != null && s.tier !== "stale" ? formatLevel(s.latest.water_level, s.unit) : null,
    rain24: null,
    rainNext24: null,
    gaugeStation: s.station,
    ts: s.latest?.ts ?? null,
  };
}

async function townGlance(k: Extract<ParsedKey, { kind: "t" }>, lv: Record<string, number>): Promise<Glance | null> {
  const place = placeBySlug(k.slug);
  if (!place) return null;
  const data = await loadTown(place);
  // the visitor's own street level applies to the gauge the estimate rests on (same rule as the town page)
  const base = assessTown(data.input);
  const gaugeStation = base.gauge?.station ?? data.gauge?.station ?? null;
  const mine = k.lv ?? (gaugeStation ? lv[gaugeStation] ?? null : null);
  const r = mine != null ? assessTown(data.input, mine) : base;
  const g = r.gauge;
  const stale = r.tone === "stale";
  return {
    key: k.key,
    kind: "t",
    name: place.name,
    href: `/flood/${place.slug}`,
    tone: r.tone,
    baseTone: r.baseTone,
    street: r.lowSpot?.level ?? null,
    trend: stale || r.trend === "unknown" ? "unknown" : r.trend,
    levelText: g?.level != null && !stale ? formatLevel(g.level, g.unit) : null,
    rain24: data.input.streetRain ? data.input.streetRain.mm24h : data.input.rain?.past24hMm ?? null,
    rainNext24: data.input.rain?.next24hMm ?? null,
    gaugeStation,
    ts: g?.ts ?? null,
  };
}

/** Glances for the given keys, in the same order; keys that cannot be resolved are left out. */
export async function loadGlances(keys: ParsedKey[], lv: Record<string, number> = {}): Promise<Glance[]> {
  if (keys.length === 0) return [];
  const national = await getNational().catch(() => [] as NationalStation[]);
  const byName = new Map(national.map((s) => [s.station, s]));
  const out = await Promise.all(
    keys.map(async (k): Promise<Glance | null> => {
      try {
        if (k.kind === "s") {
          const s = byName.get(k.name);
          // the gauge page's verdict (forecast lift), so My places and push say what the page says; 2.5 s cap, else the raw tier
          const v = s ? await soft(getStationVerdicts().then((m) => m[s.station]).catch(() => undefined), 2500, undefined) : undefined;
          return s ? stationGlance(s, v) : null;
        }
        return await townGlance(k, lv);
      } catch {
        // one place failing must not blank the rest; "stale" says "we cannot check", never "calm"
        if (k.kind === "t") {
          const p = placeBySlug(k.slug);
          return p ? { key: k.key, kind: "t", name: p.name, href: `/flood/${p.slug}`, tone: "stale", street: null, trend: "unknown", levelText: null, rain24: null, rainNext24: null, gaugeStation: null, ts: null } : null;
        }
        return null;
      }
    }),
  );
  const glances = out.filter((g): g is Glance => g !== null);
  // which reservoir release (if any) is heading for each place's gauge; fails soft: no answer = no release claimed
  const rel = await getReleases().catch(() => null);
  if (rel) {
    for (const g of glances) {
      if (!g.gaugeStation) continue;
      const a = releaseAffectingFrom(rel, g.gaugeStation);
      g.release = a.active && a.reservoir ? { name: a.reservoir, confirmed: a.confirmed, etaHours: a.etaHours } : null;
    }
  }
  // Rain at pinned gauges for the "Today" line: what the gauge's sensor measured in 24 h (null without a sensor) and the forecast model's rain over
  // the hills above it for the next 24 h. Towns keep their own point figures. Cached weather call, 3 s cap, fails soft (null = unknown).
  await Promise.all(
    glances.map(async (g) => {
      const s = g.kind === "s" && g.gaugeStation ? byName.get(g.gaugeStation) : null;
      if (!s) return;
      g.rain24 = measuredAtGauge(s.station, s.trend24h, Date.now())?.mm24h ?? null;
      try {
        const f = await Promise.race([forecastRainFor(s.basin, s.station), new Promise<null>((r) => setTimeout(() => r(null), 3000))]);
        g.rainNext24 = f?.next24h ?? null;
      } catch {
        /* unknown */
      }
    }),
  );
  // heavy rain forecast above the gauge: only for places that are not calm (the weather call is cached 30 min), fails soft
  await Promise.all(
    glances.map(async (g) => {
      const s = g.gaugeStation ? byName.get(g.gaugeStation) : null;
      if (!s || !["watch", "alert", "minor", "major"].includes(g.tone)) return;
      // rain the gauges measured: no network call, and it works for gauges with no catchment grid too
      if (measuredAt(national, s.basin, s.station, Date.now())) {
        g.rainRisk = "measured";
        return;
      }
      if (!hasCatchment(s.basin, s.station)) return;
      try {
        const w = await Promise.race([getBasinWeather(s.basin, s.station), new Promise<null>((r) => setTimeout(() => r(null), 3000))]);
        if (w && w.ok) g.rainRisk = rainRiskOf({ det: w.data.next24hMm.det, p90: w.data.next24hMm.p90 }) != null;
      } catch {
        /* unknown: no claim */
      }
    }),
  );
  return glances;
}
