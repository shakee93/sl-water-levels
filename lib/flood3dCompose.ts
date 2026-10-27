// Pure assembly of the live answer for the 3D flood test map (no Next, no network: tested in scripts/flood3d.test.mts).
// The core (level, step, trend, gauges) comes from ONE national snapshot; the forecast horizons and the HMIS 10-minute sensor are optional
// additions, so one slow source can never blank the others. A snapshot without Nagalagam Street is never turned into an answer (null).
export type Horizon = { h: number; level: number; low: number | null; high: number | null };
export type GaugeLive = {
  station: string;
  levelFt: number | null;
  hourlyAt: string | null;
  marks: { alert: number | null; minor: number | null; major: number | null };
  status: string;
  trend: string | null;
  changePerHourFt: number | null;
  /** 10-minute HMIS sensor (offset-corrected onto the hourly gauge's scale), only when newer than the hourly reading. */
  fastFt: number | null;
  fastAt: string | null;
  horizons: Horizon[];
  method: string | null;
};
/** A river gauge for the map markers: official step, level and trend straight from levelRecord (the same words as the gauge pages). */
export type MapGauge = { name: string; lat: number; lon: number; levelFt: number | null; status: string; statusLabel: string; trend: string | null; observedAt: string | null; url: string; fastFt: number | null; fastAt: string | null };
export type Flood3dLive = { generatedAt: string; nagalagam: GaugeLive | null; hanwella: GaugeLive | null; hanwellaToNag: [number, number][]; hanwellaLagH: number; gauges: MapGauge[]; /** true when this is the last good answer because the sources were slow */ stale?: boolean; /** true when nothing could be read in time: the client tries again soon */ partial?: boolean };

type StationLike = { station: string; latitude: number; longitude: number; basin: string };
type RecordLike = { station: string; level: number | null; observedAt: string | null; marks: { alert: number | null; minor: number | null; major: number | null }; status: string; statusLabel: string; trend: string | null; changePerHour3h: number | null; url: string };
type Opt = { now: number; nag?: { horizons: Horizon[]; method: string } | null; han?: { horizons: Horizon[]; method: string } | null; fast?: { ft: number; at: string } | null };

export function composeLive<S extends StationLike>(
  national: S[], opt: Opt, levelOf: (s: S) => RecordLike, table: [number, number][], lagH: number, box: { south: number; north: number; west: number; east: number }, basin: string,
): Flood3dLive | null {
  const core = (s: S): GaugeLive => {
    const r = levelOf(s);
    return { station: s.station, levelFt: r.level, hourlyAt: r.observedAt, marks: r.marks, status: r.status, trend: r.trend, changePerHourFt: r.changePerHour3h, fastFt: null, fastAt: null, horizons: [], method: null };
  };
  const nagS = national.find((x) => x.station === "Nagalagam Street");
  if (!nagS) return null;
  const hanS = national.find((x) => x.station === "Hanwella");
  const nagalagam: GaugeLive = { ...core(nagS), horizons: opt.nag?.horizons ?? [], method: opt.nag?.method ?? null };
  const hanwella: GaugeLive | null = hanS ? { ...core(hanS), horizons: opt.han?.horizons ?? [], method: opt.han?.method ?? null, fastFt: opt.fast?.ft ?? null, fastAt: opt.fast?.at ?? null } : null;
  const gauges: MapGauge[] = national
    .filter((x) => x.latitude >= box.south && x.latitude <= box.north && x.longitude >= box.west && x.longitude <= box.east && x.basin.trim() === basin)
    .map((x) => {
      const r = levelOf(x);
      const fast = x.station === "Hanwella" ? hanwella : null;
      return { name: r.station, lat: x.latitude, lon: x.longitude, levelFt: r.level, status: r.status, statusLabel: r.statusLabel, trend: r.trend, observedAt: r.observedAt, url: r.url, fastFt: fast?.fastFt ?? null, fastAt: fast?.fastAt ?? null };
    });
  return { generatedAt: new Date(opt.now).toISOString(), nagalagam, hanwella, hanwellaToNag: table, hanwellaLagH: lagH, gauges };
}
