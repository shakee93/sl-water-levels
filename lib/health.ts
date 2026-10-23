// Data-source health checks. One place that knows what "working" means for every source the site
// depends on, used by /api/health (the monitor reads it every 30 minutes) and the public /status
// page. Never throws: a failing source becomes a failing check, never a failed request.
//
// Two modes:
//  - normal (status page, casual hits): reuses the cached fetchers, so it costs nothing extra.
//  - deep (?deep=1, only the monitor): bypasses the caches for ArcGIS, the reservoir sheet, the
//    PDF, the bulletin list, the feeds and Open-Meteo, so a stale cache can't hide a dead source.
//    The OpenAI key check (a free GET /v1/models) stays cached for a day and the GitHub API checks
//    for 10 minutes (60 unauthenticated requests/hour).

import { unstable_cache } from "next/cache";
import { getNational } from "./arcgis";
import { sanitizeLevel } from "./readings";
import { getReleaseSources, parseSheetTab, type SheetRow } from "./releases";
import { aiConfigured } from "./openai";
import { WEEKLY_PDF, getWeeklyOutcome } from "./wmsWeekly";

export type Severity = "critical" | "warn";

export type HealthCheck = {
  id: string;
  name: string;
  ok: boolean;
  severity: Severity;
  detail: string;
  /** What visitors see while this is failing (plain words, used in alerts and on /status). */
  userImpact: string;
  /** When the source last produced good data, ISO. */
  lastGoodAt?: string;
  /** Age of that data in minutes. */
  ageMinutes?: number;
};

export type HealthReport = {
  ok: boolean;
  checkedAt: string;
  deep: boolean;
  checks: HealthCheck[];
};

const HOUR = 3_600_000;
const MIN = 60_000;
const COLOMBO_MS = 5.5 * HOUR;
const UA = "Mozilla/5.0 (compatible; sl-water-levels-health; +https://github.com/shakee93/sl-water-levels)";
const REPO = "shakee93/sl-water-levels";
const SHEET_ID = "2PACX-1vTcSGhi9RESl7CMCl1TQnrKe07Gx5Q696YiSB9jneIHqIP9lifpqSErgI3D5k9KtQXSdW5JpycIIr5e";
const SHEET_TABS = [
  { gid: 1212294664, tab: "Major" as const },
  { gid: 562386515, tab: "Medium" as const },
];
const WMS_PDF = "https://mahaweli.gov.lk/WMS%20DATA/Menue-WMS%20-%20E.pdf";
const DMC_LIST = "https://www.dmc.gov.lk/index.php?option=com_dmcreports&view=reports&report_type_id=6&lang=en";
const FEEDS = [
  { name: "Ada Derana", url: "https://adaderana.lk/rss.php" },
  { name: "Daily Mirror", url: "https://www.dailymirror.lk/rss/breaking-news/108" },
];

const colomboDay = (ms: number) => new Date(ms + COLOMBO_MS).toISOString().slice(0, 10);
const colomboHour = (ms: number) => new Date(ms + COLOMBO_MS).getUTCHours();
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 200);
const mins = (ms: number) => Math.max(0, Math.round(ms / MIN));
export function words(m: number): string {
  if (m < 90) return `${m} min`;
  if (m < 48 * 60) return `${Math.round(m / 6) / 10} h`;
  return `${Math.round(m / 144) / 10} days`;
}

function fetchOpts(deep: boolean, revalidate: number, timeout = 15_000): RequestInit & { next?: { revalidate: number } } {
  return {
    headers: { "User-Agent": UA },
    signal: AbortSignal.timeout(timeout),
    ...(deep ? { cache: "no-store" as const } : { next: { revalidate } }),
  };
}

type Partial_ = Omit<HealthCheck, "id" | "name" | "severity" | "userImpact">;
async function run(
  id: string,
  name: string,
  userImpact: string,
  fn: () => Promise<Partial_ & { severity?: Severity }>,
  baseSeverity: Severity = "warn",
): Promise<HealthCheck> {
  try {
    const r = await fn();
    return { id, name, userImpact, ...r, severity: r.severity ?? baseSeverity };
  } catch (e) {
    return { id, name, userImpact, ok: false, severity: baseSeverity, detail: errText(e) };
  }
}

const fresh = (ms: number | null | undefined) => (ms == null ? {} : { lastGoodAt: new Date(ms).toISOString(), ageMinutes: mins(Date.now() - ms) });

// ---------------------------------------------------------------- gauges

type GaugeSample = { total: number; freshCount: number; newestMs: number | null };

async function gaugesNormal(): Promise<GaugeSample> {
  const all = await getNational();
  const withData = all.filter((s) => s.latest);
  return {
    total: all.length,
    freshCount: withData.filter((s) => (s.ageMin ?? Infinity) < 180).length,
    newestMs: withData.reduce<number | null>((m, s) => (m == null || s.latest!.ts > m ? s.latest!.ts : m), null),
  };
}

// Straight to ArcGIS, no cache layer: every response is validated like lib/arcgis.ts does, but
// nothing here is ever stored.
async function arcgisDirect(path: string, params: Record<string, string>): Promise<{ features?: { attributes: Record<string, unknown> }[]; count?: number }> {
  const url = new URL(`https://services3.arcgis.com/J7ZFXmR8rSmQ3FGf/arcgis/rest/services/${path}`);
  url.searchParams.set("f", "json");
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url, { headers: { "User-Agent": UA }, cache: "no-store", signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`ArcGIS HTTP ${res.status}`);
  const j = (await res.json()) as { error?: { code?: number; message?: string }; features?: { attributes: Record<string, unknown> }[]; count?: number };
  if (j.error) throw new Error(`ArcGIS error ${j.error.code ?? ""}: ${j.error.message ?? "unknown"}`.trim());
  return j;
}

async function gaugesDeep(): Promise<GaugeSample> {
  const total = (await arcgisDirect("hydrostations/FeatureServer/0/query", { where: "1=1", returnCountOnly: "true" })).count ?? 0;
  const since = new Date(Date.now() - 3 * HOUR).toISOString().slice(0, 19).replace("T", " ");
  const recent = await arcgisDirect("gauges_2_view/FeatureServer/0/query", {
    where: `CreationDate >= TIMESTAMP '${since}'`,
    outFields: "gauge,CreationDate,water_level",
    orderByFields: "CreationDate DESC, objectid DESC",
    returnGeometry: "false",
    resultRecordCount: "1000",
  });
  const seen = new Set<string>();
  let newestMs: number | null = null;
  for (const f of recent.features ?? []) {
    const lvl = sanitizeLevel(f.attributes.water_level as number | null);
    const ts = Number(f.attributes.CreationDate);
    if (lvl == null || !Number.isFinite(ts)) continue;
    seen.add(String(f.attributes.gauge ?? "").replace(/\s+/g, " ").trim());
    if (newestMs == null || ts > newestMs) newestMs = ts;
  }
  seen.delete("");
  if (newestMs == null) {
    // Nothing in 3 h: find out how stale, for the message.
    const last = await arcgisDirect("gauges_2_view/FeatureServer/0/query", {
      where: "1=1",
      outFields: "CreationDate",
      orderByFields: "CreationDate DESC, objectid DESC",
      returnGeometry: "false",
      resultRecordCount: "1",
    });
    const ts = Number(last.features?.[0]?.attributes.CreationDate);
    newestMs = Number.isFinite(ts) ? ts : null;
  }
  return { total, freshCount: seen.size, newestMs };
}

async function checkGauges(deep: boolean): Promise<HealthCheck> {
  return run(
    "gauges",
    "River gauges (Irrigation Department ArcGIS)",
    "Water levels show 'Data delayed' with the last reading time; verdicts and forecasts pause for stale gauges.",
    async () => {
      const s = deep ? await gaugesDeep() : await gaugesNormal();
      const newestAge = s.newestMs == null ? null : Date.now() - s.newestMs;
      const problems: string[] = [];
      if (s.freshCount < 35) problems.push(`only ${s.freshCount} of ${s.total} stations have a reading under 3 h old (need 35)`);
      if (newestAge == null || newestAge > 2 * HOUR) problems.push(newestAge == null ? "no readings at all" : `newest reading is ${words(mins(newestAge))} old (limit 2 h)`);
      return {
        ok: problems.length === 0,
        detail: problems.length ? problems.join("; ") : `${s.freshCount} of ${s.total} stations reporting; newest reading ${words(mins(newestAge ?? 0))} ago`,
        ...fresh(s.newestMs),
      };
    },
    "critical",
  ).then((c) => (c.ok || c.lastGoodAt ? c : { ...c, detail: `ArcGIS unreachable or invalid: ${c.detail}` }));
}

// ---------------------------------------------------------------- reservoir sheet

async function checkSheet(deep: boolean): Promise<HealthCheck> {
  return run(
    "sheet",
    "Irrigation reservoir sheet",
    "Reservoir release cards from the Irrigation Department are hidden; releases found only in bulletins or the news still show.",
    async () => {
      let rows: SheetRow[] = [];
      let fetchedAt = Date.now();
      let layoutBroken = false;
      let failure: string | null = null;
      if (deep) {
        const parts = await Promise.allSettled(
          SHEET_TABS.map(async ({ gid, tab }) => {
            const res = await fetch(`https://docs.google.com/spreadsheets/d/e/${SHEET_ID}/pub?gid=${gid}&single=true&output=csv`, fetchOpts(true, 0, 20_000));
            if (!res.ok) throw new Error(`${tab} tab HTTP ${res.status}`);
            return parseSheetTab(await res.text(), tab).rows;
          }),
        );
        for (const p of parts) {
          if (p.status === "fulfilled") rows.push(...p.value);
          else {
            failure = errText(p.reason);
            if (/layout|columns|header/i.test(failure)) layoutBroken = true;
          }
        }
      } else {
        const s = (await getReleaseSources()).sheet;
        if (s.ok) {
          rows = s.data.rows;
          fetchedAt = s.data.fetchedAt;
        } else {
          failure = s.error;
          layoutBroken = /layout|columns|header/i.test(s.error);
        }
      }
      const days = rows.map((r) => r.day).filter((d): d is string => !!d).sort();
      const newest = days[days.length - 1] ?? null;
      const now = Date.now();
      const problems: string[] = [];
      if (failure) problems.push(layoutBroken ? `${failure} (columns changed?)` : failure);
      if (rows.length < 100) problems.push(`${rows.length} rows parsed (need 100)`);
      if (rows.length > 0 && (!newest || (newest !== colomboDay(now) && newest !== colomboDay(now - 24 * HOUR)))) problems.push(`newest row is dated ${newest ?? "none"}, not today or yesterday`);
      const broken = rows.length === 0 || layoutBroken;
      const lastMs = newest ? Date.parse(`${newest}T12:00:00+05:30`) : null;
      return {
        ok: problems.length === 0,
        severity: broken ? "critical" : "warn",
        detail: problems.length ? problems.join("; ") : `${rows.length} reservoirs parsed; newest row ${newest}`,
        ...(lastMs ? fresh(Math.min(lastMs, fetchedAt)) : {}),
      };
    },
  );
}

// ---------------------------------------------------------------- Mahaweli PDF

async function checkWms(deep: boolean): Promise<HealthCheck> {
  return run(
    "wms",
    "Mahaweli reservoir report (PDF)",
    "Mahaweli dam discharges (Kotmale, Victoria, Randenigala...) are missing from the release cards.",
    async () => {
      const head = await fetch(WMS_PDF, { ...fetchOpts(deep, 600, 25_000), method: "HEAD" });
      if (!head.ok) return { ok: false, detail: `PDF unreachable (HTTP ${head.status})` };
      const lm = head.headers.get("last-modified");
      const lmMs = lm ? Date.parse(lm) : NaN;
      const w = (await getReleaseSources()).wms; // parsing a PDF is heavy: always the cached parse
      const problems: string[] = [];
      if (!w.ok) problems.push(`PDF could not be parsed: ${w.error}`);
      else if (w.data.rows.length < 30) problems.push(`${w.data.rows.length} rows parsed (need 30)`);
      if (Number.isFinite(lmMs) && Date.now() - lmMs > 48 * HOUR) problems.push(`report last modified ${words(mins(Date.now() - lmMs))} ago (limit 48 h)`);
      return {
        ok: problems.length === 0,
        detail: problems.length ? problems.join("; ") : `${w.ok ? w.data.rows.length : 0} reservoirs parsed${Number.isFinite(lmMs) ? `; report ${words(mins(Date.now() - lmMs))} old` : ""}`,
        ...(Number.isFinite(lmMs) ? fresh(lmMs) : {}),
      };
    },
  );
}

// ---------------------------------------------------------------- Mahaweli weekly meeting PDF

async function checkWmsWeekly(deep: boolean): Promise<HealthCheck> {
  return run(
    "wms-weekly",
    "Mahaweli weekly meeting (PDF)",
    "The 'spill possible' chips on reservoir pages are missing or out of date.",
    async () => {
      const head = await fetch(WEEKLY_PDF, { ...fetchOpts(deep, 3600, 25_000), method: "HEAD" });
      if (!head.ok) return { ok: false, detail: `PDF unreachable (HTTP ${head.status})` };
      const lm = head.headers.get("last-modified");
      const lmMs = lm ? Date.parse(lm) : NaN;
      const w = await getWeeklyOutcome(); // cached parse
      const problems: string[] = [];
      if (!w.ok) problems.push(`PDF could not be parsed: ${w.error}`);
      else if (w.data.items.length < 5) problems.push(`${w.data.items.length} reservoirs parsed (need 5)`);
      // The meeting is weekly: only a file untouched for 10 days is worth a warning.
      if (Number.isFinite(lmMs) && Date.now() - lmMs > 10 * 24 * HOUR) problems.push(`file last modified ${words(mins(Date.now() - lmMs))} ago (limit 10 days)`);
      const spills = w.ok ? w.data.items.filter((i) => i.spillWindow).length : 0;
      return {
        ok: problems.length === 0,
        detail: problems.length ? problems.join("; ") : `${w.ok ? w.data.items.length : 0} reservoirs parsed, ${spills} with a spill window; meeting ${w.ok ? (w.data.meetingDate ?? "date unknown") : ""}`,
        ...(Number.isFinite(lmMs) ? fresh(lmMs) : {}),
      };
    },
  );
}

// ---------------------------------------------------------------- DMC

async function checkDmc(deep: boolean): Promise<HealthCheck> {
  return run(
    "dmc",
    "DMC warnings list",
    "Official Disaster Management Centre warnings do not appear on the site.",
    async () => {
      const res = await fetch(DMC_LIST, fetchOpts(deep, 600, 20_000));
      if (!res.ok) return { ok: false, detail: `DMC site HTTP ${res.status}` };
      const html = await res.text();
      const links = (html.match(/\/images\/dmcreports\/[^"']+/g) ?? []).length;
      if (links === 0) return { ok: false, detail: "page loads but no bulletin links found (page layout changed?)" };
      return { ok: true, detail: `${links} bulletin links found` };
    },
  );
}

const openaiPing = unstable_cache(
  async (): Promise<number> => {
    const res = await fetch("https://api.openai.com/v1/models", {
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY ?? ""}` },
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`OpenAI HTTP ${res.status}${res.status === 401 ? " (key rejected)" : res.status === 429 ? " (quota or rate limit)" : ""}`);
    return Date.now();
  },
  ["health-openai-v1"],
  { revalidate: 86_400 },
);

async function checkOpenAi(): Promise<HealthCheck> {
  return run(
    "openai",
    "OpenAI (bulletin reading)",
    "New official bulletins and plain-language advisories are not analysed; older results keep showing.",
    async () => {
      if (!aiConfigured()) return { ok: false, detail: "OPENAI_API_KEY is not set" };
      const at = await openaiPing(); // once a day; a failure is not cached, so it is retried
      return { ok: true, detail: "key accepted (checked daily)", ...fresh(at) };
    },
  );
}

// ---------------------------------------------------------------- Open-Meteo

const OM = {
  rain: "https://api.open-meteo.com/v1/forecast?latitude=7.0&longitude=80.0&hourly=precipitation&forecast_days=1&timezone=UTC",
  ens: "https://ensemble-api.open-meteo.com/v1/ensemble?latitude=7.0&longitude=80.0&hourly=precipitation&models=ecmwf_ifs025&forecast_days=1&timezone=UTC",
  glofas: "https://flood-api.open-meteo.com/v1/flood?latitude=7.0&longitude=80.0&daily=river_discharge&forecast_days=3",
};

async function checkWeather(deep: boolean): Promise<HealthCheck[]> {
  const one = (id: string, name: string, url: string, key: "hourly" | "daily", impact: string) =>
    run(id, name, impact, async () => {
      const res = await fetch(url, fetchOpts(deep, 600));
      if (!res.ok) return { ok: false, detail: `HTTP ${res.status}` };
      const j = (await res.json()) as Record<string, Record<string, unknown[]> | undefined>;
      const cols = j[key];
      const n = cols?.time?.length ?? 0;
      if (n === 0) return { ok: false, detail: "response had no time series (format changed?)" };
      const vals = Object.entries(cols ?? {}).filter(([k]) => k !== "time").flatMap(([, v]) => v as (number | null)[]);
      if (!vals.some((v) => typeof v === "number")) return { ok: false, detail: "response had no numeric values" };
      return { ok: true, detail: `${n} time steps returned` };
    });
  return Promise.all([
    one("rain", "Open-Meteo rain forecast", OM.rain, "hourly", "Forecasts fall back to river levels only (no rain-driven outlook)."),
    one("ensemble", "Open-Meteo ensemble", OM.ens, "hourly", "Forecast ranges (best and worst case rain) are not shown."),
    one("glofas", "GloFAS river outlook", OM.glofas, "daily", "The 7-day river outlook is hidden."),
  ]);
}

// ---------------------------------------------------------------- news feeds

async function checkFeeds(deep: boolean): Promise<HealthCheck[]> {
  return Promise.all(
    FEEDS.map((f) =>
      run(`feed-${f.name.toLowerCase().replace(/\s+/g, "-")}`, `News feed: ${f.name}`, "Gate-opening news reports from this outlet are not picked up (official figures still show).", async () => {
        const res = await fetch(f.url, fetchOpts(deep, 600));
        if (!res.ok) return { ok: false, detail: `HTTP ${res.status}` };
        const items = (await res.text()).match(/<item[\s>]/g)?.length ?? 0;
        return items > 0 ? { ok: true, detail: `${items} stories in feed` } : { ok: false, detail: "feed loads but has no stories (format changed?)" };
      }),
    ),
  );
}

// ---------------------------------------------------------------- our own pipelines (GitHub)

type GhRun = { status: string; conclusion: string | null; updated_at: string; html_url: string };
type GhResult = { ok: true; runs: GhRun[] } | { ok: false; why: string };

async function ghGet(path: string): Promise<{ ok: true; json: unknown } | { ok: false; why: string }> {
  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}/${path}`, {
      headers: { "User-Agent": UA, Accept: "application/vnd.github+json" },
      next: { revalidate: 600 },
      signal: AbortSignal.timeout(15_000),
    });
    if (res.status === 403 || res.status === 429) return { ok: false, why: "GitHub API rate limit reached" };
    if (!res.ok) return { ok: false, why: `GitHub API HTTP ${res.status}` };
    return { ok: true, json: await res.json() };
  } catch (e) {
    return { ok: false, why: errText(e) };
  }
}

async function ghRuns(file: string): Promise<GhResult> {
  const r = await ghGet(`actions/workflows/${file}/runs?per_page=10`);
  if (!r.ok) return r;
  const runs = ((r.json as { workflow_runs?: GhRun[] }).workflow_runs ?? []).filter((x) => x.status === "completed");
  return { ok: true, runs };
}

/** "Not checked" must never page the owner: an unreachable GitHub API is reported as OK with a note. */
const unchecked = (why: string): Partial_ => ({ ok: true, detail: `not checked (${why})` });

async function checkWorkflow(
  id: string,
  name: string,
  file: string,
  impact: string,
  maxAgeMs: (now: number) => number | null,
): Promise<HealthCheck> {
  return run(id, name, impact, async () => {
    const r = await ghRuns(file);
    if (!r.ok) return unchecked(r.why);
    const lastDone = r.runs[0];
    const lastOk = r.runs.find((x) => x.conclusion === "success");
    const now = Date.now();
    const limit = maxAgeMs(now);
    const problems: string[] = [];
    if (lastDone && lastDone.conclusion === "failure") problems.push(`last run failed (${lastDone.html_url})`);
    const okMs = lastOk ? Date.parse(lastOk.updated_at) : null;
    if (limit != null) {
      if (okMs == null) problems.push("no successful run in the last 10 runs");
      else if (now - okMs > limit) problems.push(`last success ${words(mins(now - okMs))} ago (limit ${words(mins(limit))})`);
    }
    return {
      ok: problems.length === 0,
      detail: problems.length ? problems.join("; ") : okMs ? `last success ${words(mins(now - okMs))} ago` : "no runs yet",
      ...fresh(okMs),
    };
  });
}

async function checkGaugeArchive(): Promise<HealthCheck> {
  return run("pipe-gauge-archive", "Gauge archive (data branch)", "Nothing visible right away; the /history page and forecast tuning stop getting new data.", async () => {
    const [commits, runs] = await Promise.all([ghGet("commits?sha=data&path=2026&per_page=1"), ghRuns("snapshot.yml")]);
    if (!commits.ok) return unchecked(commits.why);
    const c = (commits.json as { commit?: { committer?: { date?: string } } }[])[0];
    const ms = c?.commit?.committer?.date ? Date.parse(c.commit.committer.date) : NaN;
    const now = Date.now();
    const problems: string[] = [];
    if (!Number.isFinite(ms)) problems.push("no commits found on the data branch");
    else if (now - ms > 14 * HOUR) problems.push(`newest gauge-archive commit is ${words(mins(now - ms))} old (limit 14 h)`);
    if (runs.ok && runs.runs[0]?.conclusion === "failure") problems.push(`last run failed (${runs.runs[0].html_url})`);
    return {
      ok: problems.length === 0,
      detail: problems.length ? problems.join("; ") : `newest archive commit ${words(mins(now - ms))} ago`,
      ...(Number.isFinite(ms) ? fresh(ms) : {}),
    };
  });
}

async function checkPipelines(): Promise<HealthCheck[]> {
  return Promise.all([
    checkGaugeArchive(),
    checkWorkflow("pipe-releases", "Release snapshots (data branch)", "releases-snapshot.yml", "Nothing visible right away; release history and arrival-time learning stop.", (now) => {
      const h = colomboHour(now);
      return (h >= 6 && h < 23 ? 2 : 3) * HOUR; // runs every 15 min by day, hourly overnight
    }),
    checkWorkflow("pipe-forecasts", "Hourly forecast store (Cloudflare D1)", "store-forecasts.yml", "Nothing visible; forecast accuracy checking has gaps.", () => 2 * HOUR),
    checkWorkflow("pipe-export", "Monthly prediction export", "export-predictions.yml", "Nothing visible; the monthly accuracy review has no new export.", () => null),
  ]);
}

// ---------------------------------------------------------------- entry point

export async function runHealthChecks(deep = false): Promise<HealthReport> {
  const [gauges, sheet, wms, wmsWeekly, dmc, openai, weather, feeds, pipes] = await Promise.all([
    checkGauges(deep),
    checkSheet(deep),
    checkWms(deep),
    checkWmsWeekly(deep),
    checkDmc(deep),
    checkOpenAi(),
    checkWeather(deep),
    checkFeeds(deep),
    checkPipelines(),
  ]);
  const checks = [gauges, sheet, wms, wmsWeekly, dmc, openai, ...weather, ...feeds, ...pipes];
  return { ok: checks.every((c) => c.ok), checkedAt: new Date().toISOString(), deep, checks };
}

