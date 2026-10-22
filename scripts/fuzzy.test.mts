import { readFileSync } from "node:fs";
// @ts-ignore node strip-types needs explicit extensions
import { buildIndex, search } from "../lib/fuzzy.ts";
// @ts-ignore
import { PLACES, RIVERS } from "../lib/places.ts";
const stations = JSON.parse(readFileSync(new URL("./fuzzy-stations.json", import.meta.url), "utf8"));
const t0 = performance.now();
const idx = buildIndex(stations, PLACES, RIVERS);
const t1 = performance.now();
const cases: [string, string][] = [
  ["Kaduwela", "Kaduwela"], ["Malabe", "Malabe"], ["Ratnapura", "Ratnapura"], ["Rathnapura", "Ratnapura"], ["Kolonnawa", "Kolonnawa"],
  ["Biyagama", "Biyagama"], ["Wellampitiya", "Wellampitiya"], ["Galle", "Galle"], ["Matara", "Matara"], ["Kurunegala", "Kurunegala"],
  ["kelani", "Kelani Ganga"], ["kalu ganga", "Kalu Ganga"], ["mahaweli", "Mahaweli Ganga"], ["Kelaniya", "Kelaniya"],
  ["Hanvella", "Hanwella"], ["Hanwela", "Hanwella"], ["Nagalagam", "Nagalagam Street"], ["Kalutra", "Kalutara"], ["avisawela", "Avissawella"],
  ["rat", "Ratnapura"], ["කැලණි", "Kelani Ganga"], ["රත්නපුර", "Ratnapura"], ["කඩුවෙල", "Kaduwela"], ["களனி", "Kelani Ganga"],
  ["කඩුවල", "Kaduwela"], ["ගාල්ල", "Galle"], ["xyzzy", "(none)"],
];
let ok = 0;
for (const [q, want] of cases) {
  const r = search(q, idx, 3);
  const top = r[0]?.label ?? "(none)";
  const pass = top === want; if (pass) ok++;
  console.log(`${pass ? "PASS" : "FAIL"} ${q.padEnd(13)} -> ${r.map((h) => `${h.label}[${h.score.toFixed(2)}]${h.kind === "place" ? " => " + h.gauges.map((g) => `${g.station} ${g.km}km`).join("/") : ""}`).join(" | ") || "(none)"}`);
}
console.log(`${ok}/${cases.length} top-1 correct; index build ${(t1 - t0).toFixed(1)}ms; ${idx.length} entries`);
const t2 = performance.now(); for (let i = 0; i < 200; i++) search("rathnapra", idx); console.log(`avg query ${((performance.now() - t2) / 200).toFixed(3)}ms`);
