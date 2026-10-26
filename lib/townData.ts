// Server-side loader for a town's flood estimate: gathers the live inputs for lib/townRisk.ts.
// Everything fails soft; a missing source is passed as null and the estimate says what it lacks.
import { riverRising } from "./verdictLift";
import { fetchBasinSnapshot, getNational, type NationalStation } from "./arcgis";
import { stationDisplayName } from "./displayName";
import { loadForecast, measuredAt, type Forecast } from "./forecast";
import { getGsmapZone } from "./gsmap";
import { getTownRain, type TownRain } from "./townWeather";
import { releaseAffecting } from "./releases";
import { getOfficialWarnings } from "./warnings";
import { soft } from "./soft";

/** Longest the town PAGE waits for rain, bulletins or the release lookup before going without them (its first byte depends on it). */
export const PAGE_BUDGET_MS = 1500;
import { normaliseBasin } from "./basinOrder";
import { distanceKm } from "./nearby";
import { contactsForDistrict } from "./help";
import { stationPath } from "./slug";
import type { Place } from "./places";
import { assessTown, usableGauge, type ForecastIn, type GaugeIn, type Tone, type TownRiskInput, type WarningIn } from "./townRisk";
import { riverTrigger, type RiverReading } from "./streetRainLog";
import type { Thresholds } from "./readings";
import type { Unit } from "./units";

export type TownData = {
  place: Place;
  input: TownRiskInput;
  /** The gauge the estimate rests on (primary, else secondary); null when none exist at all. */
  gauge: {
    station: string;
    name: string;
    basin: string;
    km: number;
    href: string;
    unit: Unit;
    thresholds: Thresholds;
    level: number | null;
    ts: number | null;
    next24: number | null;
  } | null;
  rain: TownRain | null;
  /** Satellite rain hour by hour over the town's canal-flood zone (past 24 h), when the rule's zone applies and the file is fresh. */
  rainSat: { hours: { end: number; mm: number | null }[]; mm24h: number | null; mm24hClipped: number | null } | null;
  rainReason: string | null;
  office: { district: string; tel: string } | null;
};

const gaugeIn = (s: NationalStation | undefined, place: Place): GaugeIn | null =>
  s
    ? {
        station: s.station,
        name: stationDisplayName(s.station),
        basin: s.basin.trim(),
        tier: s.tier,
        level: s.latest?.water_level ?? null,
        unit: s.unit,
        ts: s.latest?.ts ?? null,
        rate3hM: s.rate3hM,
        rising: riverRising(s.station, s.trend24h, s.metresPerUnit, s.rate3hM),
        km: distanceKm({ lat: place.lat, lon: place.lon }, { lat: s.latitude, lon: s.longitude }),
      }
    : null;

const SEV_RANK: WarningIn["severity"][] = ["none", "advisory", "alert", "minor flood", "major flood", "evacuation"];

function forecastIn(f: Forecast, mpu: number): ForecastIn {
  const at = (h: number) => f.horizons.find((x) => x.h === h)?.level ?? null;
  const highs = f.horizons.map((x) => x.high ?? x.level);
  return {
    status: f.status,
    h1Level: at(1),
    h24Level: at(24),
    maxLevel: highs.length ? Math.max(...highs) : null,
    currentLevel: f.currentLevel,
    metresPerUnit: mpu,
    crossings: f.crossings.map((c) => ({ threshold: c.threshold, wording: c.wording, etaTs: c.etaTs, level: c.level, probability: c.probability })),
    horizons: f.horizons.map((x) => ({ h: x.h, level: x.level })),
  };
}

const FT_PER_M = 1 / 0.3048;
/** Level and minor mark of a gauge in feet (unknown unit = unusable), for the river trigger. */
function riverReading(s: NationalStation | undefined, name: string, now: number): RiverReading {
  const f = s && s.unit ? (s.unit === "m" ? FT_PER_M : 1) : null;
  const lvl = s?.latest?.water_level;
  const minor = s?.thresholds.minor;
  return {
    station: name,
    levelFt: f != null && typeof lvl === "number" ? lvl * f : null,
    minorFt: f != null && typeof minor === "number" && minor > 0 ? minor * f : null,
    ageMin: s?.latest ? Math.max(0, (now - s.latest.ts) / 60_000) : null,
  };
}

function streetRiverIn(byName: Map<string, NationalStation>, now: number): TownRiskInput["streetRiver"] {
  const t = riverTrigger([riverReading(byName.get("Nagalagam Street"), "Nagalagam Street", now), riverReading(byName.get("Hanwella"), "Hanwella", now)]);
  return { triggered: t.triggered, gauge: t.station ?? "", level: t.levelFt != null ? `${t.levelFt.toFixed(1)} ft` : "" };
}

export async function loadTown(place: Place, now = Date.now(), opts: { budgetMs?: number } = {}): Promise<TownData> {
  // Only the page passes a budget. Push/glance callers wait for the real answer: a verdict made without
  // rain or bulletins must never drive a notification.
  const box = <T,>(p: Promise<T>, fallback: T): Promise<T> => (opts.budgetMs ? soft(p, opts.budgetMs, fallback) : p);
  const national = await getNational().catch(() => [] as NationalStation[]);
  const byName = new Map(national.map((s) => [s.station, s]));
  const primary = gaugeIn(byName.get(place.stations[0]), place);
  const secondary = gaugeIn(place.stations[1] ? byName.get(place.stations[1]) : undefined, place);
  const eff = usableGauge(primary) ? primary : usableGauge(secondary) ? secondary : null;
  const effStation = eff ? byName.get(eff.station)! : null;

  const [rainR, warnings, forecast, release, zone] = await Promise.all([
    box(getTownRain(place.lat, place.lon, now), { ok: false, reason: "rain feed too slow" } as Awaited<ReturnType<typeof getTownRain>>),
    // Time-boxed: a cold bulletin list/analysis must not hold the whole town page (it keeps running and fills the cache).
    box(getOfficialWarnings(), { warnings: [] } as Awaited<ReturnType<typeof getOfficialWarnings>>).catch(() => ({ warnings: [] })),
    eff && effStation
      ? fetchBasinSnapshot(eff.basin)
          .then((snap) => (snap.length ? loadForecast(eff.basin, snap, eff.station) : null))
          .catch(() => null)
      : Promise.resolve(null),
    eff ? box(releaseAffecting(eff.station).catch(() => null), null) : Promise.resolve(null),
    place.rainZone ? box(getGsmapZone(place.rainZone, now).catch(() => null), null) : Promise.resolve(null),
  ]);

  // Official warning: the current one that names this river basin or the town's district; strongest wins.
  // Also when no gauge is usable (stale or without flood levels): a warning is then the only evidence there is,
  // and the basin is the town's own river (its first listed gauge's).
  let warning: WarningIn | null = null;
  const warnBasin = (eff ?? primary ?? secondary)?.basin ?? null;
  {
    const key = warnBasin ? normaliseBasin(warnBasin) : null;
    for (const w of warnings.warnings) {
      if (w.current === false) continue;
      const byBasin = key != null && w.basins.some((b) => normaliseBasin(b) === key);
      const byDistrict = (w.districts ?? []).some((d) => d.trim().toLowerCase() === place.district.toLowerCase());
      if (!byBasin && !byDistrict) continue;
      // A river warning covers named areas, not the whole river (26 Oct 2026: the Mahaweli warning named only Pasbage Korale in Kandy,
      // yet Mahiyangana and Polonnaruwa, with their gauges far below alert, read "Get ready"). It sets its full floor only when it names
      // the town's district, or names no district and the town's own gauge is already at watch or above. Anywhere else on the river it
      // is a heads-up: "advisory" (Keep an eye on it), still shown as the reason.
      const named = (w.districts ?? []).length > 0;
      const gaugeHigh = !!eff && ["watch", "alert", "minor", "major"].includes(eff.tier);
      const applies = byDistrict || (byBasin && !named && gaugeHigh);
      const sev: typeof w.severity = applies || w.severity === "none" || w.severity === "advisory" ? w.severity : "advisory";
      if (!warning || SEV_RANK.indexOf(sev) > SEV_RANK.indexOf(warning.severity)) {
        warning = { severity: sev, source: w.source, area: byBasin ? warnBasin! : place.district };
      }
    }
  }

  // heavy rain the gauges measured at or above the town's gauge: a heads-up only (lib/townRisk.ts), shown with the rain lines
  const mAt = eff ? measuredAt(national, eff.basin, eff.station, now) : null;
  const measuredIn = mAt ? { gaugeName: mAt.gaugeName, hours: mAt.hours, mm: mAt.mm, local: mAt.local } : null;

  const input: TownRiskInput = {
    drainage: place.drainage,
    primary,
    secondary,
    forecast: forecast && effStation ? forecastIn(forecast, effStation.metresPerUnit) : null,
    rain: rainR.ok
      ? {
          past6hMm: rainR.data.past6hMm, past24hMm: rainR.data.past24hMm,
          next6hMm: rainR.data.next6hMm, next24hMm: rainR.data.next24hMm,
          next24hP90Mm: rainR.data.next24hP90Mm, next6hP90Mm: rainR.data.next6hP90Mm,
        }
      : null,
    release: release?.active && release.reservoir
      ? { confirmed: release.confirmed, reservoir: release.reservoir, cusecs: release.cusecs, etaHours: release.etaHours }
      : null,
    warning,
    measured: measuredIn,
    // undefined = the street-rain rule does not apply to this town; null = it does but the satellite file is missing or stale
    // (rule rain = 24 h sum with each hour clipped at 15 mm; the unclipped total rides along for display)
    streetRain: place.rainZone
      ? zone && zone.mm24hClipped != null ? { mm24h: zone.mm24hClipped, mm24hRaw: zone.mm24h, mm6h: zone.mm6h, mm1h: zone.mm1h, endsAt: zone.endsAt } : null
      : undefined,
    // river half: the Kelani at its minor flood level (Nagalagam Street 5 ft, Hanwella at its own published minor mark)
    streetRiver: place.rainZone ? streetRiverIn(byName, now) : undefined,
    now,
  };

  const dc = contactsForDistrict(place.district);
  const g = eff ?? primary ?? secondary;
  const gs = g ? byName.get(g.station) : undefined;
  return {
    place,
    input,
    gauge:
      g && gs
        ? {
            station: g.station, name: g.name, basin: g.basin, km: g.km, href: stationPath(gs.basin, gs.station),
            unit: g.unit, thresholds: gs.thresholds, level: g.level, ts: g.ts,
            next24: input.forecast?.h24Level ?? null,
          }
        : null,
    rain: rainR.ok ? rainR.data : null,
    rainSat: zone?.hourly && zone.hourly.length >= 20 ? { hours: zone.hourly, mm24h: zone.mm24h, mm24hClipped: zone.mm24hClipped ?? null } : null,
    rainReason: rainR.ok ? null : rainR.reason,
    office: dc ? { district: dc.district, tel: dc.tel } : null,
  };
}

export type TownState = {
  tone: Tone;
  station: string | null;
  /** River the gauge sits on (trimmed), or null when no gauge is known. */
  basin: string | null;
};

/**
 * Cheap state for every town (the /flood index): gauge-only, same gauge choice as the page, plus the
 * Kelani-at-minor-level rule for the canal-flood towns (the two Kelani gauges already in the national snapshot, so no
 * per-town fetch). No satellite rain (heavy rain is a personal opt-in note, never a town state), no forecast, local rain
 * or warnings: those make the full estimate on the town page.
 */
export async function loadTownStates(places: Place[]): Promise<Map<string, TownState>> {
  const now = Date.now();
  const national = await getNational();
  const byName = new Map(national.map((s) => [s.station, s]));
  const out = new Map<string, TownState>();
  for (const p of places) {
    const primary = gaugeIn(byName.get(p.stations[0]), p);
    const secondary = gaugeIn(p.stations[1] ? byName.get(p.stations[1]) : undefined, p);
    const r = assessTown({
      drainage: p.drainage, primary, secondary, forecast: null, rain: null, release: null, warning: null, now,
      streetRiver: p.rainZone ? streetRiverIn(byName, now) : undefined,
    });
    const g = r.gauge ?? primary;
    out.set(p.slug, { tone: r.tone, station: g?.station ?? null, basin: g?.basin ?? null });
  }
  return out;
}
