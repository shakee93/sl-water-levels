// Fits harmonic tide constituents (M2 S2 N2 K1 O1) to Nagalagam Street's own dry-period hourly readings, so the
// site can say when the Colombo tide is high or low without any private data (lib/tide.ts holds the output).
//
// Why Nagalagam and not a tide table: the gauge sits in the tidal reach of the Kelani, so its twice-daily swing
// (about 1 ft) is the sea tide, already delayed and damped by the channel, which is exactly the tide that matters
// for the canals draining into it. Only hours when the river is low and steady are used (the tide is the only
// thing moving then); the slow river trend is removed with a centred 49 h mean.
//
// Source: ~11 months of hourly readings (this repo's `data` branch + nuuuwan/lk_irrigation), the same series
// the gauge model is fitted on. NO CUrW data is used.
// Usage: node scripts/fit-tide.mjs   (prints constants; paste into lib/tide.ts)
import { loadGaugeSeries } from "./gauge-series.mjs";

const H = 3_600_000;
// Periods in hours (same as lib/model/gaugeModel.mjs TIDE_PERIODS_H) + names.
const C = [["M2", 12.4206012], ["S2", 12], ["N2", 12.6583475], ["K1", 23.9344697], ["O1", 25.8193417]];
const G = "Nagalagam Street";
const { L, t0, N, unit } = loadGaugeSeries();
const a = L[G];
if (!a) throw new Error("no Nagalagam series");
const W = 24; // half window: 49 h centred mean
const rows = [];
for (let i = W; i < N - W; i++) {
  let s = 0, n = 0, mx = -Infinity, mn = Infinity;
  for (let k = -W; k <= W; k++) { const v = a[i + k]; if (Number.isFinite(v)) { s += v; n++; mx = Math.max(mx, v); mn = Math.min(mn, v); } }
  if (n < 45 || !Number.isFinite(a[i])) continue;
  const mean = s / n;
  // dry and steady: the whole 49 h window sits low (river well under any alert) and its mean drifts little
  if (mean > 3.2 || mx > 4.2) continue;
  rows.push({ t: t0 + i * H, y: a[i] - mean });
}
console.log(`unit ${unit(G)}, hours used ${rows.length} of ${N}`);
// least squares with normal equations
const P = C.length * 2;
const col = (t) => C.flatMap(([, p]) => { const w = (2 * Math.PI * (t / H)) / p; return [Math.cos(w), Math.sin(w)]; });
function lsq(rs) {
  const M = Array.from({ length: P }, () => new Float64Array(P + 1));
  for (const r of rs) { const x = col(r.t); for (let i = 0; i < P; i++) { M[i][P] += x[i] * r.y; for (let j = 0; j < P; j++) M[i][j] += x[i] * x[j]; } }
  for (let i = 0; i < P; i++) { let p = i; for (let k = i + 1; k < P; k++) if (Math.abs(M[k][i]) > Math.abs(M[p][i])) p = k; [M[i], M[p]] = [M[p], M[i]]; for (let k = i + 1; k < P; k++) { const f = M[k][i] / M[i][i]; for (let j = i; j <= P; j++) M[k][j] -= f * M[i][j]; } }
  const b = new Float64Array(P);
  for (let i = P - 1; i >= 0; i--) { let s = M[i][P]; for (let j = i + 1; j < P; j++) s -= M[i][j] * b[j]; b[i] = s / M[i][i]; }
  return b;
}
const pred = (b, t) => { const x = col(t); let p = 0; for (let i = 0; i < P; i++) p += b[i] * x[i]; return p; };
const score = (b, rs) => { let ss = 0, sr = 0; for (const r of rs) { ss += r.y * r.y; sr += (r.y - pred(b, r.t)) ** 2; } return { r2: 1 - sr / ss, rms: Math.sqrt(sr / rs.length) }; };
// out-of-sample check: fit on everything but the last 60 days, score on those 60 days
const cut = t0 + (N - 60 * 24) * H;
const bTr = lsq(rows.filter((r) => r.t < cut)), te = rows.filter((r) => r.t >= cut);
const so = score(bTr, te);
console.log(`holdout (last 60 d, ${te.length} h): variance explained ${(100 * so.r2).toFixed(0)}%, rms ${so.rms.toFixed(3)} ${unit(G)}`);
// timing: each observed high-tide (local max of the de-trended series, 3 h either side) vs the nearest predicted high
{
  const ev = [];
  for (let k = 3; k < te.length - 3; k++) { if (te[k + 3].t - te[k - 3].t !== 6 * H) continue; const w = te.slice(k - 3, k + 4).map((r) => r.y); if (te[k].y === Math.max(...w) && te[k].y > 0.15) ev.push(te[k].t); }
  const errs = ev.map((t) => { let best = 99; for (let d = -4 * 60; d <= 4 * 60; d += 5) { const tt = t + d * 60000; if (pred(bTr, tt) >= pred(bTr, tt - 600000) && pred(bTr, tt) >= pred(bTr, tt + 600000)) best = Math.abs(d) < Math.abs(best) ? d : best; } return best; }).filter((x) => x !== 99).sort((x, y) => x - y);
  const abs = errs.map(Math.abs).sort((x, y) => x - y);
  console.log(`high-tide timing, ${errs.length} observed highs: median |error| ${abs[abs.length >> 1]} min, 80% within ${abs[Math.floor(abs.length * 0.8)]} min`);
}
const beta = lsq(rows);
const all = score(beta, rows);
console.log(`all data: variance explained ${(100 * all.r2).toFixed(0)}%, rms ${all.rms.toFixed(3)} ${unit(G)}`);
// y = A cos(w t - phi): beta = [A cos phi, A sin phi]; phi in degrees, referenced to Unix epoch hours
const out = C.map(([name, per], i) => {
  const c = beta[2 * i], s = beta[2 * i + 1];
  return { name, periodH: per, ampFt: +Math.hypot(c, s).toFixed(4), phaseDeg: +(((Math.atan2(s, c) * 180) / Math.PI + 360) % 360).toFixed(1) };
});
console.log(JSON.stringify(out, null, 1));
