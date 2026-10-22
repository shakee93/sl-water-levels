// Zero-dependency fuzzy place/river/station search. Pure (data is passed in) so the
// node test in scripts/fuzzy.test.mts can run it without a bundler.
import type { Place, RiverAlias } from "./places";

export type StationLite = { basin: string; station: string; latitude: number; longitude: number };
export type Hit =
  | { kind: "place"; label: string; sub: string; score: number; gauges: { station: string; basin: string; km: number }[] }
  | { kind: "river"; label: string; sub: string; score: number; gauges: { station: string; basin: string; km: null }[] }
  | { kind: "station"; label: string; sub: string; score: number; gauges: { station: string; basin: string; km: null }[] };

const NON_LATIN = /[඀-෿஀-௿]/;

// ---- normalisation -------------------------------------------------------
// NB: only strip Latin combining marks (U+0300-036F). Sinhala/Tamil vowel signs are
// combining marks too, so a blanket \p{M} strip would destroy them.
export function fold(input: string): string {
  let s = input.normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[​-‍]/g, "");
  if (NON_LATIN.test(s)) return s.normalize("NFC").replace(/[^\p{L}\p{M}\p{N}]+/gu, " ").trim();
  s = s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  return s
    .replace(/(t|d|k|b|g)h/g, "$1") // Rathnapura = Ratnapura, Biyagama...
    .replace(/ph/g, "p")
    .replace(/w/g, "v") // Hanwella = Hanvella
    .replace(/c(?!h)/g, "k") // Colombo = Kolombo
    .replace(/z/g, "s")
    .replace(/ee|ii|ie/g, "i")
    .replace(/oo|ou/g, "u")
    .replace(/aa/g, "a")
    .replace(/(.)\1+/g, "$1") // Wellampitiya = Welampitiya, Kolonnawa = Kolonava
    .replace(/\s+/g, " ");
}

// ---- similarity ------------------------------------------------------------
function dl(a: string, b: string): number {
  const n = a.length, m = b.length;
  const d: number[][] = Array.from({ length: n + 1 }, (_, i) => [i, ...Array(m).fill(0)]);
  for (let j = 0; j <= m; j++) d[0][j] = j;
  for (let i = 1; i <= n; i++)
    for (let j = 1; j <= m; j++) {
      const c = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + c);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  return d[n][m];
}
function grams(s: string): Set<string> {
  const p = ` ${s} `, g = new Set<string>();
  for (let i = 0; i < p.length - 2; i++) g.add(p.slice(i, i + 3));
  return g;
}
function dice(a: string, b: string): number {
  const A = grams(a), B = grams(b);
  let x = 0;
  for (const g of A) if (B.has(g)) x++;
  return (2 * x) / (A.size + B.size || 1);
}

// Score one folded query against one folded candidate. 0 = no match, 1 = exact.
export function scoreOne(q: string, c: string): number {
  if (!q || !c) return 0;
  if (q === c) return 1;
  const ratio = q.length / c.length;
  if (c.startsWith(q)) return 0.88 + 0.1 * ratio;
  if (c.split(" ").some((t) => t.startsWith(q))) return 0.75 + 0.1 * ratio; // word-prefix
  if (q.length >= 3 && c.includes(q)) return 0.6 + 0.1 * ratio;
  if (q.length < 3) return 0;
  const non = NON_LATIN.test(q);
  const full = Math.max(dice(q, c), 1 - dl(q, c) / Math.max(q.length, c.length));
  // typo while still typing: compare against the candidate's same-length prefix
  const pre = c.length > q.length ? 1 - dl(q, c.slice(0, q.length + 1)) / (q.length + 1) : 0;
  const sim = Math.max(full, pre * 0.95);
  const min = non ? 0.7 : 0.62;
  return sim >= min ? 0.3 + 0.5 * sim : 0;
}

// ---- index + search --------------------------------------------------------
type Entry = { forms: string[]; hit: Omit<Hit, "score">; bias: number };
const km = (aLat: number, aLon: number, bLat: number, bLon: number) => {
  const r = (d: number) => (d * Math.PI) / 180, dLa = r(bLat - aLat), dLo = r(bLon - aLon);
  const h = Math.sin(dLa / 2) ** 2 + Math.cos(r(aLat)) * Math.cos(r(bLat)) * Math.sin(dLo / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
};

export function buildIndex(stations: StationLite[], places: Place[], rivers: RiverAlias[]): Entry[] {
  const by = new Map(stations.map((s) => [s.station, s]));
  const out: Entry[] = [];
  for (const p of places) {
    const gauges = p.stations.flatMap((n) => {
      const s = by.get(n);
      return s ? [{ station: s.station, basin: s.basin.trim(), km: Math.round(km(p.lat, p.lon, s.latitude, s.longitude)) }] : [];
    });
    if (!gauges.length) continue;
    out.push({ forms: [p.name, ...p.aliases].map(fold), bias: 0, hit: { kind: "place", label: p.name, sub: p.district, gauges } });
  }
  for (const r of rivers) {
    const gauges = stations.filter((s) => s.basin.trim() === r.basin).map((s) => ({ station: s.station, basin: r.basin, km: null }));
    out.push({ forms: [r.basin, ...r.aliases].map(fold), bias: 0.005, hit: { kind: "river", label: r.basin, sub: `${gauges.length} gauges`, gauges } });
  }
  for (const s of stations) // gauge names last: users rarely know them, and a place of the same name wins
    out.push({ forms: [fold(s.station)], bias: -0.02, hit: { kind: "station", label: s.station, sub: s.basin.trim(), gauges: [{ station: s.station, basin: s.basin.trim(), km: null }] } });
  return out;
}

export function search(query: string, index: Entry[], limit = 6): Hit[] {
  const q = fold(query);
  if (q.length < (NON_LATIN.test(q) ? 2 : 2)) return [];
  const hits: Hit[] = [];
  for (const e of index) {
    let best = 0;
    for (const f of e.forms) best = Math.max(best, scoreOne(q, f));
    if (best > 0) hits.push({ ...e.hit, score: best + e.bias } as Hit);
  }
  hits.sort((a, b) => b.score - a.score || a.label.length - b.label.length);
  // 1) a gauge already shown as a place's primary gauge is noise; 2) when there is a
  // strong hit, drop weak fuzzy hits so "Kaduwela" doesn't also offer "Wadduwa".
  const floor = hits[0] && hits[0].score >= 0.88 ? 0.7 : 0;
  const primary = new Set<string>();
  const out: Hit[] = [];
  for (const h of hits) {
    if (h.score < floor) break;
    if (h.kind === "station" && primary.has(h.label)) continue;
    if (h.kind === "place") primary.add(h.gauges[0].station);
    out.push(h);
  }
  return out.slice(0, limit);
}
