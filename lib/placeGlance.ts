// Server side of "My places": turns place keys (lib/myPlaces.ts) into the one-glance answer for each place, using
// exactly the same code the pages use (getNational for gauges, loadTown + assessTown for towns), so the home card, the
// push messages and the page a visitor opens can never disagree. Fails soft: a place we cannot resolve is dropped, a
// place we cannot read comes back with tone "stale" (never "normal").
import { getNational, type NationalStation } from "./arcgis";
import { assessTown } from "./townRisk";
import { loadTown } from "./townData";
import { placeBySlug } from "./places";
import { stationDisplayName } from "./displayName";
import { formatLevel } from "./units";
import { STEADY_M_PER_H } from "../app/verdict";
import type { Glance, ParsedKey } from "./myPlaces";

const trendOf = (rateM: number | null): Glance["trend"] => (rateM == null ? "unknown" : Math.abs(rateM) < STEADY_M_PER_H ? "steady" : rateM > 0 ? "up" : "down");

function stationGlance(s: NationalStation): Glance {
  return {
    key: `s:${s.station}`,
    kind: "s",
    name: stationDisplayName(s.station),
    href: s.href,
    tone: s.tier,
    street: null,
    streetDrives: false,
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
    street: r.street?.level ?? null,
    streetDrives: !!r.street?.drives,
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
          return s ? stationGlance(s) : null;
        }
        return await townGlance(k, lv);
      } catch {
        // one place failing must not blank the rest; "stale" says "we cannot check", never "calm"
        if (k.kind === "t") {
          const p = placeBySlug(k.slug);
          return p ? { key: k.key, kind: "t", name: p.name, href: `/flood/${p.slug}`, tone: "stale", street: null, streetDrives: false, trend: "unknown", levelText: null, rain24: null, rainNext24: null, gaugeStation: null, ts: null } : null;
        }
        return null;
      }
    }),
  );
  return out.filter((g): g is Glance => g !== null);
}
