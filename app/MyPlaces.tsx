"use client";

// Home page, top: "Your places". The places the visitor starred (a town or a river gauge) with one plain line that
// answers "are my places OK?", then a row per place. Remembered on this device only (localStorage "sl_favourites",
// no account). The answer comes from /api/places-state, the same code the town and gauge pages use; the last answer is
// kept on the device so the card still shows something, clearly dated, when there is no connection.
import { hasLowSpot } from "@/lib/lowSpots";
import { useLowSpotsRaw } from "./flood/useLowSpot";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { ChevronRight, CircleCheck, CircleHelp, Share2, Star, TriangleAlert } from "lucide-react";
import { levelOf, overall, MAX_PLACES, type Glance } from "@/lib/myPlaces";
import { keyOfPin, parsePins, PINS_EVENT, PINS_KEY, readPinsRaw } from "@/lib/pins";
import { MY_LEVELS_EVENT, MY_LEVELS_KEY, parseMyLevel, readMyLevelsRaw } from "@/lib/myLevels";
import { rtFor, seasonKey, type RKey } from "@/lib/i18n/return";
import { ttFor, type TKey } from "@/lib/i18n/town";
import { stationDisplayName } from "@/lib/displayName";
import { trackEvent } from "@/lib/umami";
import { AlertsToggle } from "./AlertsToggle";
import { useI18n } from "./LocaleProvider";
import { TIER_DOT, TIER_TEXT_CLASS, colomboTime, type HomeStation } from "./tierUi";
import { VERDICT } from "./verdict";

const ring = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-1 dark:focus-visible:ring-offset-slate-900";
const CACHE_KEY = "sl_glance_v1";
const REFRESH_MS = 5 * 60_000;
const SLOT_ID = "np-slot";

/** Runs while the page is still being parsed: reserves the card's height (or hides it) before first paint, so nothing below jumps. */
const SLOT_SCRIPT = `try{var a=JSON.parse(localStorage.getItem(${JSON.stringify(PINS_KEY)})||"[]");var n=Array.isArray(a)?Math.min(a.length,${MAX_PLACES}):0;var e=document.getElementById(${JSON.stringify(SLOT_ID)});if(e){if(n===0)e.style.display="none";else e.style.minHeight=(11.75+n*3.5)+"rem"}}catch(x){}`;

function subscribeAll(cb: () => void) {
  const on = (e: StorageEvent) => (e.key === null || e.key === PINS_KEY || e.key === MY_LEVELS_KEY) && cb();
  window.addEventListener("storage", on);
  window.addEventListener(PINS_EVENT, cb);
  window.addEventListener(MY_LEVELS_EVENT, cb);
  window.addEventListener("focus", cb);
  return () => {
    window.removeEventListener("storage", on);
    window.removeEventListener(PINS_EVENT, cb);
    window.removeEventListener(MY_LEVELS_EVENT, cb);
    window.removeEventListener("focus", cb);
  };
}
// One string so useSyncExternalStore sees a stable snapshot: pins JSON + "\n" + my-levels JSON.
const snapshot = () => `${readPinsRaw()}\n${readMyLevelsRaw() ?? ""}`;

type Cache = { at: number; places: Record<string, Glance> };
const readCache = (): Cache | null => {
  try {
    const v = JSON.parse(window.localStorage.getItem(CACHE_KEY) ?? "null") as Cache | null;
    return v && typeof v.at === "number" && v.places ? v : null;
  } catch {
    return null;
  }
};
const writeCache = (c: Cache) => {
  try {
    window.localStorage.setItem(CACHE_KEY, JSON.stringify(c));
  } catch {
    /* storage blocked: the card just has no offline copy */
  }
};

/** What a station gauge says, from data the page already has (instant, before the network answer). */
function fromStation(s: HomeStation): Glance {
  const rate = s.rate3hM;
  return {
    key: `s:${s.station}`, kind: "s", name: stationDisplayName(s.station), href: s.href, tone: s.tier, street: null,
    trend: s.tier === "stale" || rate == null ? "unknown" : Math.abs(rate) < 0.006 ? "steady" : rate > 0 ? "up" : "down",
    levelText: null, rain24: null, rainNext24: null, gaugeStation: s.station, ts: s.ts,
  };
}

const TONE_OF_LEVEL = ["normal", "watch", "alert", "minor", "major"] as const;

export function MyPlaces({ stations }: { stations: HomeStation[] }) {
  const { lang, t, p } = useI18n();
  const rt = rtFor(lang);
  const tt = ttFor(lang);
  const snap = useSyncExternalStore(subscribeAll, snapshot, () => null);
  const lowRaw = useLowSpotsRaw();
  // the last answer kept on this device (also what an offline visit shows). Only read once the card renders, i.e. after hydration.
  const [saved] = useState<Cache | null>(() => (typeof window === "undefined" ? null : readCache()));
  const [fetched, setFetched] = useState<Record<string, Glance>>(saved?.places ?? {});
  const [at, setAt] = useState<number | null>(saved?.at ?? null);
  const [nowMs] = useState(() => Date.now());
  const [failed, setFailed] = useState(false);
  const [offline, setOffline] = useState(false);
  const lastFetch = useRef(0);

  const [pinsRaw, levelsRaw] = useMemo(() => {
    if (snap == null) return [null, null] as const;
    const i = snap.indexOf("\n");
    return [snap.slice(0, i), snap.slice(i + 1) || null] as const;
  }, [snap]);

  const stationByHref = useMemo(() => new Map(stations.map((s) => [s.href, s.station] as const)), [stations]);
  const stationByName = useMemo(() => new Map(stations.map((s) => [s.station, s] as const)), [stations]);
  const keys = useMemo(() => {
    const seen = new Set<string>();
    for (const pin of parsePins(pinsRaw)) {
      const k = keyOfPin(pin.href, stationByHref);
      if (k) seen.add(k);
      if (seen.size >= MAX_PLACES) break;
    }
    return [...seen];
  }, [pinsRaw, stationByHref]);
  const keysJoined = keys.join("|");

  // the visitor's own street level per gauge, sent only to answer this one request
  const lvParam = useMemo(() => {
    if (!levelsRaw) return "";
    try {
      const o = JSON.parse(levelsRaw) as Record<string, unknown>;
      return Object.entries(o)
        .filter(([k, v]) => typeof v === "number" && v > 0 && k.length <= 60 && !k.includes("|") && !k.includes(":"))
        .slice(0, 12)
        .map(([k, v]) => `${k}:${v}`)
        .join("|");
    } catch {
      return "";
    }
  }, [levelsRaw]);

  const load = useCallback(async () => {
    if (!keysJoined) return;
    lastFetch.current = Date.now();
    try {
      const qs = new URLSearchParams({ keys: keysJoined });
      if (lvParam) qs.set("lv", lvParam);
      const res = await fetch(`/api/places-state?${qs}`);
      const j = (await res.json()) as { ok: boolean; places: Glance[]; at: number };
      if (!res.ok || !j.ok) throw new Error("bad");
      const map = Object.fromEntries(j.places.map((g) => [g.key, g]));
      setFetched(map);
      setAt(j.at);
      setFailed(false);
      setOffline(false);
      writeCache({ at: j.at, places: map });
    } catch {
      setFailed(true);
      setOffline(typeof navigator !== "undefined" && navigator.onLine === false);
    }
  }, [keysJoined, lvParam]);

  useEffect(() => {
    const first = setTimeout(() => void load(), 0);
    const every = setInterval(() => document.visibilityState === "visible" && void load(), REFRESH_MS);
    const back = () => document.visibilityState === "visible" && Date.now() - lastFetch.current > 90_000 && void load();
    document.addEventListener("visibilitychange", back);
    window.addEventListener("online", back);
    return () => {
      clearTimeout(first);
      clearInterval(every);
      document.removeEventListener("visibilitychange", back);
      window.removeEventListener("online", back);
    };
  }, [load]);
  // the reserved height from the early script is only for first paint
  useEffect(() => {
    const e = document.getElementById(SLOT_ID);
    if (e) e.style.minHeight = "";
  }, [keysJoined]);

  const glances = useMemo(
    () =>
      keys.map((k): Glance | null => {
        const g = fetched[k];
        if (g) return g;
        if (k.startsWith("s:")) {
          const s = stationByName.get(k.slice(2));
          return s ? fromStation(s) : null;
        }
        return null;
      }),
    [keys, fetched, stationByName],
  );
  const ready = glances.filter((g): g is Glance => g !== null);
  const pending = keys.length - ready.length;

  if (pinsRaw === null) return <section id={SLOT_ID} suppressHydrationWarning className="mb-6"><script dangerouslySetInnerHTML={{ __html: SLOT_SCRIPT }} /></section>;
  if (keys.length === 0) return <section id={SLOT_ID} style={{ display: "none" }} aria-hidden />;

  const verdictText = (g: Glance): string => {
    const lvl = levelOf(g);
    if (g.kind === "t") {
      return tt(`tone.${g.tone === "none" ? "stale" : g.tone}` as TKey);
    }
    return lvl == null && g.tone !== "none" ? VERDICT.stale[lang] : VERDICT[g.tone][lang];
  };
  const displayTone = (g: Glance) => {
    const l = levelOf(g);
    return l == null ? "stale" : TONE_OF_LEVEL[l];
  };

  const sum = overall(ready);
  const summaryText =
    pending > 0 && ready.length === 0
      ? rt("mp.loading")
      : sum.kind === "calm"
        ? sum.n === 1 ? rt("mp.calm1", { name: ready[0].name }) : rt("mp.calmN", { n: sum.n })
        : sum.kind === "attention"
          ? `${levelOf(sum.worst) === 1 ? rt("mp.attentionNear", { name: sum.worst.name }) : rt("mp.attention", { name: sum.worst.name, verdict: verdictText(sum.worst) })}${sum.calmOthers > 0 ? " " + (sum.calmOthers === 1 ? rt("mp.attentionOthers1") : rt("mp.attentionOthers", { n: sum.calmOthers })) : ""}`
          : sum.kind === "unknown"
            ? rt("mp.unknown", { n: sum.n })
            : "";
  const attention = sum.kind === "attention";
  const SummaryIcon = sum.kind === "calm" ? CircleCheck : attention ? (levelOf(sum.worst)! >= 2 ? TriangleAlert : CircleCheck) : CircleHelp;
  const summaryClass = sum.kind === "calm" ? "text-emerald-700 dark:text-emerald-400" : attention ? TIER_TEXT_CLASS[displayTone(sum.worst)] : "text-slate-600 dark:text-slate-300";

  // Today: rain expected, then the season, in one calm line each
  // Pinned gauges count too (their rain is the forecast over the hills above them, and what their own sensor measured); a gauge's
  // 24 h rain is only ever a sensor reading here, never a town's model or satellite figure.
  const withRain = ready.filter((g) => g.rainNext24 != null);
  const wettest = withRain.reduce<Glance | null>((m, g) => (m == null || g.rainNext24! > m.rainNext24! ? g : m), null);
  const fell = ready.filter((g) => g.kind === "s" && g.rain24 != null && g.rain24 >= 50).reduce<Glance | null>((m, g) => (m == null || g.rain24! > m.rain24! ? g : m), null);
  const todayLine = fell && !(wettest && wettest.rainNext24! >= 50)
    ? rt("mp.todayFell", { mm: Math.round(fell.rain24! / 5) * 5, name: fell.name })
    : wettest
      ? wettest.rainNext24! >= 50
        ? rt(wettest.kind === "s" ? "mp.todayRainGauge" : "mp.todayRain", { mm: Math.round(wettest.rainNext24! / 5) * 5, name: wettest.name })
        : wettest.rainNext24! >= 10
          ? rt("mp.todayLight")
          : rt("mp.todayDry")
      : null;
  const month = Number(new Date(nowMs + 5.5 * 3_600_000).toISOString().slice(5, 7));
  const seasonLine = attention ? null : rt(seasonKey(month) as RKey);

  const newest = at ?? ready.reduce<number | null>((m, g) => (g.ts != null && (m == null || g.ts > m) ? g.ts : m), null);
  const first = ready[0];
  const shareText = `${summaryText || rt("mp.title")}`;
  async function share() {
    if (!first) return;
    const url = window.location.origin + p(first.href);
    trackEvent("share_places");
    if (typeof navigator.share === "function") {
      try {
        await navigator.share({ title: rt("mp.title"), text: shareText, url });
        return;
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") return;
      }
    }
    window.open(`https://wa.me/?text=${encodeURIComponent(`${shareText} ${url}`)}`, "_blank", "noopener");
  }

  // keys sent to the alert service carry the visitor's own street level, where they set one
  const alertKeys = keys.map((k) => {
    const g = fetched[k];
    if (k.startsWith("t:") && g?.gaugeStation) {
      const lv = parseMyLevel(levelsRaw, g.gaugeStation);
      if (lv != null) return `${k}@${lv}`;
    }
    return k;
  });

  return (
    <section id={SLOT_ID} suppressHydrationWarning className="mb-6" aria-labelledby="my-places-heading" lang={lang}>
      <h2 id="my-places-heading" className="mb-2 flex items-center gap-1.5 text-base font-semibold tracking-tight text-slate-900 dark:text-slate-100">
        <Star className="size-3.5 fill-amber-400 text-amber-500" aria-hidden />
        {rt("mp.title")}
      </h2>
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm">
        <p className={`flex min-h-[3.5rem] items-start gap-2.5 px-4 pt-3.5 pb-2 text-[17px] font-semibold leading-snug ${summaryClass}`} role="status" aria-live="polite">
          <SummaryIcon className="mt-0.5 size-5 shrink-0" aria-hidden />
          <span>{summaryText}</span>
        </p>

        <ul className="divide-y divide-slate-100 dark:divide-slate-800 border-t border-slate-100 dark:border-slate-800">
          {keys.map((k, i) => {
            const g = glances[i];
            if (!g) {
              return (
                <li key={k} className="flex min-h-14 items-center px-4 text-sm text-slate-500 dark:text-slate-400">{rt("mp.loading")}</li>
              );
            }
            const tone = displayTone(g);
            const trend = g.trend === "up" ? rt("mp.rising") : g.trend === "down" ? rt("mp.falling") : g.trend === "steady" ? rt("mp.steady") : null;
            const rain = g.rain24 == null ? null : g.rain24 < 1 ? rt("mp.noRain") : rt("mp.rain", { mm: Math.round(g.rain24) });
            const detail = [verdictText(g), g.tone === "watch" ? t("tier.nearShort") : null, tone !== "stale" ? trend : null, rain].filter(Boolean).join(" · ");
            // heavy rain over a spot the visitor marked as low ground (lib/lowSpots.ts): a quiet second line, never the verdict
            const lowNote = g.kind === "t" && g.street && hasLowSpot(lowRaw, k.slice(2)) ? tt(g.street === "likely" ? "low.likely" : "low.possible") : null;
            return (
              <li key={k}>
                <Link href={p(g.href)} aria-label={`${rt("mp.open", { name: g.name })}: ${detail}${lowNote ? `. ${lowNote}` : ""}`} className={`group flex min-h-14 items-center gap-3 px-4 py-2 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition ${ring}`}>
                  <span className={`size-2.5 shrink-0 rounded-full ${TIER_DOT[tone]}`} aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-slate-900 dark:text-slate-100">{g.name}</span>
                    <span className={`block text-xs leading-snug ${TIER_TEXT_CLASS[tone]}`}>{detail}</span>
                    {lowNote && <span className="mt-0.5 block text-xs leading-snug text-slate-500 dark:text-slate-400">{lowNote}</span>}
                  </span>
                  {g.levelText && <span className="shrink-0 text-sm font-semibold tabular-nums text-slate-900 dark:text-slate-100">{g.levelText}</span>}
                  <ChevronRight className="size-4 shrink-0 text-slate-400 group-hover:text-sky-500 transition" aria-hidden />
                </Link>
              </li>
            );
          })}
        </ul>

        <div className="border-t border-slate-100 dark:border-slate-800 px-4 py-2.5 text-sm text-slate-600 dark:text-slate-400">
          {failed && <p className="mb-1" role="status">{offline && newest != null ? rt("off.body", { time: colomboTime(newest, t) }) : rt("mp.loadError")}</p>}
          {todayLine && <p><span className="font-medium text-slate-700 dark:text-slate-300">{rt("mp.today")}: </span>{todayLine}</p>}
          {seasonLine && <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{seasonLine}</p>}
          {newest != null && !failed && <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{rt("mp.updated", { time: colomboTime(newest, t) })}</p>}
        </div>

        <div className="flex min-h-[3.25rem] flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t border-slate-100 dark:border-slate-800 px-4 py-1.5">
          <AlertsToggle keys={alertKeys} />
          <button type="button" onClick={share} className={`inline-flex min-h-11 items-center gap-2 rounded-md px-2.5 text-sm font-medium text-sky-700 dark:text-sky-300 hover:bg-slate-100 dark:hover:bg-slate-800 ${ring}`}>
            <Share2 className="size-4" aria-hidden /> {rt("mp.share")}
          </button>
        </div>
        {lang !== "en" && <p className="px-4 pb-2.5 text-xs text-slate-500 dark:text-slate-400">{t("common.machineTranslated")}</p>}
      </div>
    </section>
  );
}
