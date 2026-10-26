#!/usr/bin/env node
// Builds lib/model/flood-map.json from the Irrigation Department's official flood maps, once, at dev time.
//   node scripts/build-flood-map.mjs
// Source: services3.arcgis.com/J7ZFXmR8rSmQ3FGf/.../Flood_Map/FeatureServer (same ArcGIS org as our gauges; public; SR 5234,
// so every query asks outSR=4326). It holds one group of layers per mapped PAST flood: River_Basin, "Flood Inundation Area"
// (the flooded extent of that event), Flood_Inundation_DSD and Flood_Inundation_GND (the divisions the extent touches). Each
// group is one event ("Kelani Ganga Flood 2016 Major", "Kalu Ganga Flood 2017" ...), identified by the `Flooding_area` field,
// so the script discovers the layers by name instead of trusting layer ids. Kelani has three events (1989 critical, 2012
// minor, 2016 major). Static: last edited Dec 2025; re-run only if the service changes.
//
// Output (no polygons; the page only names divisions):
//   { source, edited, events: [{ id, basin, year, grade, km2, dsds: [[dsd, district]] }],
//     gn: [[name, dsd, district, lat, lon, rKm, [event index...]]] }
// lat/lon is the GN division's centroid, rKm the radius of a circle of the same area: lib/floodMap.ts uses both to find
// divisions near a town. A GN is listed when ANY part of it was inside the flooded extent, not the whole of it.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "lib", "model", "flood-map.json");
const BASE = "https://services3.arcgis.com/J7ZFXmR8rSmQ3FGf/arcgis/rest/services/Flood_Map/FeatureServer";
const UA = "sl-water-levels-flood-map-build/1.0 (https://github.com/shakee93/sl-water-levels; shakee.zats@gmail.com)";

// Their basin spelling -> ours (hydrostations.basin, trimmed). Basins we have no gauge on keep a cleaned version of their name.
const BASIN = { "Attanagalu Oya": "Aththanagalu Oya", "Maha Oya (102)": "Maha Oya", "Mundani Aru": "Mundeni Aru" };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function get(url) {
  for (let i = 0; i < 4; i++) {
    await sleep(1200); // ArcGIS answers "Too many requests" in a 200 body at about 1 req/s
    const res = await fetch(url, { headers: { "User-Agent": UA } });
    const j = await res.json().catch(() => null);
    if (res.ok && j && !j.error) return j;
    console.warn("retry", url, res.status, j?.error?.message);
    await sleep(5000 * (i + 1));
  }
  throw new Error("failed: " + url);
}
async function all(layer, fields, extra = "", where = "1=1") {
  const rows = [];
  for (let offset = 0; ; offset += 1000) {
    const j = await get(`${BASE}/${layer}/query?where=${encodeURIComponent(where)}&outFields=${fields}&returnGeometry=false&outSR=4326&orderByFields=OBJECTID&resultOffset=${offset}&resultRecordCount=1000${extra}&f=json`);
    rows.push(...j.features);
    if (!j.exceededTransferLimit) return rows;
  }
}

const title = (s) => String(s ?? "").trim().toLowerCase().replace(/(^|[\s\-(/.])(\p{L})/gu, (_, a, b) => a + b.toUpperCase());
const round = (x, n) => Math.round(x * 10 ** n) / 10 ** n;

const svc = await get(`${BASE}?f=json`);
const layers = svc.layers.map((l) => ({ id: l.id, name: l.name }));
const editedMs = Math.max(...(await Promise.all(layers.slice(0, 1).map((l) => get(`${BASE}/${l.id}?f=json`)))).map((d) => d.editingInfo?.lastEditDate ?? 0));

// Event name per layer: one query of Flooding_area on each inundation / DSD / GND layer.
const events = new Map(); // Flooding_area -> { dsdLayers, gnLayers, km2 }
for (const l of layers) {
  if (l.name === "River_Basin") continue;
  const f = await all(l.id, l.name === "Flood Inundation Area" ? "Flooding_area,Shape__Area" : "Flooding_area");
  const names = new Set(f.map((x) => String(x.attributes.Flooding_area ?? "").trim()).filter(Boolean));
  for (const n of names) {
    const e = events.get(n) ?? { dsdLayers: [], gnLayers: [], km2: 0 };
    if (l.name === "Flood Inundation Area") e.km2 += f.reduce((s, x) => s + (x.attributes.Shape__Area ?? 0), 0) / 1e6;
    else if (/DSD/.test(l.name)) e.dsdLayers.push(l.id);
    else if (/GND/.test(l.name)) e.gnLayers.push(l.id);
    events.set(n, e);
  }
  console.log(l.id, l.name, [...names].join(" | "));
}

const outEvents = [];
const gn = new Map(); // admin_code -> row
for (const [name, e] of [...events].sort(([a], [b]) => a.localeCompare(b))) {
  // An event needs a mapped extent and its GN list; layer 85 (a combined DSD layer) also names a "Kelani Ganag Flood 2016
  // Minor" that has neither, so it is dropped.
  if (!e.km2 || !e.gnLayers.length) { console.warn("skip event without extent or GN layer:", name); continue; }
  const where = `Flooding_area = '${name.replace(/'/g, "''")}'`;
  const m = name.replace(/Ganag/, "Ganga").match(/^(.*?)\s+Flood\s+(\d{4})\s*(\w+)?$/i);
  if (!m) { console.warn("skip unparsed event", name); continue; }
  const theirs = m[1].trim();
  const basin = BASIN[theirs] ?? theirs;
  const year = Number(m[2]);
  const grade = m[3] ? m[3].toLowerCase() : null;
  const idx = outEvents.length;
  const dsds = new Map();
  for (const id of e.dsdLayers) for (const f of await all(id, "dsd_name,district_n", "", where)) {
    const a = f.attributes;
    dsds.set(`${a.dsd_name}|${a.district_n}`, [title(a.dsd_name), title(a.district_n)]);
  }
  for (const id of e.gnLayers) for (const f of await all(id, "gnd_name,dsd_name,district_n,admin_code,Shape__Area", "&returnCentroid=true", where)) {
    const a = f.attributes;
    if (!f.centroid || !a.gnd_name) continue;
    const key = String(a.admin_code ?? `${a.gnd_name}|${a.dsd_name}`);
    const row = gn.get(key) ?? [String(a.gnd_name).trim(), title(a.dsd_name), title(a.district_n), round(f.centroid.y, 4), round(f.centroid.x, 4), round(Math.sqrt((a.Shape__Area ?? 0) / Math.PI) / 1000, 2), []];
    if (!row[6].includes(idx)) row[6].push(idx);
    gn.set(key, row);
    dsds.set(`${a.dsd_name}|${a.district_n}`, [title(a.dsd_name), title(a.district_n)]); // a few GN layers name DSDs their DSD layer lacks
  }
  const dedup = new Map([...dsds.values()].map((d) => [d.join("|"), d]));
  outEvents.push({ id: `${basin.toLowerCase().replace(/\s+/g, "-")}-${year}`, basin, year, grade, km2: round(e.km2, 1), dsds: [...dedup.values()].sort((a, b) => a[1].localeCompare(b[1]) || a[0].localeCompare(b[0])) });
  console.log(basin.padEnd(18), year, (grade ?? "").padEnd(8), "DSD", dedup.size, "km2", round(e.km2, 1));
}

const out = {
  source: BASE.replace("/FeatureServer", ""),
  edited: editedMs ? new Date(editedMs).toISOString().slice(0, 10) : null,
  events: outEvents,
  gn: [...gn.values()].sort((a, b) => a[2].localeCompare(b[2]) || a[1].localeCompare(b[1]) || a[0].localeCompare(b[0])),
};
fs.writeFileSync(OUT, JSON.stringify(out) + "\n");
console.log("wrote", path.relative(ROOT, OUT), out.events.length, "events,", out.gn.length, "GN divisions,", Math.round(fs.statSync(OUT).size / 1024), "KB");
