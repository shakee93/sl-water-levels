// Locale routing. English keeps the existing URLs (/, /kelani-ganga, /help ...); Sinhala is /si/...
// and Tamil /ta/.... The pages live under app/[lang]/, so an unprefixed request is rewritten
// (internally) to /en/<path>. Every page stays statically generated / ISR: this runs before the
// cache and never makes a route dynamic.
//
// - /en/... is not a public URL: it redirects to the unprefixed one (image routes excepted,
//   because Next emits their /en/... URLs in the OG meta tags).
// - A returning visitor whose "sl_lang" cookie says si/ta is redirected from an English URL to
//   the same page in their language (temporary redirect; never based on Accept-Language).
// - Old /history?scope=... links are sent to a tiny route handler that 308s to the clean URL.
import { NextResponse, type NextRequest } from "next/server";
import { LANG_KEY, isLocale, localePath, type Locale } from "@/lib/i18n/config";
import { PLACES } from "@/lib/places";
import type { SlugList } from "@/app/api/slugs/route";

const IMAGE = /\/(opengraph|twitter)-image(-[\w]+)?$/;

// ---- Unknown addresses get a real HTTP 404 ------------------------------------------------------------------------
// The river / gauge / town / reservoir / history pages stream (loading.tsx sends the shell with status 200 before the
// page looks anything up), so a notFound() thrown inside them gives the right body with the wrong status: a soft 404.
// So the slug is checked here, before any rendering, against /api/slugs (built from the same cached sources the pages
// use; towns are static). The list is kept in memory; a miss refetches it (at most once a minute),
// so a brand-new gauge or reservoir works within a minute. If the list can't be read the page decides, as before.
const SLUG_RECHECK_MS = 60_000;
const SLUG_MAX_AGE_MS = 600_000;
type Slugs = { at: number; rivers: Set<string>; gauges: Set<string>; single: Map<string, string>; reservoirs: Set<string>; historyRivers: Set<string>; historyGauges: Set<string> };
let slugs: Slugs | null = null;
let lastAttempt = 0;
let slugsPending: Promise<Slugs | null> | null = null;

async function loadSlugs(origin: string): Promise<Slugs | null> {
  slugsPending ??= (async () => {
    try {
      const res = await fetch(`${origin}/api/slugs`, { signal: AbortSignal.timeout(4000) });
      if (!res.ok) return null;
      const j = (await res.json()) as SlugList;
      // a source that was down gives an empty list: don't judge by it
      if (!j.rivers.length || !j.reservoirs.length || !j.historyRivers.length) return null;
      return { at: Date.now(), rivers: new Set(j.rivers), gauges: new Set(j.gauges), single: new Map(Object.entries(j.single ?? {})), reservoirs: new Set(j.reservoirs), historyRivers: new Set(j.historyRivers), historyGauges: new Set(j.historyGauges) };
    } catch {
      return null;
    } finally {
      setTimeout(() => (slugsPending = null), 0);
    }
  })();
  const fresh = await slugsPending;
  if (fresh) slugs = fresh;
  return slugs; // last good list if this fetch failed
}

// Top-level pages with exactly one address (plus the few sub-pages listed), and the rest of the site's shape.
const SINGLE = new Set(["about", "help", "status", "forecast-accuracy", "data", "rain", "rivers", "flood-map", "flood-survey", "colombo-canals", "news", "research", "flood", "reservoirs", "history", "embed"]);
const SUBPAGES = new Set(["research/wellampitiya-street-flooding", "reservoirs/spilling"]);
const TOWNS = new Set(PLACES.map((p) => p.slug));

// Old or guessed addresses -> where they belong (permanent redirect, only when the target exists).
function aliasOf(segs: string[]): string | null {
  const [head, ...rest] = segs;
  const to = (base: string[]) => "/" + [...base, ...rest].join("/");
  switch (head) {
    case "basins": case "basin": case "river":
      return rest.length ? to([]) : "/rivers";
    case "rivers":
      return rest.length ? to([]) : null; // /rivers itself is a real page
    case "flood-estimates": case "flood-estimate": case "towns": case "town":
      return to(["flood"]);
    case "dams": case "dam": case "reservoir":
      return to(["reservoirs"]);
    // Two spellings of one town: the Irrigation Dept's gauge URL is /kalu-ganga/rathnapura (kept), the town page is /flood/ratnapura (kept).
    // Only the other spelling is redirected; nothing is renamed. The target is still checked, so a missing page stays a 404.
    case "kalu-ganga":
      return rest.length === 1 && rest[0] === "ratnapura" ? "/kalu-ganga/rathnapura" : null;
    case "flood":
      return rest.length === 1 && rest[0] === "rathnapura" ? "/flood/ratnapura" : null;
    default:
      return null;
  }
}

type Verdict = "ok" | "missing" | "unknown";
// "ok": exists; "missing": does not; "unknown": can't tell (list unavailable), let the page decide.
function judge(segs: string[], s: Slugs | null): Verdict {
  if (segs.length === 0) return "ok";
  const [a, b, c] = segs;
  if (a === "lab") return "ok"; // experiments, not part of the slug lists
  if (a === "history") {
    if (segs.length === 1) return "ok";
    if (b === "go") return segs.length === 3 ? "ok" : "missing"; // /history/go/<scope> route handler
    if (!s) return "unknown";
    if (segs.length === 2) return s.historyRivers.has(b) ? "ok" : "missing";
    if (segs.length === 3) return s.historyGauges.has(`${b}/${c}`) ? "ok" : "missing";
    return "missing";
  }
  if (a === "flood") {
    if (segs.length === 1) return "ok";
    return segs.length === 2 && TOWNS.has(b) ? "ok" : "missing";
  }
  if (a === "reservoirs") {
    if (segs.length === 1) return "ok";
    if (segs.length > 2) return "missing";
    if (SUBPAGES.has(`${a}/${b}`)) return "ok";
    return s ? (s.reservoirs.has(b) ? "ok" : "missing") : "unknown";
  }
  if (SINGLE.has(a)) return segs.length === 1 || SUBPAGES.has(segs.join("/")) ? "ok" : "missing";
  // anything else is /<river> or /<river>/<gauge>
  if (!s) return "unknown";
  if (segs.length === 1) return s.rivers.has(a) ? "ok" : "missing";
  if (segs.length === 2) return s.gauges.has(`${a}/${b}`) ? "ok" : "missing";
  return "missing";
}

async function verdictFor(segs: string[], origin: string): Promise<Verdict> {
  const first = judge(segs, slugs);
  const now = Date.now();
  if (first === "ok") {
    // The held list also decides the one-gauge redirect, and a hit never refreshes it: re-read it in the background every
    // 10 minutes so a river that gains (or loses) a gauge is noticed. Nothing waits for this.
    if (slugs && now - slugs.at > SLUG_MAX_AGE_MS && now - lastAttempt >= SLUG_RECHECK_MS) {
      lastAttempt = now;
      void loadSlugs(origin);
    }
    return first;
  }
  // Not in the list we hold (or no list yet): refresh it, at most once a minute, before saying no / giving up.
  if (now - lastAttempt < SLUG_RECHECK_MS) return first;
  lastAttempt = now;
  return judge(segs, await loadSlugs(origin));
}

/** The gauge a one-segment /<river> path belongs to when that river has exactly one gauge (its page has nothing to list). */
function onlyGauge(segs: string[]): string | null {
  if (segs.length !== 1) return null;
  const [a] = segs;
  if (SINGLE.has(a) || a === "lab") return null; // site pages, not rivers
  const g = slugs?.single.get(a);
  return g ? `/${a}/${g}` : null;
}

const lowerKeepingEscapes = (p: string) => p.replace(/%[0-9A-Fa-f]{2}|[A-Z]+/g, (x) => (x[0] === "%" ? x : x.toLowerCase()));

export async function proxy(req: NextRequest) {
  const url = req.nextUrl;
  const m = /^\/(en|si|ta)(\/.*)?$/i.exec(url.pathname);
  let lang: Locale = "en";
  let path = url.pathname;

  // Unknown address -> 404 with the not-found page, never a 200; uppercase of a real address -> its lowercase form;
  // old / guessed names -> the real page. All decided on the whole path first, so there is one hop at most.
  {
    if (m) lang = m[1].toLowerCase() as Locale;
    const lowered = lowerKeepingEscapes(m ? (m[2] ?? "/") : path);
    const hadUpper = lowered !== (m ? (m[2] ?? "/") : path) || (!!m && m[1] !== m[1].toLowerCase());
    const isImage = IMAGE.test(lowered);
    const pageSegs = (isImage ? lowered.replace(IMAGE, "") : lowered).split("/").filter(Boolean);
    const alias = isImage ? null : aliasOf(pageSegs);
    const target = alias ? alias.split("/").filter(Boolean) : pageSegs;
    const v = await verdictFor(target, url.origin);
    if (v === "missing") {
      const to = url.clone();
      // The status override is what makes this a real 404: the page below streams (loading.tsx), so its own notFound()
      // would leave the status at 200. On Vercel the 404 body is then the static app/global-not-found.tsx.
      to.pathname = `/${lang}/page-not-found`;
      return NextResponse.rewrite(to, { status: 404 });
    }
    // A river with one gauge: a real 308 to its gauge page. The river page used to answer 200 and redirect in JavaScript
    // (permanentRedirect inside a streamed page), so Google indexed both addresses. The page keeps that redirect as a fallback.
    const only = isImage || v !== "ok" ? null : onlyGauge(target);
    if (only || alias || hadUpper) {
      const to = url.clone();
      const dest = only ?? alias ?? lowered;
      to.pathname = localePath(lang, dest === "" ? "/" : dest);
      return NextResponse.redirect(to, 308); // query string is kept by clone()
    }
  }

  if (m) {
    lang = m[1] as Locale;
    path = m[2] ?? "/";
    if (lang === "en") {
      if (IMAGE.test(path)) return NextResponse.next();
      const to = url.clone();
      to.pathname = path;
      return NextResponse.redirect(to, 308);
    }
  } else {
    const saved = req.cookies.get(LANG_KEY)?.value;
    if (isLocale(saved) && saved !== "en" && !IMAGE.test(path)) {
      const to = url.clone();
      to.pathname = localePath(saved, path);
      return NextResponse.redirect(to, 307);
    }
  }

  const scope = path === "/history" ? url.searchParams.get("scope") : null;
  if (scope) {
    const to = url.clone();
    to.pathname = `/${lang}/history/go/${encodeURIComponent(scope)}`;
    to.search = "";
    return NextResponse.rewrite(to);
  }

  if (m) return NextResponse.next();
  const to = url.clone();
  to.pathname = `/en${path === "/" ? "" : path}`;
  return NextResponse.rewrite(to);
}

export const config = {
  matcher: ["/((?!api(?:/|$)|mcp(?:/|$)|embed/(?:card|river|gauge|forecast|town|now|reservoirs|ticker)(?:/|$)|_next|.*\\..*).*)"],
};
