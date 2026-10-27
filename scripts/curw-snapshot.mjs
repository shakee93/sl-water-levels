// Private archive of Colombo canal water levels, for calibration only (NEVER shown on the public site:
// the data belongs to CUrW / SLLDC and we are waiting for their permission to publish it).
//
// Source: http://pub.curwsl.org/dyn/<page>.png. CUrW publishes no JSON/CSV; each page is a matplotlib PNG
// (24 h, 15-minute readings, m above mean sea level, Sri Lanka time) with one subplot per gauge. Each
// subplot title reads "<station> / Water Level = X mMSL / Observed at: YYYY-MM-DD HH:MM:SS", or
// "<station> / The station has not responded in 24 hours" when the gauge is offline.
//
// WHERE IT IS STORED: the Cloudflare D1 database "sl-water-levels" (private; tables curw_levels, curw_status,
// curw_raw in d1/0002_curw.sql). NOT the `data` branch: this repository is public, so anything committed there
// would be world-readable and re-published before CUrW has agreed.
//
// What this does, per run (every 15 min; 7 requests, one at a time, identifying User-Agent):
//   1. Downloads the 7 chart pages.
//   2. Finds every subplot (black frame), reads title + y-axis tick labels with the `tesseract` CLI, and
//      digitises the blue line from pixels (x from the 2-hourly vertical gridlines, y from the OCR'd
//      horizontal gridline values). The newest point takes the EXACT value from the title; the other
//      points on the 15-minute grid come from the curve (about +-0.005 m typical), which recovers the whole
//      24 h so a missed run loses nothing. Gaps in a gauge's data are drawn as straight lines by CUrW and
//      so show up here as interpolated "curve" rows.
//   3. Writes SQL: INSERT rows into curw_levels keyed by (station, observed_ms); an exact "title" row replaces
//      a "curve" row, never the other way round. curw_status gets one row per station (ok / offline).
//   4. Keeps the raw PNGs (base64 chunks in curw_raw, 14 days) once a day around 06:00 Colombo, when a level
//      passes a threshold or rises 1 m above its own 24 h minimum, or when a station could not be parsed,
//      so a wrong parser can be re-run.
//
// Row: { station, group, observedAt (ISO with +05:30), level_m_msl, src: "title"|"curve", status: "ok" }
//
// Usage: node scripts/curw-snapshot.mjs <out.sql>          fetch live charts, write SQL (run it with wrangler)
//        node scripts/curw-snapshot.mjs <out.sql> --jsonl <dir>   also append the rows to <dir>/curw/YYYY/YYYY-MM-DD.jsonl
//        add --status <file> to write {total, ok, offline, unreadable} (counts only: no names, no levels) for the health check
//        node scripts/curw-snapshot.mjs --from <dir with the 7 PNGs> [--json]   offline test, writes nothing
//
import { mkdir, readFile, writeFile, appendFile, mkdtemp, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { inflateSync, deflateSync, crc32 } from "node:zlib";
import path from "node:path";
import os from "node:os";

const execFileP = promisify(execFile);
const BASE = "http://pub.curwsl.org/dyn/";
const UA = "sl-water-levels-archive (+https://waterlevels.lk; shakee.zats@gmail.com)";
// Pages in priority order: a gauge shown on several pages (Kalupalama DS, Sedawatta Bridge DS, Ambathale
// also sit on the Kelani page) is filed under the first page it appears on.
const PAGES = ["Kolonnawa", "North Canal", "Parliament Lake", "Madiwela East Diversion", "Wellawatta Canal", "South and Torrington", "Kelani River"];
// Chart text as drawn -> canonical spelling. Unknown names are kept as OCR read them.
const KNOWN = [
  "Gothatuwa DS", "Wellampitiya N", "Kalupalama US", "Kalupalama DS", "Salalihini Mw",
  "Janakala Kendraya N", "Serpentine Canal", "Yakbedda N", "Orugodawatta", "Ingurukade N", "Sedawatta Bridge DS", "Mutwal Inlet",
  "Ranwala N", "Kaduwela N", "Ambathale", "Mattakkuliya N",
];
// Save the raw PNGs when a level reaches this (m MSL), or rises RAW_RISE_M above its own 24 h minimum.
// Canal gauges normally sit at 0.2-1.3 m; some pond/upland gauges live much higher (Ranwala N 8.5, Thalangama
// Lake 6.6, Awerihena Tank 5.5), so those have their own numbers.
const RAW_LEVEL_M = 2.5;
const RAW_LEVEL_OVERRIDE = { "Salalihini Mw": 3.0, "Ambathale": 3.2, "Chandrika Kumarathunga Mw": 3.2, "Kimbulawela": 3.0, "Thalangama Lake": 7.6, "Awerihena Tank": 6.6, "Ranwala N": 11 };
const RAW_RISE_M = 1.0;
const COLOMBO = "+05:30";
const COLOMBO_MS = 5.5 * 3600 * 1000;

// ---------------------------------------------------------------- PNG (8-bit RGBA/RGB, non-interlaced)
function decodePng(buf) {
  let p = 8, w = 0, h = 0, ct = 6;
  const idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p), type = buf.toString("ascii", p + 4, p + 8);
    if (type === "IHDR") { w = buf.readUInt32BE(p + 8); h = buf.readUInt32BE(p + 12); ct = buf[p + 17]; if (buf[p + 16] !== 8 || buf[p + 20] !== 0) throw new Error("unsupported PNG"); }
    else if (type === "IDAT") idat.push(buf.subarray(p + 8, p + 8 + len));
    p += 12 + len;
  }
  const bpp = ct === 6 ? 4 : ct === 2 ? 3 : 0;
  if (!bpp) throw new Error(`unsupported PNG colour type ${ct}`);
  const raw = inflateSync(Buffer.concat(idat));
  const stride = w * bpp, out = new Uint8Array(h * stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], src = y * (stride + 1) + 1, dst = y * stride;
    for (let i = 0; i < stride; i++) {
      const x = raw[src + i];
      const a = i >= bpp ? out[dst + i - bpp] : 0, b = y ? out[dst - stride + i] : 0, c = i >= bpp && y ? out[dst - stride + i - bpp] : 0;
      let v;
      if (f === 0) v = x; else if (f === 1) v = x + a; else if (f === 2) v = x + b; else if (f === 3) v = x + ((a + b) >> 1);
      else { const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c); v = x + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c); }
      out[dst + i] = v & 255;
    }
  }
  return { w, h, bpp, data: out };
}
function encodeGray(w, h, g) {
  const rows = Buffer.alloc((w + 1) * h);
  for (let y = 0; y < h; y++) { rows[y * (w + 1)] = 0; for (let x = 0; x < w; x++) rows[y * (w + 1) + 1 + x] = g[y * w + x]; }
  const chunk = (t, d) => { const b = Buffer.alloc(12 + d.length); b.writeUInt32BE(d.length, 0); b.write(t, 4, "ascii"); d.copy(b, 8); b.writeUInt32BE(crc32(b.subarray(4, 8 + d.length)), 8 + d.length); return b; };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(rows)), chunk("IEND", Buffer.alloc(0))]);
}

// ---------------------------------------------------------------- OCR
let tmpDir;
async function ocr(img, box, args) {
  // Crop (x0,y0,x1,y1), grey, 4x nearest upscale, run tesseract.
  const [x0, y0, x1, y1] = box.map(Math.round), S = 4, cw = x1 - x0, ch = y1 - y0;
  const P = 24, W = cw * S + 2 * P, H = ch * S + 2 * P;
  const g = new Uint8Array(W * H).fill(255);
  const gv = (x, y) => { const i = ((y0 + Math.min(ch - 1, Math.max(0, y))) * img.w + x0 + Math.min(cw - 1, Math.max(0, x))) * img.bpp; return (img.data[i] + img.data[i + 1] + img.data[i + 2]) / 3; };
  for (let y = 0; y < ch * S; y++) for (let x = 0; x < cw * S; x++) {   // bilinear upscale
    const fx = (x + 0.5) / S - 0.5, fy = (y + 0.5) / S - 0.5, ix = Math.floor(fx), iy = Math.floor(fy), tx = fx - ix, ty = fy - iy;
    g[(y + P) * W + x + P] = gv(ix, iy) * (1 - tx) * (1 - ty) + gv(ix + 1, iy) * tx * (1 - ty) + gv(ix, iy + 1) * (1 - tx) * ty + gv(ix + 1, iy + 1) * tx * ty;
  }
  tmpDir ??= await mkdtemp(path.join(os.tmpdir(), "curw-"));
  const f = path.join(tmpDir, `o${Math.random().toString(36).slice(2)}.png`);
  await writeFile(f, encodeGray(W, H, g));
  const { stdout } = await execFileP("tesseract", [f, "stdout", "-l", "eng", ...args], { timeout: 30_000, env: { ...process.env, OMP_THREAD_LIMIT: "1" } });   // 1 thread: on a 2-core runner tesseract's own threads thrash
  return stdout;
}

// ---------------------------------------------------------------- layout
const px = (img, x, y) => (y * img.w + x) * img.bpp;
const dark = (img, x, y) => { const i = px(img, x, y); return img.data[i] < 100 && img.data[i + 1] < 100 && img.data[i + 2] < 100; };

function findAxes(img) {
  // Rows holding a long dark run = top/bottom spines. Group by x-extent.
  const lines = [];
  for (let y = 0; y < img.h; y++) {
    let x = 0;
    while (x < img.w) {
      if (!dark(img, x, y)) { x++; continue; }
      let e = x; while (e < img.w && dark(img, e, y)) e++;
      if (e - x >= 200) lines.push({ y, x0: x, x1: e });
      x = e;
    }
  }
  // Group lines by right edge (the left edge of a top spine is stretched by the y-tick mark at 3.0).
  const groups = [];
  for (const l of lines) { const g = groups.find((q) => Math.abs(q.x1 - l.x1) <= 3); if (g) g.ls.push(l); else groups.push({ x1: l.x1, ls: [l] }); }
  const axes = [];
  for (const { ls } of groups) {
    const ys = [...new Set(ls.map((l) => l.y))].sort((a, b) => a - b), cl = [];
    for (const y of ys) { const c = cl[cl.length - 1]; if (c && y - c[c.length - 1] <= 1) c.push(y); else cl.push([y]); }
    const x0 = Math.max(...ls.map((l) => l.x0)), x1 = Math.max(...ls.map((l) => l.x1));
    for (let i = 0; i + 1 < cl.length; i += 2) axes.push({ x0, x1: x1 - 1, top: cl[i][cl[i].length - 1], bottom: cl[i + 1][0] });
  }
  return axes.filter((a) => a.bottom - a.top > 100).sort((a, b) => a.top - b.top || a.x0 - b.x0);
}

// centres of gridlines inside an axes. vertical=true -> x positions of vertical lines.
function gridlines(img, a, vertical) {
  const x0 = a.x0 + 5, x1 = a.x1 - 4, y0 = a.top + 5, y1 = a.bottom - 4;
  const n = vertical ? x1 - x0 : y1 - y0, span = vertical ? y1 - y0 : x1 - x0;
  const score = new Float64Array(n), cover = new Float64Array(n);
  for (let k = 0; k < n; k++) {
    let s = 0, c = 0;
    for (let m = 0; m < span; m++) {
      const i = vertical ? px(img, x0 + k, y0 + m) : px(img, x0 + m, y0 + k);
      const r = img.data[i], g = img.data[i + 1], b = img.data[i + 2];
      if (Math.abs(r - g) < 6 && Math.abs(g - b) < 6 && r < 245 && r > 150) { s += 255 - r; c++; }
    }
    score[k] = s; cover[k] = c / span;
  }
  const out = [];
  for (let k = 0; k < n; k++) {
    if (cover[k] < 0.45) continue;
    let e = k, sw = 0, swk = 0;
    while (e < n && cover[e] >= 0.45) { sw += score[e]; swk += score[e] * (vertical ? x0 + e : y0 + e); e++; }
    out.push(swk / sw); k = e;
  }
  if (!vertical || out.length < 4) return out;
  // Drop stray lines (a mark at the left edge): keep lines with a neighbour one regular step away.
  const diffs = out.slice(1).map((v, i) => v - out[i]).sort((p, q) => p - q), d = diffs[diffs.length >> 1];
  return out.filter((v, i) => (i > 0 && Math.abs(v - out[i - 1] - d) < d * 0.15) || (i < out.length - 1 && Math.abs(out[i + 1] - v - d) < d * 0.15));
}

// Blue (C0 #1f77b4) alpha per pixel from b - r (valid for blends with white or grey).
function curveColumns(img, a) {
  const cols = [];
  for (let x = a.x0 + 2; x < a.x1 - 1; x++) {
    let s = 0, sy = 0, lo = 1e9, hi = -1;
    for (let y = a.top + 2; y < a.bottom - 1; y++) {
      const i = px(img, x, y), r = img.data[i], b = img.data[i + 2];
      if (b - r < 25 || img.data[i + 1] - r < 10) continue;
      const w = Math.min(1, (b - r) / 149);
      s += w; sy += w * y; if (y < lo) lo = y; if (y > hi) hi = y;
    }
    cols.push(s > 0.6 ? { x, y: sy / s, lo, hi } : null);
  }
  return cols;
}

// ---------------------------------------------------------------- one chart page
function snapName(raw) {
  const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const n = norm(raw);
  for (const k of KNOWN) if (norm(k) === n) return k;
  const lev = (a, b) => { const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]); for (let j = 1; j <= b.length; j++) d[0][j] = j; for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); return d[a.length][b.length]; };
  let best = null, bd = 99;
  for (const k of KNOWN) { const d = lev(n, norm(k)); if (d < bd) { bd = d; best = k; } }
  return bd <= 2 && best ? best : raw.trim().replace(/\s+/g, " ");
}

// Tesseract drops a small decimal point: '15' on a 0.5-step axis means 1.5.
const fixDecimal = (v) => (/^-?\d{2,}$/.test(v) ? v.slice(0, -1) + "." + v.slice(-1) : v);

function parseTime(s) {
  const m = /(20\d\d)-(\d\d)-(\d\d)[ T](\d\d)[:.](\d\d)[:.](\d\d)/.exec(s.replace(/[Oo]/g, "0"));
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) - COLOMBO_MS : null;
}

async function readSubplot(img, a, page, spanH) {
  const text = await ocr(img, [Math.max(0, a.x0 - 40), Math.max(32, a.top - 56), Math.min(img.w, a.x1 + 40), a.top - 2], ["--psm", "6"]);
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const station = snapName(lines[0] ?? "");
  const base = { group: page, station, box: a };
  if (/not responded|responded in/i.test(text)) return { ...base, status: "offline" };
  const lv = /Level\s*=?\s*(-?\d+[.,]\d+)/i.exec(text), ob = /Observed.*?(20\d\d[-.]\d\d[-.]\d\d.{1,3}\d\d.\d\d.\d\d)/i.exec(text.replace(/—/g, "-"));
  const obs = ob ? parseTime(ob[1].replace(/(\d\d)\.(\d\d)\.(\d\d)$/, "$1:$2:$3")) : null;
  if (!lv || obs === null) return { ...base, status: "parse_error", detail: JSON.stringify(text.slice(0, 120)) };
  let level = Number(lv[1].replace(",", "."));

  // Axis calibration.
  const gx = gridlines(img, a, true), gy = gridlines(img, a, false);
  if (gy.length < 2) return { ...base, status: "parse_error", detail: `grid y=${gy.length}`, level, obs };
  // px per hour: from the 2-hourly vertical gridlines; plots without x ticks have no vertical grid, so use
  // the time span the other subplots of the page show across the same axes width.
  const gridded = gx.length >= 4;
  if (!gridded && !spanH) return { ...base, status: "parse_error", detail: "no x calibration", level, obs };
  const pph = gridded ? (gx[gx.length - 1] - gx[0]) / (2 * (gx.length - 1)) : (a.x1 - a.x0) / spanH;
  // y tick values (OCR, digits only), one per horizontal gridline.
  const ticks = []; // {y, c: candidate values}  (the decimal point is often lost: "28" may be 2.8 or 28)
  for (const g of gy) {
    const c = [];
    // Small text: read each label with three page-segmentation modes and keep every plausible reading.
    for (const psm of ["7", "8", "13"]) {
      const t = (await ocr(img, [Math.max(0, a.x0 - 46), g - 9, a.x0 - 8, g + 9], ["--psm", psm, "-c", "tessedit_char_whitelist=0123456789.-"])).trim().replace(/−/g, "-");
      const m = /(-?)(\d+(?:\.\d+)?)/.exec(t);
      if (m) for (const sign of m[1] ? [-1, 1] : [1]) for (const v of [Number(fixDecimal(m[2])), Number(m[2])]) if (!c.includes(sign * v)) c.push(sign * v);
    }
    ticks.push({ y: g, c });
  }
  const cols = curveColumns(img, a);
  const have = cols.filter(Boolean);
  if (have.length < 20) return { ...base, status: "parse_error", detail: "no curve", level, obs };
  const last = have[have.length - 1];
  const yEnd = last.y;

  // Fit value(i) = v0 - i*step over the gridlines. OCR slips on single ticks (6.8 read as 6.6, a lost minus
  // sign), so vote: the offset most ticks agree on wins, for each plausible step.
  const pxPerTick = (gy[gy.length - 1] - gy[0]) / (gy.length - 1);
  const hyps = [];
  for (const st of [0.05, 0.1, 0.2, 0.25, 0.5, 1, 2, 5, 10]) {
    const offs = ticks.flatMap((t, i) => t.c.map((v) => v + i * st));
    for (const o of new Set(offs.map((v) => Math.round(v * 1000) / 1000))) {
      const votes = ticks.filter((t, i) => t.c.some((v) => Math.abs(v + i * st - o) < 0.002)).length;
      if (votes >= 2) hyps.push({ step: st, v0: o, votes });
    }
  }
  // Best supported hypothesis; among equals prefer the one that agrees with the title value.
  const endEst = (h) => h.v0 - (yEnd - gy[0]) * (h.step / pxPerTick);
  hyps.sort((p, q) => q.votes - p.votes);
  const top = hyps[0]?.votes ?? 0;
  if (process.env.CURW_DEBUG) console.error(station, JSON.stringify(ticks.map((t) => t.c)), JSON.stringify(hyps.slice(0, 4)));
  const fit = hyps.filter((h) => h.votes === top).sort((p, q) => Math.abs(endEst(p) - level) - Math.abs(endEst(q) - level))[0] ?? null;
  const step = fit && fit.votes >= 2 ? fit.step : null;
  const kPx = step ? step / pxPerTick : null;        // metres per pixel
  let flag = "";
  let v0 = step ? fit.v0 : null;                      // value at the top gridline
  const est = () => v0 - (yEnd - gy[0]) * kPx;
  if (step) {
    if (Math.abs(est() - level) > 0.04) {
      // Title OCR slip (27.102 for 2.102)? try the title with one character removed.
      const t = lv[1].replace(",", ".");
      const fixed = [...t].map((_, i) => Number(t.slice(0, i) + t.slice(i + 1))).filter((v) => Number.isFinite(v) && Math.abs(v - est()) <= 0.04).sort((p, q) => Math.abs(p - est()) - Math.abs(q - est()))[0];
      if (fixed !== undefined && Math.abs(level - est()) > 0.5) { level = fixed; flag = "title_ocr_fixed"; }
      else {
        // Tick labels off by whole steps (lost minus sign)? Then the title is right and the grid is shifted.
        const n = Math.round((level - est()) / step);
        if (n !== 0 && Math.abs(level - (est() + n * step)) <= 0.04) { v0 += n * step; flag = "axis_shifted"; }
        else flag = "axis_mismatch";
      }
    }
  } else flag = "axis_unread";
  if (!step) {
    // No usable tick labels: only the title value is trustworthy; no curve is stored.
    return { ...base, status: "ok", obs, level, curveEnd: null, flag, xResidH: null, step: null, samples: [{ t: obs, level, src: "title" }] };
  }
  // The title value is exact for the last point. Absorb the small constant offset between the digitised curve
  // end and it (about 0.005 m) when the two agree; a larger disagreement is flagged and the title wins.
  const est0 = est();
  const residual = level - est0;
  if (Math.abs(residual) <= 0.04) v0 += residual;
  else if (!flag) flag = "axis_mismatch";
  if (flag === "axis_mismatch") v0 += residual;
  const toLevel = (y) => v0 - (y - gy[0]) * kPx;

  // Time calibration: line end = observedAt. Sanity: gridlines must fall on whole hours.
  const xEnd = last.x + 0.5;
  const tAt = (x) => obs - ((xEnd - x) / pph) * 3600_000;
  const resid = !gridded ? [0] : gx.map((g) => { const h = (tAt(g) + COLOMBO_MS) / 3600_000; const r = ((h % 1) + 1) % 1; return Math.min(r, 1 - r); });
  const xResidH = resid.sort((p, q) => p - q)[resid.length >> 1];
  if (xResidH > 0.25) flag = (flag ? flag + "," : "") + "x_misaligned";

  // 15-minute samples back from observedAt, interpolating the digitised curve between columns.
  const first = have[0];
  const yAtX = (x) => { const i = Math.round(x) - (a.x0 + 2); for (let d = 0; d < 6; d++) { for (const j of [i - d, i + d]) { if (cols[j]) return cols[j].y; } } return null; };
  const samples = [];
  for (let n = 0; n < 96; n++) {
    const t = obs - n * 15 * 60_000, x = xEnd - ((obs - t) / 3600_000) * pph;
    if (x < first.x - 0.5) break;
    const y = n === 0 ? yEnd : yAtX(x);
    if (y === null) continue;
    samples.push({ t, level: n === 0 ? level : Math.round(toLevel(y) * 1000) / 1000, src: n === 0 ? "title" : "curve" });
  }
  return { ...base, status: "ok", obs, level, curveEnd: est0, residual, flag, xResidH, step, samples };
}

async function readPage(page, buf) {
  const img = decodePng(buf);
  const axes = findAxes(img);
  const out = [];
  const spans = axes.map((a) => { const g = gridlines(img, a, true); return g.length >= 4 ? (a.x1 - a.x0) / ((g[g.length - 1] - g[0]) / (2 * (g.length - 1))) : null; }).filter(Boolean).sort((p, q) => p - q);
  const spanH = spans.length ? spans[spans.length >> 1] : 24.4;
  for (let i = 0; i < axes.length; i += 3) {
    const batch = await Promise.all(axes.slice(i, i + 3).map((a) => {
      return readSubplot(img, a, page, spanH).catch((e) => ({ group: page, station: "?", box: a, status: "parse_error", detail: String(e.message ?? e) }));
    }));
    out.push(...batch);
  }
  return out;
}

// ---------------------------------------------------------------- main
const iso = (t) => new Date(t + COLOMBO_MS).toISOString().replace("Z", COLOMBO).replace(/\.\d+/, "");
const colomboDay = (t) => new Date(t + COLOMBO_MS).toISOString().slice(0, 10);

async function main() {
  const argv = process.argv.slice(2);
  const val = (flag) => { const i = argv.indexOf(flag); return i >= 0 ? argv[i + 1] : null; };
  const fromDir = val("--from"), jsonlDir = val("--jsonl"), statusFile = val("--status");
  const asJson = argv.includes("--json");
  const skip = new Set([fromDir, jsonlDir, statusFile].filter(Boolean));
  const sqlFile = argv.filter((x) => !x.startsWith("--") && !skip.has(x))[0];
  if (!fromDir && !sqlFile) { console.error("usage: node scripts/curw-snapshot.mjs <out.sql> [--jsonl <dir>]  |  --from <pngDir> [--json]"); process.exit(1); }

  const buffers = {};
  for (const page of PAGES) {
    try {
      if (fromDir) buffers[page] = await readFile(path.join(fromDir, `${page.replace(/ /g, "%20")}.png`)).catch(() => readFile(path.join(fromDir, `${page}.png`)));
      else {
        const res = await fetch(BASE + encodeURIComponent(page) + ".png", { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(45_000) });
        if (!res.ok || !/image\/png/.test(res.headers.get("content-type") ?? "")) throw new Error(`HTTP ${res.status} ${res.headers.get("content-type")}`);
        buffers[page] = Buffer.from(await res.arrayBuffer());
        await new Promise((r) => setTimeout(r, 1500));
      }
    } catch (e) { console.warn(`${page}: fetch failed: ${e.message ?? e}`); }
  }

  const results = []; const errors = [];
  for (const page of PAGES) {
    if (!buffers[page]) { errors.push(`${page}: not fetched`); continue; }
    const t0 = Date.now();
    try { results.push(...(await readPage(page, buffers[page]))); console.log(`${page}: read in ${Math.round((Date.now() - t0) / 1000)} s`); } catch (e) { errors.push(`${page}: ${e.message ?? e}`); }
  }

  // De-duplicate stations shown on several pages (first page wins).
  const seen = new Set(); const stations = [];
  for (const r of results) { if (seen.has(r.station)) { r.dup = true; continue; } seen.add(r.station); stations.push(r); }

  if (asJson) { console.log(JSON.stringify({ errors, results: results.map(({ box, samples, ...r }) => ({ ...r, samples: samples?.length, first: samples?.[samples.length - 1], samplesAll: samples })) }, null, 1)); return; }

  // Rows to write.
  const rows = [];
  for (const r of stations) {
    if (r.status !== "ok") continue;
    for (const s of r.samples) rows.push({ station: r.station, group: r.group, observedAt: iso(s.t), t: s.t, level_m_msl: s.level, src: s.src, status: "ok" });
  }
  if (jsonlDir) {
    const byDay = new Map();
    for (const r of rows) { const d = colomboDay(r.t); (byDay.get(d) ?? byDay.set(d, []).get(d)).push(r); }
    for (const [day, list] of byDay) {
      const dir = path.join(jsonlDir, "curw", day.slice(0, 4)), file = path.join(dir, `${day}.jsonl`);
      await mkdir(dir, { recursive: true });
      const have = new Set();
      if (existsSync(file)) for (const l of (await readFile(file, "utf8")).split("\n")) { if (!l) continue; try { const o = JSON.parse(l); have.add(`${o.station}|${o.observedAt}`); } catch { /* skip */ } }
      const fresh = list.sort((p, q) => p.t - q.t).filter((r) => !have.has(`${r.station}|${r.observedAt}`));
      if (fresh.length) await appendFile(file, fresh.map(({ t, ...o }) => JSON.stringify(o)).join("\n") + "\n");
    }
  }

  const q = (v) => (v == null ? "NULL" : typeof v === "number" ? String(v) : `'${String(v).replace(/'/g, "''")}'`);
  const nowMs = Date.now();
  const sql = [await readFile(new URL("../d1/0002_curw.sql", import.meta.url), "utf8")];
  const byStation = new Map();
  for (const r of rows) (byStation.get(r.station) ?? byStation.set(r.station, []).get(r.station)).push(r);
  for (const list of byStation.values()) {
    sql.push(`INSERT INTO curw_levels (station, grp, observed_ms, observed_at, level_m_msl, src, status, stored_at) VALUES\n${list
      .map((r) => `(${[r.station, r.group, r.t, r.observedAt, r.level_m_msl, r.src, r.status, nowMs].map(q).join(", ")})`).join(",\n")}\n`
      + `ON CONFLICT (station, observed_ms) DO UPDATE SET level_m_msl = excluded.level_m_msl, src = excluded.src WHERE excluded.src = 'title' AND curw_levels.src <> 'title';`);
  }
  for (const r of stations) {
    const ok = r.status === "ok";
    sql.push(`INSERT INTO curw_status (station, grp, status, observed_ms, level_m_msl, since_ms, last_observed_ms, checked_ms, detail) VALUES (${[r.station, r.group, r.status, ok ? r.obs : null, ok ? r.level : null, nowMs, ok ? r.obs : null, nowMs, r.detail ?? r.flag ?? null].map(q).join(", ")}) `
      + `ON CONFLICT (station) DO UPDATE SET grp = excluded.grp, since_ms = CASE WHEN curw_status.status = excluded.status THEN curw_status.since_ms ELSE excluded.since_ms END, status = excluded.status, observed_ms = excluded.observed_ms, level_m_msl = excluded.level_m_msl, `
      + `last_observed_ms = COALESCE(excluded.last_observed_ms, curw_status.last_observed_ms), checked_ms = excluded.checked_ms, detail = excluded.detail;`);
  }

  // Raw PNGs: once a day just after 06:00 Colombo, on a high or fast-rising level, or when parsing was doubtful.
  const bad = stations.filter((r) => r.status === "parse_error" || (r.status === "ok" && r.flag && r.flag !== "title_ocr_fixed"));
  const colomboNow = new Date(nowMs + COLOMBO_MS);
  const daily = colomboNow.getUTCHours() === 6 && colomboNow.getUTCMinutes() < 20;
  const high = stations.some((r) => r.status === "ok" && (r.level >= (RAW_LEVEL_OVERRIDE[r.station] ?? RAW_LEVEL_M) || (r.samples.length > 8 && r.level - Math.min(...r.samples.map((x) => x.level)) >= RAW_RISE_M)));
  const reasons = [high && "high level", daily && "daily", bad.length && "parse doubts", errors.length && "errors"].filter(Boolean);
  if (reasons.length || process.env.CURW_RAW) {
    const stamp = new Date(nowMs).toISOString().replace(/[-:]/g, "").slice(0, 13) + "00Z";
    for (const [page, buf] of Object.entries(buffers)) {
      const b64 = buf.toString("base64");
      for (let i = 0, n = 0; i < b64.length; i += 48_000, n++)
        sql.push(`INSERT OR IGNORE INTO curw_raw (page, stamp, seq, reason, b64, stored_ms) VALUES (${[page, stamp, n, reasons.join(", ") || "manual", b64.slice(i, i + 48_000), nowMs].map(q).join(", ")});`);
    }
    console.log(`Raw PNGs queued (${reasons.join(", ") || "manual"}).`);
  }
  sql.push(`DELETE FROM curw_raw WHERE stored_ms < ${nowMs - 14 * 86_400_000};`);
  // Hourly table + ready-made series for the site (see the end of d1/0002_curw.sql). Only the last 4 h of readings are
  // folded in each run (8 days while curw_hourly is still empty, i.e. the first run), so a run reads a few thousand rows, not the archive.
  const fold = `CASE WHEN EXISTS (SELECT 1 FROM curw_hourly) THEN ${nowMs - 4 * 3_600_000} ELSE ${nowMs - 8 * 86_400_000} END`;
  sql.push(`INSERT INTO curw_hourly (station, grp, hour_ms, observed_ms, level_m_msl)
SELECT station, grp, observed_ms - observed_ms % 3600000, observed_ms, level_m_msl FROM curw_levels WHERE observed_ms > ${fold} AND observed_ms % 3600000 < 900000 ORDER BY observed_ms DESC
ON CONFLICT (station, hour_ms) DO UPDATE SET observed_ms = excluded.observed_ms, level_m_msl = excluded.level_m_msl WHERE excluded.observed_ms <= curw_hourly.observed_ms;`);
  sql.push(`DELETE FROM curw_hourly WHERE hour_ms < ${nowMs - 8 * 86_400_000};`);
  sql.push(`INSERT OR REPLACE INTO curw_series (station, grp, pts, updated_ms)
SELECT station, MAX(grp), json_group_array(json_array(ms, m)), ${nowMs} FROM (
  SELECT station, grp, observed_ms AS ms, level_m_msl AS m FROM curw_hourly WHERE hour_ms > ${nowMs - 7 * 86_400_000} AND observed_ms <= ${nowMs - 3 * 3_600_000}
  UNION ALL SELECT station, grp, observed_ms, level_m_msl FROM curw_levels WHERE observed_ms > ${nowMs - 3 * 3_600_000}
  ORDER BY station, ms) GROUP BY station;`);
  sql.push(`DELETE FROM curw_series WHERE updated_ms < ${nowMs};`);
  await writeFile(sqlFile, sql.join("\n") + "\n");

  if (statusFile) {
    // Operational counts only (no levels, no names): how many gauges work. The workflow publishes it for the health check.
    const n = (st) => stations.filter((r) => r.status === st).length;
    await writeFile(statusFile, JSON.stringify({ total: stations.length, ok: n("ok"), offline: n("offline"), unreadable: n("parse_error") }) + "\n");
  }
  const counts = stations.reduce((m, r) => ((m[r.status] = (m[r.status] ?? 0) + 1), m), {});
  const offline = stations.filter((r) => r.status === "offline").map((r) => r.station);
  console.log(`CUrW: ${stations.length} stations ${JSON.stringify(counts)}, ${rows.length} rows${offline.length ? `, offline: ${offline.join(", ")}` : ""}${bad.length ? `, doubtful: ${bad.map((r) => `${r.station} (${r.detail ?? r.flag})`).join("; ")}` : ""}${errors.length ? `, errors: ${errors.join("; ")}` : ""}`);
  // Fail the run (so the health check and Slack notice) when nothing could be read, a page is missing, or the
  // source has stopped updating (newest observation of every working gauge older than 2 h).
  const newest = Math.max(0, ...stations.filter((r) => r.status === "ok").map((r) => r.obs));
  if (!stations.some((r) => r.status === "ok")) { console.error("No station could be read."); process.exitCode = 1; }
  else if (nowMs - newest > 2 * 3600_000) { console.error(`Newest CUrW reading is ${Math.round((nowMs - newest) / 60000)} min old: the source has stopped updating.`); process.exitCode = 1; }
  else if (errors.length) { console.error(`Some pages failed: ${errors.join("; ")}`); process.exitCode = 1; }
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, `CUrW: ${stations.length} stations, ${counts.ok ?? 0} ok, ${offline.length} offline (${offline.join(", ") || "none"})\n`);
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => (tmpDir ? rm(tmpDir, { recursive: true, force: true }) : undefined));
