// Official warnings: the latest bulletins from the Disaster Management Centre (DMC), which also
// hosts the Irrigation Department's river flood warnings and the Met Department's special
// weather bulletins as PDFs. See DOCS.md ("Official warnings") for what the sources look like.
//
// Pipeline (all server-side, every step fails soft):
//  1. Scrape the DMC report listings (River Water Level and Flood Warning, Weather Reports).
//     Each row has a title, an issue date and a 24h clock time (Colombo time) and a PDF link, so
//     `issuedAt` and "is it current (<24h)" are parsed deterministically, never by the model.
//  2. Skip routine data tables ("Water level & Rainfall") and sea/lightning notices; download the
//     PDFs that are left, extract the text layer (unpdf), and hash it.
//  3. One OpenAI Decisions call per NEW bulletin (cached by content hash): a predicate per river
//     basin ("is it named?") and a choice for severity. One Responses call then writes a single
//     summary sentence, which is rejected if it contains a number that is not in the bulletin.
//
// Nothing here can throw into a page: no key, no network, a bad PDF or a refused answer all just
// reduce the result, and `reason` says why.

import { createHash } from "node:crypto";
import { unstable_cache } from "next/cache";
import { extractText, getDocumentProxy } from "unpdf";
import { fetchStations } from "./arcgis";
import { normaliseBasin } from "./basinOrder";
import { aiConfigured, decide, respondJson, type DecisionInput, type DecisionQuestion } from "./openai";

export type WarningSeverity = "none" | "advisory" | "alert" | "minor flood" | "major flood" | "evacuation";

export type OfficialWarning = {
  source: "DMC" | "Irrigation Department" | "Department of Meteorology";
  /** The bulletin itself (a PDF or image). */
  url: string;
  title: string;
  /** ISO 8601 with the +05:30 offset, parsed from the DMC listing; null if it could not be parsed. */
  issuedAt: string | null;
  /** Issued within the last 24 hours. Deterministic when issuedAt is known. */
  current: boolean;
  /** Basin names as they appear in our dataset (trimmed), e.g. "Kala Oya". */
  basins: string[];
  districts?: string[];
  severity: WarningSeverity;
  /** One sentence from or paraphrasing the bulletin. */
  summary: string;
  /** 0..1, the model's certainty about basins and severity together. */
  confidence: number;
};

export type WarningsResult = { warnings: OfficialWarning[]; reason?: string };

const DMC = "https://www.dmc.gov.lk";
const LISTINGS = [
  { id: 6, name: "River Water Level and Flood Warning" },
  { id: 2, name: "Weather Reports" },
] as const;
const HALF_HOUR = 1800;
const DAY_MS = 24 * 3_600_000;
const MAX_BULLETINS = 6;
const MAX_TEXT_CHARS = 12_000;
const BASIN_PROB = 0.6;
const UA = "Mozilla/5.0 (compatible; sl-water-levels; +https://github.com/shakee93/sl-water-levels)";

const ALL_DISTRICTS = [
  "Ampara", "Anuradhapura", "Badulla", "Batticaloa", "Colombo", "Galle", "Gampaha", "Hambantota", "Jaffna", "Kalutara",
  "Kandy", "Kegalle", "Kilinochchi", "Kurunegala", "Mannar", "Matale", "Matara", "Monaragala", "Mullaitivu",
  "Nuwara Eliya", "Polonnaruwa", "Puttalam", "Ratnapura", "Trincomalee", "Vavuniya",
];

type Row = { title: string; url: string; issuedAt: string | null; listing: string };

// ---------------------------------------------------------------- listing

const SKIP_TITLE = /water\s*level|rainfall|forecast|tamil|sinhala|sea|boat|marine|fish|lightning|wind|drought|situation/i;
const KEEP_TITLE = /flood|warning|special|bulletin|advis|alert|heavy rain|landslide/i;

function parseRows(html: string, listing: string): Row[] {
  const rows: Row[] = [];
  for (const tr of html.match(/<tr[\s\S]*?<\/tr>/g) ?? []) {
    const href = /href="([^"]*\/images\/dmcreports\/[^"]+)"/.exec(tr)?.[1];
    if (!href) continue;
    const text = tr.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
    const date = /(\d{4}-\d{2}-\d{2})\s+(\d{1,2}:\d{2})/.exec(text);
    const title = text.slice(0, date?.index ?? text.length).replace(/\bDownload\b/gi, "").trim();
    let issuedAt: string | null = null;
    if (date) {
      const [h, m] = date[2].split(":");
      const iso = `${date[1]}T${h.padStart(2, "0")}:${m}:00+05:30`;
      if (!Number.isNaN(Date.parse(iso))) issuedAt = iso;
    }
    const url = new URL(href.replace(/&amp;/g, "&"), DMC).href.replace(/ /g, "%20");
    rows.push({ title, url, issuedAt, listing });
  }
  return rows;
}

async function listBulletins(now: number): Promise<{ rows: Row[]; errors: string[] }> {
  const errors: string[] = [];
  const all: Row[] = [];
  await Promise.all(
    LISTINGS.map(async (l) => {
      try {
        const res = await fetch(`${DMC}/index.php?option=com_dmcreports&view=reports&report_type_id=${l.id}&lang=en`, {
          headers: { "User-Agent": UA },
          next: { revalidate: HALF_HOUR },
          signal: AbortSignal.timeout(15_000),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const rows = parseRows(await res.text(), l.name);
        if (rows.length === 0) throw new Error("no rows found (page layout changed?)");
        all.push(...rows);
      } catch (e) {
        errors.push(`${l.name}: ${e instanceof Error ? e.message : "failed"}`);
      }
    }),
  );
  const seen = new Set<string>();
  const rows = all
    .filter((r) => KEEP_TITLE.test(r.title) && !SKIP_TITLE.test(r.title))
    // Only bulletins issued in the last 24h are ever analysed (so older ones cost nothing); rows
    // without a parseable date are kept and settled by the model fallback.
    .filter((r) => r.issuedAt == null || now - Date.parse(r.issuedAt) <= DAY_MS)
    .filter((r) => (seen.has(r.url) ? false : (seen.add(r.url), true)))
    .sort((a, b) => Date.parse(b.issuedAt ?? "0") - Date.parse(a.issuedAt ?? "0"))
    .slice(0, MAX_BULLETINS);
  return { rows, errors };
}

// ---------------------------------------------------------------- extraction

const IMAGE_URL = /\.(png|jpe?g|webp)(\?|$)/i;
type Extracted = { kind: "text"; text: string; hash: string } | { kind: "image"; hash: string } | { kind: "none"; reason: string };

/** PDF bulletins are immutable (the URL carries a timestamp), so extraction is cached by URL. */
const extractCached = unstable_cache(
  async (url: string): Promise<Extracted> => {
    if (IMAGE_URL.test(url)) return { kind: "image", hash: createHash("sha256").update(url).digest("hex").slice(0, 32) };
    const res = await fetch(url, { headers: { "User-Agent": UA }, cache: "no-store", signal: AbortSignal.timeout(25_000) });
    if (!res.ok) throw new Error(`bulletin HTTP ${res.status}`);
    const buf = new Uint8Array(await res.arrayBuffer());
    const pdf = await getDocumentProxy(buf);
    const { text } = await extractText(pdf, { mergePages: true });
    const clean = text.replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n").trim();
    if (clean.length < 80) return { kind: "none", reason: "no text layer (scanned image PDF)" };
    return { kind: "text", text: clean.slice(0, MAX_TEXT_CHARS), hash: createHash("sha256").update(clean).digest("hex").slice(0, 32) };
  },
  ["warnings-extract-v1"],
  { revalidate: 7 * 24 * 3600 },
);

// ---------------------------------------------------------------- analysis (OpenAI)

type Analysis = {
  basins: string[];
  severity: WarningSeverity;
  confidence: number;
  summary: string | null;
  /** Only filled when the date could not be parsed from the listing. */
  recent: boolean | null;
};

const SEVERITY_CHOICES: { value: string; label: WarningSeverity; description: string }[] = [
  { value: "none", label: "none", description: "No warning for land areas or rivers: routine data, sea-only notices, or general weather news." },
  { value: "advisory", label: "advisory", description: "A general advisory or watch: be attentive, heavy rain possible, no river level named as near flooding." },
  { value: "alert", label: "alert", description: "A yellow or amber warning: river levels near flood level, or flooding possible in named areas." },
  { value: "minor_flood", label: "minor flood", description: "Red warning or minor flooding occurring or expected; low-lying areas affected." },
  { value: "major_flood", label: "major flood", description: "Major flooding occurring or expected." },
  { value: "evacuation", label: "evacuation", description: "Residents are told to evacuate." },
];

function basinList(stations: { basin: string }[]): string[] {
  return [...new Set(stations.map((s) => s.basin.trim()).filter(Boolean))].sort();
}

async function analyse(input: DecisionInput, basins: string[], needRecency: string | null): Promise<Analysis | null> {
  const questions: DecisionQuestion[] = [
    ...basins.map((b, i): DecisionQuestion => ({
      type: "predicate",
      name: `basin_${i}`,
      instructions: `Does this bulletin explicitly warn about, or name, the ${b} river or its basin (the name may be in English, Sinhala or Tamil)? Answer no if it only concerns other rivers, the sea, or the whole island in general.`,
    })),
    {
      type: "choice",
      name: "severity",
      instructions: "What is the highest flood or heavy-rain warning level this bulletin gives for rivers or land areas? A warning that only concerns sea areas is none.",
      choices: SEVERITY_CHOICES.map(({ value, description }) => ({ value, description })),
    },
  ];
  if (needRecency) {
    questions.push({ type: "predicate", name: "recent", instructions: `The current time is ${needRecency}. Was this bulletin issued within the previous 24 hours? Answer no if the date is older or cannot be found.` });
  }
  const r = await decide(input, questions);
  if (!r.ok) throw new Error(r.reason);
  const a = r.data;
  const sev = a.get("severity");
  if (!sev || sev.type !== "choice") throw new Error("no severity answer");
  const severity = SEVERITY_CHOICES.find((c) => c.value === sev.choice)?.label ?? "none";
  let confidence = typeof sev.confidence === "number" ? sev.confidence : 0;
  const named: string[] = [];
  basins.forEach((b, i) => {
    const p = a.get(`basin_${i}`);
    if (!p || p.type !== "predicate") {
      confidence = Math.min(confidence, 0.5); // a refusal / missing answer lowers trust
      return;
    }
    if (p.probability >= BASIN_PROB) named.push(b);
    confidence = Math.min(confidence, Math.max(p.probability, 1 - p.probability));
  });
  let recent: boolean | null = null;
  if (needRecency) {
    const p = a.get("recent");
    recent = p && p.type === "predicate" ? p.probability >= 0.5 : null;
  }
  return { basins: named, severity, confidence: Math.round(confidence * 100) / 100, summary: null, recent };
}

const nums = (s: string) => new Set(s.match(/\d+(?:[.,]\d+)*/g)?.map((n) => n.replace(/,/g, "")) ?? []);

async function summarise(title: string, text: string): Promise<string | null> {
  const r = await respondJson<{ summary: string }>({
    instructions:
      "You summarise an official Sri Lankan flood or weather bulletin for a public river-level website. " +
      "Write exactly ONE plain English sentence (max 35 words) that quotes or closely paraphrases what the bulletin says: the hazard, the places or rivers named, and any official advice. " +
      "Use only facts in the bulletin text. Do not add, change or infer numbers, places, times or advice. " +
      "The text may be Sinhala, Tamil, English or partly garbled by PDF extraction; summarise only what is clear. Do not mention the model or the extraction.",
    input: `Title: ${title}\n\n${text.slice(0, 6000)}`,
    schemaName: "bulletin_summary",
    schema: { type: "object", properties: { summary: { type: "string" } }, required: ["summary"], additionalProperties: false },
    maxOutputTokens: 400,
  });
  if (!r.ok) return null;
  const s = r.data.summary?.trim();
  if (!s || s.length > 400) {
    console.warn("[ai] bulletin summary rejected: empty or too long");
    return null;
  }
  // Every number in the summary must come from the bulletin (or its title).
  const allowed = nums(`${text} ${title}`);
  for (const n of nums(s)) {
    if (!allowed.has(n)) {
      console.warn("[ai] bulletin summary rejected: contains a number not in the bulletin");
      return null;
    }
  }
  return s;
}

/** Cached by content hash: a bulletin costs the Decisions call once, however many requests ask. */
const analyseCached = unstable_cache(
  async (hash: string, title: string, text: string, imageUrl: string | null, basins: string[], needRecency: string | null): Promise<Analysis> => {
    void hash; // cache key only (arguments are part of the key)
    const input: DecisionInput = imageUrl
      ? [{ role: "user", content: [{ type: "input_text", text: `Bulletin title: ${title}` }, { type: "input_image", image_url: imageUrl }] }]
      : `Bulletin title: ${title}\n\n${text}`;
    const a = await analyse(input, basins, needRecency);
    if (!a) throw new Error("analysis failed");
    return a;
  },
  ["warnings-analysis-v2"],
  { revalidate: 30 * 24 * 3600 },
);

/** The summary is cached separately and throws on failure, so a rejected summary is retried (after a
 *  short backoff) instead of a placeholder being cached for a month. */
const summaryCached = unstable_cache(
  async (hash: string, title: string, text: string): Promise<string> => {
    void hash;
    const s = await summarise(title, text);
    if (!s) throw new Error("summary unavailable");
    return s;
  },
  ["warnings-summary-v1"],
  { revalidate: 30 * 24 * 3600 },
);

// A failed analysis is not cached by unstable_cache (it threw); remember it briefly so a broken key
// or an outage does not turn every page view into a retry.
const failedUntil = new Map<string, number>();
const BACKOFF_MS = 5 * 60_000;

// ---------------------------------------------------------------- public API

function sourceOf(title: string, text: string): OfficialWarning["source"] {
  if (/irrigation department/i.test(text) || /flood warning/i.test(title)) return "Irrigation Department";
  if (/department of meteorology|natural hazards early warning/i.test(text)) return "Department of Meteorology";
  return "DMC";
}

function districtsIn(text: string): string[] {
  // "Colombo 07" is the Irrigation Department letterhead address, not a district named in the bulletin.
  return ALL_DISTRICTS.filter((d) => new RegExp(`\\b${d}\\b(?!\\s*\\d)`, "i").test(text));
}

function templateSummary(title: string, basins: string[], severity: WarningSeverity): string {
  const where = basins.length ? ` for the ${basins.join(", ")} basin${basins.length > 1 ? "s" : ""}` : "";
  return `${title}${where}${severity !== "none" ? ` (${severity})` : ""}. Open the bulletin for details.`;
}

/**
 * The latest official bulletins from the last 24h that name at least one of our basins or carry a
 * warning level. Never throws; `reason` explains an empty or partial result.
 */
export async function getOfficialWarnings(now = Date.now()): Promise<WarningsResult> {
  try {
    if (!aiConfigured()) return { warnings: [], reason: "OPENAI_API_KEY is not set, so bulletins are not analysed" };
    const [{ rows, errors }, stations] = await Promise.all([listBulletins(now), fetchStations().catch(() => [])]);
    const basins = basinList(stations);
    if (rows.length === 0) return { warnings: [], reason: errors.length ? `bulletin list unavailable (${errors.join("; ")})` : "no relevant bulletins in the last 24 hours" };
    if (basins.length === 0) return { warnings: [], reason: "basin list unavailable" };

    const notes: string[] = [...errors];
    const out = await Promise.all(
      rows.map(async (row): Promise<OfficialWarning | null> => {
        try {
          const ex = await extractCached(row.url);
          if (ex.kind === "none") {
            notes.push(`${row.title}: ${ex.reason}`);
            return null;
          }
          const text = ex.kind === "text" ? ex.text : "";
          const key = `${ex.hash}|${basins.length}`;
          if ((failedUntil.get(key) ?? 0) > now) return null;
          const needRecency = row.issuedAt == null ? new Date(now).toISOString() : null;
          let a: Analysis;
          try {
            a = await analyseCached(ex.hash, row.title, text, ex.kind === "image" ? row.url : null, basins, needRecency);
          } catch (e) {
            failedUntil.set(key, now + BACKOFF_MS);
            notes.push(`${row.title}: analysis failed (${e instanceof Error ? e.message : "error"})`);
            return null;
          }
          if ((a.basins.length > 0 || a.severity !== "none") && ex.kind === "text" && (failedUntil.get(`s|${key}`) ?? 0) <= now) {
            try {
              a.summary = await summaryCached(ex.hash, row.title, text);
            } catch {
              failedUntil.set(`s|${key}`, now + BACKOFF_MS);
            }
          }
          const issuedMs = row.issuedAt ? Date.parse(row.issuedAt) : null;
          const current = issuedMs != null ? now - issuedMs <= DAY_MS && issuedMs - now < 3_600_000 : a.recent === true;
          if (a.basins.length === 0 && a.severity === "none") return null;
          const districts = districtsIn(text);
          return {
            source: sourceOf(row.title, text),
            url: row.url,
            title: row.title,
            issuedAt: row.issuedAt,
            current,
            basins: a.basins,
            ...(districts.length ? { districts } : {}),
            severity: a.severity,
            summary: a.summary ?? templateSummary(row.title, a.basins, a.severity),
            confidence: a.confidence,
          };
        } catch (e) {
          notes.push(`${row.title}: ${e instanceof Error ? e.message : "failed"}`);
          return null;
        }
      }),
    );
    const warnings = out.filter((w): w is OfficialWarning => w != null && w.current);
    return { warnings, ...(warnings.length === 0 && notes.length ? { reason: notes.join("; ") } : {}) };
  } catch (e) {
    return { warnings: [], reason: e instanceof Error ? e.message : "unexpected error" };
  }
}

/** Current warnings that name this basin (matched on the trimmed name). */
export function warningsForBasin(result: WarningsResult, basin: string): OfficialWarning[] {
  const key = normaliseBasin(basin);
  return result.warnings.filter((w) => w.basins.some((b) => normaliseBasin(b) === key));
}
