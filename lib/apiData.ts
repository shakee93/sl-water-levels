// Shared builders for the public JSON endpoints (/api/levels, /api/reservoirs) and the text endpoints
// (/llms.txt, /feed.xml), so every one of them reports the same numbers the pages show.
// Levels are in feet like the rest of the site; metre gauges are converted and keep the published value.
import type { NationalStation } from "./arcgis";
import { stationDisplayName } from "./displayName";
import { statusFor } from "./status";
import { stationSlug, basinSlug } from "./slug";
import { toShown } from "./units";
import { SITE } from "./seo";

const r2 = (v: number | null) => (v == null ? null : Math.round(v * 100) / 100);
const FT_IN_M = 0.3048;

export function levelRecord(s: NationalStation, now = Date.now()) {
  const u = s.unit;
  const shown = (v: number | null) => (v == null ? null : r2(u ? toShown(v, u) : v));
  const lvl = s.latest?.water_level ?? null;
  const st = statusFor(lvl, s.thresholds, s.latest?.ts, now);
  const rate = s.rate3hM;
  const trend = rate == null ? null : Math.abs(rate) < 0.006 ? "steady" : rate < 0 ? "falling" : rate < 0.05 ? "rising slowly" : "rising";
  return {
    id: `${basinSlug(s.basin)}/${stationSlug(s.station)}`,
    station: stationDisplayName(s.station),
    river: s.basin.trim(),
    latitude: s.latitude,
    longitude: s.longitude,
    level: shown(lvl),
    unit: u ? "ft" : null,
    published: { level: lvl, unit: u ?? "unknown" },
    marks: { alert: shown(s.thresholds.alert), minor: shown(s.thresholds.minor), major: shown(s.thresholds.major) },
    status: st.tier,
    statusLabel: st.label,
    trend,
    changePerHour3h: rate == null ? null : r2(rate / FT_IN_M),
    observedAt: s.latest ? new Date(s.latest.ts).toISOString() : null,
    ageMinutes: s.ageMin,
    url: SITE + s.href,
  };
}

export type LevelRecord = ReturnType<typeof levelRecord>;

export const API_META = {
  source: "Department of Irrigation, Sri Lanka (river gauges); compiled by Sri Lanka Water Levels",
  license: `${SITE}/about#data-sources`,
  notes: [
    "level and marks are in feet (metre gauges are converted); published.level is the figure as the agency released it, in published.unit.",
    "status is one of normal, watch, alert, minor, major, none (no flood levels published) or stale (no reading in 3 hours).",
    "null means unknown, never zero.",
    "Not an official warning service. In an emergency call 117 (Disaster Management Centre).",
  ],
  docs: `${SITE}/data`,
};

export const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300",
};
