// Plain-language state of one Colombo canal gauge from its own recent readings. Pure (no I/O), shared by
// lib/curw.ts, /api/canals and scripts/curw-status.test.mts.
//
// Source of the numbers: CUrW (Center for Urban Water) / SLLDC, pub.curwsl.org, archived every 15 minutes in our
// D1 table curw_levels. Shown with credit (see CURW_CREDIT). Levels are metres above mean sea level (m MSL).
//
// "Usual" means THIS gauge's own recent range (the archive keeps growing; with under 36 hours of history the
// state is "learning" and nothing is claimed). We have no official canal alert levels, so we never say "flood".
// Tidal gauges move 0.4-0.8 m with the sea twice a day, so their instantaneous level says little: they are judged
// by their LOW-TIDE FLOOR (lowest reading in the last 24 h), which follows runoff and not the tide.

export const CURW_CREDIT = "Canal levels: CUrW / SLLDC (pub.curwsl.org)";
// A plain link the visitor may click; the site itself never loads anything from their host (no hotlinked charts, no browser fetches).
export const CURW_URL = "http://pub.curwsl.org/";
export type CanalState = "offline" | "learning" | "normal" | "rising" | "higher" | "lower";
export type Pt = { ms: number; m: number };

const H = 3_600_000;
/** Gauges that ride the sea tide (Mutwal Inlet itself is the sea). */
export const TIDAL = new Set(["Mutwal Inlet", "Mattakkuliya N", "Kalupalama US", "Kalupalama DS", "Sedawatta Bridge DS", "Ingurukade N", "Wellawatta N"]);
/** A reading older than this means the gauge is not reporting. */
export const STALE_MS = 90 * 60_000;

const q = (a: number[], p: number) => {
  const s = [...a].sort((x, y) => x - y);
  return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : NaN;
};

export type Assessment = { state: CanalState; level: number | null; observedMs: number | null; floor24: number | null; change3h: number | null };

/** pts: ascending readings (any spacing), covering up to the last 7 days. */
export function assessCanal(name: string, pts: Pt[], now: number, offline = false): Assessment {
  const last = pts[pts.length - 1];
  if (!last || offline || now - last.ms > STALE_MS) return { state: "offline", level: last?.m ?? null, observedMs: last?.ms ?? null, floor24: null, change3h: null };
  const span = last.ms - pts[0].ms;
  const day = pts.filter((p) => p.ms > last.ms - 24 * H);
  const floor24 = day.length ? Math.min(...day.map((p) => p.m)) : null;
  const ref = pts.filter((p) => Math.abs(p.ms - (last.ms - 3 * H)) <= 40 * 60_000);
  const change3h = ref.length ? last.m - ref[0].m : null;
  const base = { level: last.m, observedMs: last.ms, floor24, change3h };
  if (name === "Mutwal Inlet") return { state: "normal", ...base };
  if (span < 36 * H) return { state: "learning", ...base };
  if (TIDAL.has(name)) {
    // low-tide floor = lowest reading over one full tide cycle (13 h); compared with the floors of the earlier 13 h blocks
    const W = 13 * H;
    const floorNow = Math.min(...pts.filter((p) => p.ms > last.ms - W).map((p) => p.m));
    const floors: number[] = [];
    for (let end = last.ms - W; end - W >= pts[0].ms - 1; end -= W) {
      const blk = pts.filter((p) => p.ms > end - W && p.ms <= end).map((p) => p.m);
      if (blk.length >= 8) floors.push(Math.min(...blk));
    }
    if (floors.length < 3) return { state: "learning", ...base };
    const usual = q(floors, 0.5);
    const state: CanalState = floorNow > usual + 0.15 ? "higher" : floorNow < usual - 0.15 ? "lower" : "normal";
    return { state, ...base };
  }
  const all = pts.map((p) => p.m);
  const spread = Math.max(...all) - Math.min(...all);
  if (spread < 0.15) return { state: "normal", ...base };
  const med = q(all, 0.5), gap = Math.max(0.2, spread * 0.3);
  if (change3h != null && change3h >= Math.max(0.08, spread * 0.1)) return { state: "rising", ...base };
  if (last.m - med >= gap) return { state: "higher", ...base };
  if (med - last.m >= gap) return { state: "lower", ...base };
  return { state: "normal", ...base };
}

/** Sea level direction from a tidal gauge's last readings. */
export function seaTrend(pts: Pt[]): "rising" | "falling" | "steady" | null {
  const last = pts[pts.length - 1];
  if (!last) return null;
  const ref = pts.filter((p) => Math.abs(p.ms - (last.ms - 60 * 60_000)) <= 25 * 60_000);
  if (!ref.length) return null;
  const d = last.m - ref[0].m;
  return d > 0.04 ? "rising" : d < -0.04 ? "falling" : "steady";
}

/** Canal levels are metres above mean sea level at the source; the site shows feet. */
export const toFt = (m: number) => m * 3.28084;
