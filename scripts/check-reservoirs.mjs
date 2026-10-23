// Self-check for the reservoir pages: reads the raw sources itself (its own tiny parser, none of the
// site's code) and flags any difference from what the deployed site parsed.
//
//   node scripts/check-reservoirs.mjs [baseUrl]        (default https://sl-water-levels.vercel.app)
//
// 1. Irrigation Department sheet (Major + Medium CSV) vs /api/releases `sheet.rows`: spilling,
//    spill cusecs, sluice cusecs, depth, full-supply depth and reading day, row by row.
// 2. Mahaweli WMS PDF vs /api/releases `wms.rows` (needs `pdftotext` on the PATH; skipped otherwise):
//    storage % and downstream discharge.
// 3. /reservoirs (index) shows every spilling reservoir's cusec figure.
// Exit code 1 when anything differs. A row is only compared when both sides have it.

import { execFileSync } from "node:child_process";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const base = (process.argv[2] ?? "https://sl-water-levels.vercel.app").replace(/\/$/, "");
const SHEET = "https://docs.google.com/spreadsheets/d/e/2PACX-1vTcSGhi9RESl7CMCl1TQnrKe07Gx5Q696YiSB9jneIHqIP9lifpqSErgI3D5k9KtQXSdW5JpycIIr5e";
const TABS = [["Major", 1212294664], ["Medium", 562386515]];
const MON = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const problems = [];
const flag = (m) => { problems.push(m); console.log("MISMATCH", m); };

function csv(text) {
  const rows = []; let row = [], cur = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"' && text[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; }
    else if (c === '"') q = true;
    else if (c === ",") { row.push(cur); cur = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && text[i + 1] === "\n") i++; row.push(cur); rows.push(row); row = []; cur = ""; }
    else cur += c;
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  return rows;
}
const n = (s) => { const t = (s ?? "").replace(/[,%]/g, "").trim(); return /^-?\d+(\.\d+)?$/.test(t) ? Number(t) : null; };
const get = async (u) => { const r = await fetch(u, { headers: { "User-Agent": "sl-water-levels-check" } }); if (!r.ok) throw new Error(`${u} -> HTTP ${r.status}`); return r; };

// ---- 1. sheet
const api = await (await get(`${base}/api/releases`)).json();
if (!api.sheet?.rows) throw new Error("deployed /api/releases has no sheet rows: " + JSON.stringify(api.sheet));
const raw = new Map();
for (const [tab, gid] of TABS) {
  const grid = csv(await (await get(`${SHEET}/pub?gid=${gid}&single=true&output=csv`)).text());
  const hi = grid.findIndex((r) => r.some((c) => c.trim().toUpperCase() === "RESERVOIR"));
  const H = grid[hi].map((h) => h.replace(/\s+/g, " ").trim().toLowerCase());
  const ix = (f) => H.findIndex(f);
  const c = { name: ix((h) => h === "reservoir"), date: ix((h) => h === "date"), depth: ix((h) => h.startsWith("water depth")), fsd: ix((h) => h.startsWith("fsd")),
    sp: ix((h) => h === "spilling"), spc: ix((h) => h.includes("spilling") && h.includes("cusec")), slc: ix((h) => h.includes("sluice") && h.includes("cusec")) };
  const title = grid.slice(0, hi).flat().join(" ");
  const ym = /(20\d\d)/.exec(title)?.[1] ?? String(new Date().getFullYear());
  for (const r of grid.slice(hi + 1)) {
    const name = (r[c.name] ?? "").replace(/\s+/g, " ").trim();
    const d = /^(\d{1,2})[-\s]([A-Za-z]{3})/.exec((r[c.date] ?? "").trim());
    if (!name || !d) continue;
    raw.set(`${tab}|${name}`, { day: `${ym}-${String(MON.indexOf(d[2].toLowerCase()) + 1).padStart(2, "0")}-${d[1].padStart(2, "0")}`,
      spilling: /^y/i.test((r[c.sp] ?? "").trim()), spill: n(r[c.spc]), sluice: c.slc >= 0 ? n(r[c.slc]) : null, depth: n(r[c.depth]), fsd: n(r[c.fsd]), cells: r });
  }
}
let compared = 0;
const shown = [];
for (const a of api.sheet.rows) {
  const w = raw.get(`${a.tab}|${a.name}`);
  if (!w) continue;
  compared++;
  const diffs = [];
  if (w.spilling !== a.spilling) diffs.push(`spilling raw=${w.spilling} site=${a.spilling}`);
  if (w.spill !== a.spillCusecs) diffs.push(`spill raw=${w.spill} site=${a.spillCusecs}`);
  if (w.sluice !== a.sluiceCusecs) diffs.push(`sluice raw=${w.sluice} site=${a.sluiceCusecs}`);
  if (w.depth !== a.depthFt) diffs.push(`depth raw=${w.depth} site=${a.depthFt}`);
  if (w.fsd !== a.fsdFt) diffs.push(`fsd raw=${w.fsd} site=${a.fsdFt}`);
  if (w.day !== a.day) diffs.push(`day raw=${w.day} site=${a.day}`);
  if (diffs.length) flag(`sheet ${a.tab} "${a.name}": ${diffs.join("; ")}`);
  if (a.spilling && shown.length < 5) shown.push({ name: a.name, raw: w.cells.slice(0, 20).map((x) => x.trim()).join(" | "), site: a });
}
console.log(`sheet: compared ${compared} of ${api.sheet.rows.length} site rows against ${raw.size} raw rows (site sheet date ${api.sheet.sheetDate})`);
for (const s of shown) console.log(`  ${s.name}\n    raw : ${s.raw}\n    site: day=${s.site.day} spilling=${s.site.spilling} spill=${s.site.spillCusecs} sluice=${s.site.sluiceCusecs} depth=${s.site.depthFt} fsd=${s.site.fsdFt}`);

// ---- 2. WMS
try {
  const pdf = Buffer.from(await (await get("https://mahaweli.gov.lk/WMS%20DATA/Menue-WMS%20-%20E.pdf")).arrayBuffer());
  const dir = mkdtempSync(path.join(tmpdir(), "wms-"));
  const f = path.join(dir, "wms.pdf");
  writeFileSync(f, pdf);
  const text = execFileSync("pdftotext", ["-layout", f, "-"], { encoding: "utf8" });
  const lines = text.split("\n");
  let wc = 0;
  for (const r of api.wms?.rows ?? []) {
    const esc = r.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const line = lines.find((l) => new RegExp(`^\\s*\\d{1,2}\\s+${esc}(\\s|$)`, "i").test(l));
    if (!line) continue;
    wc++;
    const pct = /(\d+)%/.exec(line)?.[1];
    if (pct != null && r.storagePct != null && Number(pct) !== r.storagePct) flag(`wms "${r.name}": storage raw=${pct}% site=${r.storagePct}%`);
    // After the % come rain (mm, may be blank), m3/s and ft3/s. The cusec figure is the last number
    // that is about 35.31 x the one before it; anything else counts as a blank cell.
    const tail = line.replace(/^.*?\d+%\s*/, "").trim().split(/\s+/).map(n).filter((x) => x != null);
    const rawCusec = tail.length >= 2 && Math.abs(tail[tail.length - 2] * 35.3147 - tail[tail.length - 1]) <= 0.02 * tail[tail.length - 1] + 1 ? tail[tail.length - 1] : null;
    if (rawCusec != null && r.dischargeCusecs != null && Math.abs(rawCusec - r.dischargeCusecs) > 1) flag(`wms "${r.name}": discharge raw=${rawCusec} site=${r.dischargeCusecs}`);
    if (rawCusec == null && r.dischargeCusecs != null && r.dischargeCusecs !== 0) flag(`wms "${r.name}": raw discharge blank but site shows ${r.dischargeCusecs}`);
  }
  console.log(`wms: matched ${wc} of ${api.wms?.rows?.length ?? 0} rows in the PDF text`);
} catch (e) {
  console.log(`wms: skipped (${e.code === "ENOENT" ? "pdftotext not installed" : e.message})`);
}

// ---- 3. index shows the spill figures
const index = await (await get(`${base}/reservoirs`)).text();
const text = index.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
for (const a of api.sheet.rows.filter((r) => r.spilling && (r.spillCusecs ?? 0) > 0 && r.day >= (api.sheet.sheetDate ?? ""))) {
  if (!text.includes(`${a.spillCusecs.toLocaleString("en-US")} cusecs`)) flag(`index /reservoirs does not show ${a.name} at ${a.spillCusecs} cusecs`);
}
console.log(problems.length ? `\n${problems.length} problem(s)` : "\nall consistent");
process.exit(problems.length ? 1 : 0);
