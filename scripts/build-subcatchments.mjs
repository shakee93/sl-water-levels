#!/usr/bin/env node
// Splits every gauge's catchment (lib/model/catchments.json) into "near" (cells that belong to no gauge upstream of it) and "up"
// (cells of the catchments of the gauges upstream of it, same river system). Writes lib/model/subcatchments.json:
//   { "<basin>": { "<station>": { near: [cell idx], up: [cell idx], children: [station...] } } }
// "Upstream gauge" = another gauge of the same basin whose cells are a strict subset of this gauge's cells; only the outermost
// ones (not themselves inside another child) are listed as children. Rain on `up` reaches the gauge after a travel time; rain on
// `near` falls beside it. Used by the v4 storm model (rain on up-channels is a separate feature) and by the river-rain notes.
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const here = path.dirname(fileURLToPath(import.meta.url));
const cat = JSON.parse(readFileSync(path.join(here, "../lib/model/catchments.json"), "utf8")).basins;
const out = {};
for (const [basin, b] of Object.entries(cat)) {
  const st = b.stations ?? {};
  const sets = Object.fromEntries(Object.entries(st).map(([n, s]) => [n, new Set(s.cells)]));
  for (const [g, S] of Object.entries(sets)) {
    const sub = Object.keys(sets).filter((u) => u !== g && sets[u].size < S.size && [...sets[u]].every((c) => S.has(c)));
    const kids = sub.filter((u) => !sub.some((v) => v !== u && sets[v].size > sets[u].size && [...sets[u]].every((c) => sets[v].has(c))));
    const up = new Set(kids.flatMap((k) => [...sets[k]]));
    (out[basin] ??= {})[g] = { near: [...S].filter((c) => !up.has(c)), up: [...up], children: kids };
  }
}
writeFileSync(path.join(here, "../lib/model/subcatchments.json"), JSON.stringify(out) + "\n");
for (const [b, v] of Object.entries(out)) for (const [g, s] of Object.entries(v)) console.log(b.trim().padEnd(16), g.padEnd(26), "near", String(s.near.length).padStart(2), "up", String(s.up.length).padStart(2), s.children.join(", "));
