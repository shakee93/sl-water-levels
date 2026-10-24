"use client";

// The /flood index: search + filters over the full list. Every town is rendered by the server in the default
// view (so all links are in the HTML for crawlers and nothing shifts on hydration); filtering only changes
// what this component shows afterwards. Nothing is remembered: no storage, no URL, no cookie. Location is
// asked only on a tap, kept in memory and never sent anywhere.
import { useMemo, useState } from "react";
import Link from "next/link";
import { ChevronDown, LocateFixed, Loader2, Search, Waves, X } from "lucide-react";
import { PLACES, RIVERS, type Place } from "@/lib/places";
import { fold, scoreOne } from "@/lib/fuzzy";
import { distanceKm, formatKm } from "@/lib/nearby";
import { stationDisplayName } from "@/lib/displayName";
import { TONES, type Tone } from "@/lib/townRisk";
import { ttFor, type TKey } from "@/lib/i18n/town";
import { riverName } from "@/lib/i18n/format";
import { TIER_DOT, TIER_TEXT_CLASS } from "@/app/tierUi";
import { useI18n } from "@/app/LocaleProvider";

export type IndexState = {
  tone: Tone;
  station: string | null;
  basin: string | null;
  street: "possible" | "likely" | null;
  streetDrives: boolean;
};

type Status = "all" | "attention" | "normal" | "none";
type Town = {
  place: Place;
  state: IndexState;
  gauge: string | null;
  river: string | null;
  rank: number;
  kind: Exclude<Status, "all">;
  /** name + spellings, then district / gauge / river names, all folded for matching */
  primary: string[];
  secondary: string[];
};

const rankOf = (t: Tone) => TONES.indexOf(t);
const byName = (a: Town, b: Town) => (a.place.name < b.place.name ? -1 : a.place.name > b.place.name ? 1 : 0);
const byAttention = (a: Town, b: Town) => b.rank - a.rank || byName(a, b);

const chip =
  "inline-flex shrink-0 items-center justify-center gap-1.5 min-h-11 rounded-full border px-3.5 text-sm whitespace-nowrap transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500";
const chipOff = "border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 hover:border-sky-300 dark:hover:border-sky-700";
const chipOn = "border-sky-600 dark:border-sky-400 bg-sky-600 dark:bg-sky-500 text-white dark:text-slate-950 font-medium";

type LocState = "idle" | "busy" | "on" | "failed" | "unsupported";

export default function TownIndex({ states }: { states: Record<string, IndexState> }) {
  const { lang, p, t } = useI18n();
  const tt = ttFor(lang);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<Status>("all");
  const [district, setDistrict] = useState("");
  const [canal, setCanal] = useState(false);
  const [loc, setLoc] = useState<{ lat: number; lon: number } | null>(null);
  const [locState, setLocState] = useState<LocState>("idle");

  const towns: Town[] = useMemo(
    () =>
      PLACES.map((place): Town => {
        const state = states[place.slug] ?? { tone: "stale" as Tone, station: null, basin: null, street: null, streetDrives: false };
        const gauge = state.station ? stationDisplayName(state.station) : null;
        const basin = state.basin?.trim() ?? null;
        const river = basin ? (lang === "en" ? basin : riverName(basin, lang).split(" · ").pop()!) : null;
        const riverForms = basin ? [basin, ...(RIVERS.find((r) => r.basin === basin)?.aliases ?? [])] : [];
        return {
          place,
          state,
          gauge,
          river,
          rank: rankOf(state.tone),
          kind: state.tone === "stale" ? "none" : state.tone === "normal" ? "normal" : "attention",
          primary: [place.name, ...place.aliases].map(fold),
          secondary: [place.district, ...(gauge ? [gauge] : []), ...riverForms].map(fold),
        };
      }),
    [states, lang],
  );

  const districts = useMemo(() => {
    const m = new Map<string, number>();
    for (const x of PLACES) m.set(x.district, (m.get(x.district) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
  }, []);
  const counts = useMemo(() => {
    const c = { all: towns.length, attention: 0, normal: 0, none: 0 };
    for (const x of towns) c[x.kind]++;
    return c;
  }, [towns]);

  const q = fold(query.trim());
  const searching = q.length >= 2;
  const filtering = searching || status !== "all" || district !== "" || canal || loc != null;

  const results: { town: Town; km?: number }[] = useMemo(() => {
    let list = towns.map((town) => ({ town, score: 1 as number, km: loc ? distanceKm(loc, { lat: town.place.lat, lon: town.place.lon }) : undefined }));
    if (searching) {
      list = list
        .map((r) => {
          let best = 0;
          for (const f of r.town.primary) best = Math.max(best, scoreOne(q, f));
          // district, gauge and river names count too, a little less than the town's own name
          for (const f of r.town.secondary) best = Math.max(best, scoreOne(q, f) * 0.9);
          return { ...r, score: best };
        })
        .filter((r) => r.score > 0);
      const top = Math.max(0, ...list.map((r) => r.score));
      // a strong match hides weak typo matches ("Kaduwela" should not also offer "Wadduwa")
      if (top >= 0.88) list = list.filter((r) => r.score >= 0.7);
    }
    if (status !== "all") list = list.filter((r) => r.town.kind === status);
    if (district) list = list.filter((r) => r.town.place.district === district);
    if (canal) list = list.filter((r) => !!r.town.place.rainZone);
    return list
      .sort((a, b) => {
        if (loc) return (a.km ?? 0) - (b.km ?? 0);
        // towns needing attention first; among equals the better text match, then A-Z
        return b.town.rank - a.town.rank || (searching ? Math.round(b.score * 20) - Math.round(a.score * 20) : 0) || byName(a.town, b.town);
      })
      .map(({ town, km }) => ({ town, km }));
  }, [towns, q, searching, status, district, canal, loc]);

  function locate() {
    if (loc) {
      setLoc(null);
      setLocState("idle");
      return;
    }
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setLocState("unsupported");
      return;
    }
    setLocState("busy");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLoc({ lat: pos.coords.latitude, lon: pos.coords.longitude });
        setLocState("on");
      },
      () => setLocState("failed"),
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 5 * 60_000 },
    );
  }
  function reset() {
    setQuery("");
    setStatus("all");
    setDistrict("");
    setCanal(false);
    setLoc(null);
    setLocState("idle");
  }

  const statusWord = (x: Town): { text: string; cls: string } => {
    const s = x.state;
    const key = (s.streetDrives && s.street ? (s.street === "likely" ? "tone.streetLikely" : "tone.streetPossible") : `tone.${x.state.tone}`) as TKey;
    return { text: tt(key), cls: x.rank >= 1 ? `${TIER_TEXT_CLASS[x.state.tone]} font-medium` : TIER_TEXT_CLASS.normal };
  };

  const row = (x: Town, opts: { showDistrict: boolean; km?: number }) => {
    const w = statusWord(x);
    const where = [opts.showDistrict ? x.place.district : null, opts.km != null ? t("near.away", { km: formatKm(opts.km, t) }) : null].filter(Boolean).join(" · ");
    const via = x.gauge ? (x.river ? `${x.gauge}, ${x.river}` : tt("ix.gauge", { gauge: x.gauge })) : "";
    return (
      <li key={x.place.slug}>
        <Link
          href={p(`/flood/${x.place.slug}`)}
          className="flex items-center gap-2.5 min-h-12 rounded-lg px-2 -mx-2 py-1 hover:bg-slate-100 dark:hover:bg-slate-800/60 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
        >
          <span className={`size-2.5 shrink-0 rounded-full ${TIER_DOT[x.state.tone]}`} aria-hidden />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm text-slate-900 dark:text-slate-100">{x.place.name}</span>
            {(where || via) && (
              <span className="block truncate text-xs text-slate-500 dark:text-slate-400" lang={lang}>
                {[where, via].filter(Boolean).join(" · ")}
              </span>
            )}
          </span>
          <span className={`shrink-0 max-w-[45%] text-right text-xs leading-tight ${w.cls}`} lang={lang}>{w.text}</span>
        </Link>
      </li>
    );
  };

  const statusChip = (id: Status, label: string, n: number) => (
    <button key={id} type="button" aria-pressed={status === id} onClick={() => setStatus(status === id ? "all" : id)} className={`${chip} ${status === id ? chipOn : chipOff}`}>
      {label}
      <span className={`tabular-nums text-xs ${status === id ? "opacity-80" : "text-slate-500 dark:text-slate-400"}`}>{n}</span>
    </button>
  );

  // ---- default view: same as before the filters existed
  const watch = towns.filter((x) => x.rank >= 1).sort(byAttention);
  const grouped = !filtering;
  const emptyStates = Object.keys(states).length === 0;

  return (
    <div>
      <div className="sticky top-[57px] z-20 -mx-4 px-4 sm:-mx-6 sm:px-6 pt-2 pb-1 bg-white/90 dark:bg-slate-950/90 backdrop-blur border-b border-slate-200/70 dark:border-slate-800/70">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-500 dark:text-slate-400" aria-hidden />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setQuery("");
            }}
            placeholder={tt("ix.search")}
            aria-label={tt("ix.search")}
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="search"
            className="h-11 w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 pl-9 pr-11 text-base sm:text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-500 dark:placeholder:text-slate-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 [&::-webkit-search-cancel-button]:appearance-none"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              aria-label={tt("ix.clear")}
              className="absolute right-0 top-1/2 flex size-11 -translate-y-1/2 items-center justify-center rounded-xl text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
            >
              <X className="size-4" aria-hidden />
            </button>
          )}
        </div>
        {/* Left padding keeps the first chip clear of the iOS swipe-back edge. */}
        <div className="-mx-4 sm:mx-0 mt-2 flex gap-2 overflow-x-auto pb-1.5 pl-5 pr-4 sm:pl-0 sm:flex-wrap [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" role="group" aria-label={tt("ix.status")}>
          {!emptyStates && (
            <>
              {statusChip("all", tt("ix.all"), counts.all)}
              {statusChip("attention", tt("ix.attention"), counts.attention)}
              {statusChip("normal", tt("ix.normal"), counts.normal)}
              {statusChip("none", tt("ix.none"), counts.none)}
            </>
          )}
          <label className={`relative ${chip} ${district ? chipOn : chipOff} gap-1 pr-2.5`}>
            <span className="sr-only">{tt("ix.district")}</span>
            <select
              value={district}
              onChange={(e) => setDistrict(e.target.value)}
              className="absolute inset-0 size-full cursor-pointer appearance-none rounded-full opacity-0"
              aria-label={tt("ix.district")}
            >
              <option value="">{tt("ix.allDistricts")}</option>
              {districts.map(([d, n]) => (
                <option key={d} value={d}>{d} ({n})</option>
              ))}
            </select>
            <span aria-hidden>{district || tt("ix.district")}</span>
            <ChevronDown className="size-4 shrink-0" aria-hidden />
          </label>
          <button type="button" aria-pressed={loc != null} onClick={locate} disabled={locState === "busy"} className={`${chip} ${loc ? chipOn : chipOff}`}>
            {locState === "busy" ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <LocateFixed className="size-4" aria-hidden />}
            {locState === "busy" ? tt("ix.locating") : tt("ix.near")}
          </button>
          <button type="button" aria-pressed={canal} onClick={() => setCanal(!canal)} className={`${chip} ${canal ? chipOn : chipOff}`}>
            <Waves className="size-4" aria-hidden />
            {tt("ix.canal")}
          </button>
        </div>
      </div>

      <div role="status" aria-live="polite" className="mt-3 mb-3 text-sm text-slate-600 dark:text-slate-300">
        {filtering && (
          <p className="flex flex-wrap items-center gap-x-3">
            <span className="tabular-nums">{tt("ix.showing", { n: results.length, m: towns.length })}</span>
            <button type="button" onClick={reset} className="inline-flex items-center min-h-11 text-sm font-medium text-sky-700 dark:text-sky-400 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 rounded">
              {tt("ix.reset")}
            </button>
          </p>
        )}
        {canal && <p className="text-xs text-slate-500 dark:text-slate-400">{tt("ix.canalHelp")}</p>}
        {locState === "failed" && <p className="text-xs text-slate-600 dark:text-slate-300">{tt("ix.locFail")}</p>}
        {locState === "unsupported" && <p className="text-xs text-slate-600 dark:text-slate-300">{tt("ix.locNone")}</p>}
        {loc && <p className="text-xs text-slate-500 dark:text-slate-400">{tt("ix.locNote")}</p>}
      </div>

      {grouped ? (
        <>
          {watch.length > 0 && (
            <section className="mb-6 rounded-xl border border-amber-300 dark:border-amber-700/60 bg-amber-50/60 dark:bg-amber-950/25 p-4" aria-label={tt("idx.watch")}>
              <h2 className="text-base font-semibold">{tt("idx.watch")}</h2>
              <ul className="mt-2 grid gap-x-6 sm:grid-cols-2 lg:grid-cols-3">{watch.map((x) => row(x, { showDistrict: true }))}</ul>
            </section>
          )}
          <p className="mb-4 text-xs text-slate-500 dark:text-slate-400">{tt("idx.basis")}</p>
          <div className="grid gap-5">
            {districts.map(([d, n]) => (
              <section key={d} aria-label={d} className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
                <h2 className="flex items-baseline justify-between gap-2 text-base font-semibold">
                  {d}
                  <span className="text-xs font-normal text-slate-500 dark:text-slate-400">{tt("idx.count", { n })}</span>
                </h2>
                <ul className="mt-2 grid gap-x-6 sm:grid-cols-2 lg:grid-cols-3">
                  {towns.filter((x) => x.place.district === d).sort(byAttention).map((x) => row(x, { showDistrict: false }))}
                </ul>
              </section>
            ))}
          </div>
        </>
      ) : results.length > 0 ? (
        <section className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4" aria-label={tt("ix.showing", { n: results.length, m: towns.length })}>
          <ul className="grid gap-x-6 sm:grid-cols-2 lg:grid-cols-3">{results.map(({ town, km }) => row(town, { showDistrict: true, km }))}</ul>
        </section>
      ) : (
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 text-sm text-slate-700 dark:text-slate-300">
          <p>{tt("ix.empty")}</p>
          <Link href={p("/")} className="mt-2 inline-flex items-center min-h-11 font-medium text-sky-700 dark:text-sky-400 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 rounded">
            {tt("ix.emptyLink")}
          </Link>
        </div>
      )}
    </div>
  );
}
