// Unit detection.
//
// The ArcGIS dataset publishes alertpull / minorpull / majorpull per gauge but no unit. The
// authoritative units are in the DMC report "River Water Level and Flood Warning" ("Islandwide
// Water Level & Rainfall Situation in Major Rivers", dated 22-Oct-2026 9:30 PM; listing
// https://www.dmc.gov.lk/index.php?option=com_dmcreports&view=reports&report_type_id=6), which
// has a Unit column for 39 gauges. Checked 2026-10-22: its alert/minor/major levels equal the
// ArcGIS thresholds for every one of those gauges. Only Nagalagam Street is in feet; every other
// gauge is in metres. (The old heuristic, "alert >= 4 means feet", mislabelled 36 of them.)
//
// Gauges not in that report (Ampara, Calidonia, Thambuththegama: no published thresholds) fall back
// to the heuristic, which now only ever says "m" for a small alert mark and otherwise stays silent.

export type Unit = "ft" | "m" | null;

type Thresholds = { alert: number | null; minor: number | null; major: number | null };

const DMC_GAUGES: Record<string, { unit: "ft" | "m"; alert: number; minor: number; major: number }> = {
  "Nagalagam Street": { unit: "ft", alert: 4.0, minor: 5.0, major: 7.0 },
  "Hanwella": { unit: "m", alert: 6.5, minor: 7.5, major: 9.5 },
  "Glencourse": { unit: "m", alert: 15.0, minor: 15.5, major: 19.0 },
  "Kithulgala": { unit: "m", alert: 3.0, minor: 4.0, major: 6.0 },
  "Holombuwa": { unit: "m", alert: 3.0, minor: 4.0, major: 6.0 },
  "Deraniyagala": { unit: "m", alert: 4.8, minor: 5.8, major: 7.0 },
  "Norwood": { unit: "m", alert: 1.5, minor: 3.0, major: 4.5 },
  "Putupaula": { unit: "m", alert: 3.0, minor: 4.0, major: 5.0 },
  "Ellagawa": { unit: "m", alert: 10.0, minor: 10.7, major: 12.2 },
  "Rathnapura": { unit: "m", alert: 5.2, minor: 7.5, major: 9.5 },
  "Magura": { unit: "m", alert: 4.0, minor: 6.0, major: 7.5 },
  "Baddegama": { unit: "m", alert: 3.5, minor: 4.0, major: 5.0 },
  "Thawalama": { unit: "m", alert: 4.0, minor: 6.0, major: 7.5 },
  "Thalgahagoda": { unit: "m", alert: 1.4, minor: 1.7, major: 2.8 },
  "Panadugama": { unit: "m", alert: 5.0, minor: 6.0, major: 7.5 },
  "Pitabeddara": { unit: "m", alert: 4.0, minor: 5.0, major: 6.5 },
  "Urawa": { unit: "m", alert: 2.5, minor: 4.0, major: 6.0 },
  "Moraketiya": { unit: "m", alert: 3.0, minor: 5.0, major: 7.0 },
  "Thanamalwila": { unit: "m", alert: 4.0, minor: 5.0, major: 5.5 },
  "Wellawaya": { unit: "m", alert: 4.4, minor: 5.4, major: 5.9 },
  "Kuda Oya": { unit: "m", alert: 6.9, minor: 8.4, major: 8.8 },
  "Katharagama": { unit: "m", alert: 4.0, minor: 4.6, major: 6.5 },
  "Nakkala": { unit: "m", alert: 5.0, minor: 6.0, major: 7.5 },
  "Siyambalanduwa": { unit: "m", alert: 4.5, minor: 6.0, major: 7.0 },
  "Padiyathalawa": { unit: "m", alert: 4.0, minor: 4.5, major: 6.0 },
  "Manampitiya": { unit: "m", alert: 3.0, minor: 4.3, major: 6.0 },
  "Weraganthota": { unit: "m", alert: 5.0, minor: 6.0, major: 8.0 },
  "Peradeniya": { unit: "m", alert: 5.0, minor: 7.0, major: 9.0 },
  "Nawalapitiya": { unit: "m", alert: 3.5, minor: 5.0, major: 6.0 },
  "Thaldena": { unit: "m", alert: 3.0, minor: 4.0, major: 5.0 },
  "Horowpothana": { unit: "m", alert: 6.0, minor: 7.5, major: 10.5 },
  "Yaka Wewa": { unit: "m", alert: 4.0, minor: 5.0, major: 6.0 },
  "Thanthirimale": { unit: "m", alert: 5.0, minor: 6.8, major: 7.8 },
  "Galgamuwa": { unit: "m", alert: 4.84, minor: 5.94, major: 8.0 },
  "Moragaswewa": { unit: "m", alert: 4.75, minor: 6.0, major: 7.0 },
  "Badalgama": { unit: "m", alert: 5.0, minor: 6.2, major: 9.6 },
  "Giriulla": { unit: "m", alert: 5.5, minor: 6.5, major: 7.5 },
  "Dunamale": { unit: "m", alert: 3.3, minor: 4.4, major: 5.5 },
  "Kalawellawa (Millakanda)": { unit: "m", alert: 5.0, minor: 6.5, major: 8.0 },
};

/** Unit per gauge, keyed by our exact gauge names (from the DMC report above). */
export const UNIT_BY_STATION: Record<string, "ft" | "m"> = Object.fromEntries(
  Object.entries(DMC_GAUGES).map(([k, v]) => [k, v.unit]),
);

// Callers that only have the thresholds (no gauge name) match on the alert/minor/major triple,
// which is unique per gauge in the DMC table; a triple shared by gauges with different units is dropped.
const key = (a: number, b: number, c: number) => `${a}|${b}|${c}`;
const UNIT_BY_THRESHOLDS: Map<string, "ft" | "m" | null> = (() => {
  const m = new Map<string, "ft" | "m" | null>();
  for (const v of Object.values(DMC_GAUGES)) {
    const k = key(v.alert, v.minor, v.major);
    m.set(k, m.has(k) && m.get(k) !== v.unit ? null : v.unit);
  }
  return m;
})();

export function detectUnit(thresholds: Thresholds, station?: string | null): Unit {
  if (station && Object.hasOwn(UNIT_BY_STATION, station)) return UNIT_BY_STATION[station];
  const { alert, minor, major } = thresholds;
  if (alert == null || !Number.isFinite(alert)) return null;
  if (minor != null && major != null) {
    const known = UNIT_BY_THRESHOLDS.get(key(alert, minor, major));
    if (known) return known;
  }
  // Fallback for gauges absent from the DMC report: only a small alert mark is confidently metres.
  if (alert <= 1.5) return "m";
  return null;
}

// ---- Display: the site always shows feet ----------------------------------------------------------
// Gauges publish in their own unit (above) and every stored/computed number stays in it. Only what is
// drawn is converted: metre gauges to feet. A gauge with an unknown unit (null) is never converted.
// 1 ft = 0.3048 m exactly.
export const FT_IN_M = 0.3048;

/** The unit a gauge is shown in: feet for ft and m gauges, none for an unknown unit. */
export const shownUnit = (u: Unit): Unit => (u == null ? null : "ft");

/** A value in the gauge's published unit, expressed in the shown unit (m -> ft). */
export const toShown = (v: number, u: Unit): number => (u === "m" ? v / FT_IN_M : v);

/** The inverse, for what a visitor types: shown unit back to the gauge's own unit (ft -> m). */
export const fromShown = (v: number, u: Unit): number => (u === "m" ? v * FT_IN_M : v);

/** Feet to 1 decimal. Unknown-unit gauges keep `digits` decimals and no unit. */
export function shownNumber(v: number, u: Unit, digits = 2): string {
  return (u == null ? v : toShown(v, u)).toFixed(u == null ? digits : 1);
}

/** "24.6 ft"; a bare number for an unknown unit. */
export function formatLevel(v: number | null | undefined, unit: Unit, digits = 2): string {
  if (v == null) return "—";
  const s = shownNumber(v, unit, digits);
  return unit ? `${s} ft` : s;
}

/** A difference or rate, signed when asked: "+0.3 ft", "-0.05 ft" (2 decimals when a foot tenth would round it away). */
export function formatDelta(v: number, unit: Unit, o: { sign?: boolean; digits?: number } = {}): string {
  const x = toShown(v, unit);
  const d = unit == null ? (o.digits ?? 2) : x !== 0 && Math.abs(x) < 0.1 ? 2 : 1;
  let s = x.toFixed(d);
  if (Number(s) === 0) s = s.replace(/^-/, "");
  if (o.sign && x > 0 && Number(s) !== 0) s = `+${s}`;
  return unit ? `${s} ft` : s;
}

/** A rate given in metres per hour, as feet per hour without the unit: "0.3", "0.05". */
export function feetPerHour(rateM: number): string {
  const ft = Math.abs(rateM) / FT_IN_M;
  return ft.toFixed(ft >= 0.1 ? 1 : 2);
}

/** At most 1 decimal in feet (2 unitless), none trailing: "21.3", "7.5", "15". Axis ticks and inputs. */
export function plainShown(v: number, unit: Unit): string {
  return String(Number(v.toFixed(unit == null ? 2 : 1)));
}

/** The official figure for a metre gauge ("7.50 m"), to sit beside the feet value; null when nothing was converted. */
export function publishedAs(v: number | null | undefined, unit: Unit, digits = 2): string | null {
  return v == null || unit !== "m" ? null : `${v.toFixed(digits)} m`;
}
