// The one place the search-wording of rivers, dams and towns lives. Titles, H1s, intro lines and meta descriptions are all
// built from these tables (lib/seoMeta.ts), so a new spelling people search for goes HERE and every page of that kind picks
// it up. Pure data and tiny helpers: safe in any component, the sitemap and tests.
//
// Evidence (Search Console, old domain, 90 days to 25 Oct 2026): people type "<river> river water level (today/live)", "<river>
// ganga water level today", "<gauge town> water level", "<town> flood level"; "river" is typed about twice as often as "ganga"
// for the Kelani; nobody types "basin". Spellings seen: kaluganga, kalu river, kuru ganga, aththanagalu / attanagalu oya.
import { RESERVOIRS } from "./reservoirs";
import { RIVERS, type Place } from "./places";
import type { Locale } from "./i18n/config";

export type RiverNames = {
  /** The name the title and H1 lead with. */
  lead: string;
  /** The other everyday name, put after the dash in the title and in the intro line. */
  alt: string | null;
  /** More spellings people type (shown in the "also searched as" line, never in the title). */
  also: string[];
  /** Romanised Sinhala people type ("kalu gage jala mattama"): meta description of the Sinhala page only. */
  rom: string[];
};

/** Basin keys are the TRIMMED `hydrostations.basin` values. Anything missing falls back to deriveRiver(). */
const RIVER_NAMES: Record<string, Partial<RiverNames>> = {
  "Kelani Ganga": { lead: "Kelani River", alt: "Kelani Ganga", also: ["Kelaniya River", "Kelani Gaga"], rom: ["kelani gange jala mattama", "kalani gage jala mattama"] },
  "Kalu Ganga": { lead: "Kalu Ganga", alt: "Kalu River", also: ["Kaluganga", "Kuru Ganga"], rom: ["kalu gage jala mattama", "kaluganga jala mattama"] },
  "Gin Ganga": { lead: "Gin Ganga", alt: "Gin River", also: ["Ging Ganga"], rom: ["gin gage jala mattama"] },
  "Nilwala Ganga": { lead: "Nilwala Ganga", alt: "Nilwala River", also: ["Nilwalaganga"], rom: ["nilwala gage jala mattama"] },
  "Mahaweli Ganga": { lead: "Mahaweli Ganga", alt: "Mahaweli River", also: ["Mahaveli", "Mahawali"], rom: ["mahaweli gange jala mattama"] },
  "Walawe Ganga": { lead: "Walawe Ganga", alt: "Walawe River", also: ["Walawa", "Walave"], rom: ["walawe gage jala mattama"] },
  "Menik Ganga": { lead: "Menik Ganga", alt: "Menik River", also: ["Manik Ganga"], rom: ["menik gage jala mattama"] },
  "Aththanagalu Oya": { lead: "Aththanagalu Oya", alt: "Attanagalu Oya", also: ["Attanagalla Oya", "Attanagalu River"], rom: ["attanagalu oya jala mattama"] },
  "Maha Oya": { lead: "Maha Oya", alt: "Maha Oya River", also: ["Mahaoya"], rom: ["maha oya jala mattama"] },
  "Deduru Oya": { lead: "Deduru Oya", alt: "Deduru River", also: ["Deduru"], rom: ["deduru oya jala mattama"] },
  "Kala Oya": { lead: "Kala Oya", alt: "Kala River", also: ["Kalaoya"], rom: ["kala oya jala mattama"] },
  "Kirindi Oya": { lead: "Kirindi Oya", alt: "Kirindi River", rom: ["kirindi oya jala mattama"] },
  "Malwathu Oya": { lead: "Malwathu Oya", alt: "Aruvi Aru", also: ["Malwatu Oya", "Malvathu Oya"], rom: ["malwathu oya jala mattama"] },
  "Gal Oya": { lead: "Gal Oya", alt: "Gal Oya River", also: ["Galoya"], rom: ["gal oya jala mattama"] },
  "Mee Oya": { lead: "Mee Oya", alt: "Mi Oya", also: ["Meeoya"], rom: ["mee oya jala mattama"] },
  "Yan Oya": { lead: "Yan Oya", alt: "Yaan Oya", rom: ["yan oya jala mattama"] },
  "Kumbukkan Oya": { lead: "Kumbukkan Oya", alt: "Kumbukkana Oya", rom: ["kumbukkan oya jala mattama"] },
  "Maduru Oya": { lead: "Maduru Oya", alt: "Maduru River", rom: ["maduru oya jala mattama"] },
  "Heda Oya": { lead: "Heda Oya", alt: "Heda River", rom: ["heda oya jala mattama"] },
  "Ma Oya": { lead: "Ma Oya", alt: "Maa Oya", rom: ["ma oya jala mattama"] },
};

/** Latin-script aliases already collected for the search box (lib/places.ts RIVERS), used to fill gaps. */
const LATIN = /^[\x20-\x7e]+$/;

export function deriveRiver(basin: string): RiverNames {
  const b = basin.trim();
  const alt = /Ganga$/.test(b) ? b.replace(/Ganga$/, "River") : /Oya$/.test(b) ? `${b.replace(/ Oya$/, "")} River` : null;
  const lower = b.toLowerCase().replace(/ganga$/, "gage");
  return { lead: b, alt, also: [], rom: [`${lower} jala mattama`] };
}

export function riverNames(basin: string): RiverNames {
  const b = basin.trim();
  const base = deriveRiver(b);
  const t = RIVER_NAMES[b] ?? {};
  const lead = t.lead ?? base.lead;
  const alt = t.alt !== undefined ? t.alt : base.alt;
  const seen = new Set([lead.toLowerCase(), (alt ?? "").toLowerCase(), b.toLowerCase()]);
  const also: string[] = [];
  for (const a of [...(t.also ?? []), ...(t.also ? [] : (RIVERS.find((r) => r.basin === b)?.aliases ?? []).filter((x) => LATIN.test(x) && x.includes(" ")))]) {
    const k = a.toLowerCase();
    if (!seen.has(k)) { seen.add(k); also.push(a); }
  }
  return { lead, alt: alt && alt.toLowerCase() !== lead.toLowerCase() ? alt : null, also: also.slice(0, 4), rom: t.rom ?? base.rom };
}

const SI_RE = /[඀-෿]/;
const TA_RE = /[஀-௿]/;
/** The river's name in the page script (null when the gazetteer has none). */
export function nativeRiver(basin: string, lang: Locale): string | null {
  if (lang === "en") return null;
  const re = lang === "si" ? SI_RE : TA_RE;
  const names = (RIVERS.find((r) => r.basin === basin.trim())?.aliases ?? []).filter((a) => re.test(a));
  // the fullest form ("කැලණි ගඟ", not just "කැලණි")
  return names.sort((a, b) => b.length - a.length)[0] ?? null;
}

/** Sinhala "river of" form people type: කැලණි ගඟ -> කැලණි ගඟේ, මහ ඔය -> මහ ඔයේ. */
export const siGenitive = (n: string) => n.replace(/ගඟ$/, "ගඟේ").replace(/ඔය$/, "ඔයේ");

// ---------------------------------------------------------------- dams and reservoirs

/** Extra spellings per catalogue id, on top of the aliases lib/reservoirs.ts already matches in the news and the PDFs. */
const DAM_EXTRA: Record<string, string[]> = {
  kotmale: ["Kothmale", "Kotmale dam"],
  victoria: ["Victoria dam", "Victoria reservoir"],
  rantambe: ["Rantembe"],
  laxapana: ["Laksapana", "Old Laxapana", "New Laxapana"],
  castlereagh: ["Castlereigh"],
  maussakele: ["Moussakele", "Maussakelle"],
  "senanayake-samudraya": ["Senanayake Samudra", "Gal Oya reservoir"],
  lunugamvehera: ["Lunugamwehera"],
  kaluganga: ["Kaluganga dam"],
  "deduru-oya": ["Deduru Oya reservoir"],
  rajangana: ["Rajanganaya", "Rajangana wewa"],
  tabbowa: ["Thabbowa"],
  kalawewa: ["Kalawewa", "Kala Wewa"],
};

const titleCase = (s: string) => s.replace(/\b[a-z]/g, (c) => c.toUpperCase());

/** "Also searched as" spellings for a reservoir page: catalogue aliases plus the extras, minus the page's own name. */
export function reservoirAliases(catalogueId: string | null, name: string): string[] {
  const cat = catalogueId ? RESERVOIRS.find((r) => r.id === catalogueId) : null;
  const own = new Set([name.toLowerCase(), `${name.toLowerCase()} reservoir`]);
  const out: string[] = [];
  for (const a of [...(catalogueId ? DAM_EXTRA[catalogueId] ?? [] : []), ...(cat?.aliases ?? []), ...(cat?.exactAliases ?? [])]) {
    if (!LATIN.test(a)) continue;
    const t = /[A-Z]/.test(a) ? a : titleCase(a);
    const k = t.toLowerCase();
    if (own.has(k) || /hydropower|power station|spill/.test(k)) continue;
    own.add(k);
    out.push(t);
  }
  // Every dam page answers "<name> dam water level" too.
  const dam = `${name} dam`;
  if (!own.has(dam.toLowerCase()) && !/dam$|wewa$|oya$|samudraya$/i.test(name)) out.push(dam);
  return out.slice(0, 5);
}

// ---------------------------------------------------------------- towns

/** Latin spellings of a town (gazetteer aliases), for the "also searched as" line on the town page. */
const TOWN_EXTRA: Record<string, string[]> = { kolonnawa: ["Megoda Kolonnawa"], kelaniya: ["Kelaniya river"] };
export const townAliases = (p: Place): string[] => [...(TOWN_EXTRA[p.slug] ?? []), ...p.aliases.filter((a) => LATIN.test(a) && a.toLowerCase() !== p.name.toLowerCase())].slice(0, 3);

/** Spellings of a gauge name that people type (Search Console and autocomplete, Oct 2026). */
const GAUGE_ALIASES: Record<string, string[]> = {
  Glencourse: ["Glencorse"],
  "Nagalagam Street": ["Nagalam Street", "Mattakkuliya", "Mill Road"],
  Kithulgala: ["Kitulgala"],
  Ratnapura: ["Rathnapura"],
  Thaldena: ["Thaldena Mahaweli"],
};
export const gaugeAliases = (gauge: string): string[] => GAUGE_ALIASES[gauge] ?? [];

/** Gauges people search by name, most searched first (Search Console, Oct 2026): the meta description names these before the rest. */
const GAUGE_PRIORITY = ["Hanwella", "Nagalagam Street", "Glencourse", "Kaduwela", "Ratnapura", "Putupaula", "Panadugama", "Thaldena", "Baddegama", "Peradeniya", "Nawalapitiya", "Manampitiya"];
export const byGaugeDemand = (names: string[]): string[] => {
  const rank = (n: string) => { const i = GAUGE_PRIORITY.indexOf(n); return i < 0 ? 99 : i; };
  return names.map((n, i) => ({ n, i })).sort((a, b) => rank(a.n) - rank(b.n) || a.i - b.i).map((x) => x.n);
};
