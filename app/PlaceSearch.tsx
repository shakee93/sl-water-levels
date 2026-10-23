"use client";

import { Fragment, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, Clock, Loader2, MapPin, Search, Waves, X } from "lucide-react";
import { buildIndex, search, type Hit } from "@/lib/fuzzy";
import { PLACES, RIVERS, townPath } from "@/lib/places";
import { basinPath } from "@/lib/slug";
import { formatLevel } from "@/lib/units";
import { trackEvent } from "@/lib/umami";
import { distanceKm, formatKm, matchLocation } from "@/lib/nearby";
import { ForgetLink } from "./NearYou";
import { markDenied, storeLocation, useLocation } from "./useLocation";
import { useI18n } from "./LocaleProvider";
import { riverName } from "@/lib/i18n/format";
import type { SearchStation } from "./PlaceSearchData";

type Props = { variant: "hero" | "header"; stations: SearchStation[] };

type Item =
  | { key: string; type: "result"; label: string; sub: string; href: string; river: boolean; gauge?: SearchStation; km?: number; away?: number; near?: boolean }
  | { key: string; type: "recent"; label: string; sub: string; href: string }
  | { key: string; type: "locate" };

const RECENT_KEY = "sl_recent_searches";
const dot: Record<string, string> = {
  normal: "bg-emerald-500",
  watch: "bg-yellow-500",
  alert: "bg-yellow-500",
  minor: "bg-orange-500",
  major: "bg-red-500",
  none: "bg-slate-400",
  stale: "bg-slate-300 dark:bg-slate-600",
};

function readRecents(): { label: string; sub: string; href: string }[] {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]");
    return Array.isArray(v) ? v.slice(0, 4) : [];
  } catch {
    return [];
  }
}
function writeRecent(r: { label: string; sub: string; href: string }) {
  try {
    const next = [r, ...readRecents().filter((x) => x.href !== r.href)].slice(0, 4);
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    /* storage unavailable */
  }
}

/** Shared state + behaviour for both variants. */
function useSearch(stations: SearchStation[], onDone?: () => void) {
  const router = useRouter();
  const { lang, t, p } = useI18n();
  const index = useMemo(
    () => buildIndex(stations.map(({ station, basin, latitude, longitude }) => ({ station, basin, latitude, longitude })), PLACES, RIVERS),
    [stations],
  );
  const byName = useMemo(() => new Map(stations.map((s) => [s.station, s])), [stations]);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [recents, setRecents] = useState<{ label: string; sub: string; href: string }[]>([]);
  const [locating, setLocating] = useState(false);
  const [locError, setLocError] = useState<string | null>(null);
  const { loc, forget } = useLocation();
  const placeByName = useMemo(() => new Map(PLACES.map((p) => [p.name, p])), []);

  const refreshRecents = useCallback(() => setRecents(readRecents()), []);

  // Distance from the visitor to whatever a hit points at (town, gauge, or the nearest gauge of a river).
  const awayKm = useCallback(
    (h: Hit): number | undefined => {
      if (!loc) return undefined;
      let pt: { latitude: number; longitude: number } | undefined;
      if (h.kind === "place") {
        const p = placeByName.get(h.label);
        pt = p ? { latitude: p.lat, longitude: p.lon } : undefined;
      } else if (h.kind === "station") {
        pt = byName.get(h.label);
      } else {
        const ds = stations.filter((s) => s.basin === h.label).map((s) => distanceKm(loc, { lat: s.latitude, lon: s.longitude }));
        return ds.length ? Math.min(...ds) : undefined;
      }
      return pt ? distanceKm(loc, { lat: pt.latitude, lon: pt.longitude }) : undefined;
    },
    [loc, placeByName, byName, stations],
  );

  const hits: Hit[] = useMemo(() => {
    const found = search(query, index, 6);
    if (!loc) return found;
    // Near-equal matches: the one closer to the visitor first.
    const bucket = (h: Hit) => Math.round(h.score * 20);
    return [...found].sort((a, b) => bucket(b) - bucket(a) || (awayKm(a) ?? Infinity) - (awayKm(b) ?? Infinity));
  }, [query, index, loc, awayKm]);
  const near = useMemo(() => (loc ? matchLocation(loc, stations) : null), [loc, stations]);
  const trimmed = query.trim();
  const noMatch = trimmed.length >= 2 && hits.length === 0;

  const items: Item[] = useMemo(() => {
    if (trimmed.length < 2) {
      const nearItems: Item[] = near
        ? [near.primary, ...near.others].map((g, i): Item => {
            const gauge = byName.get(g.station);
            return {
              key: `near|${g.station}`,
              type: "result",
              label: i === 0 && near.placeName ? near.placeName : g.station,
              sub: t("near.away", { km: formatKm(g.km, t) }),
              href: p(g.href),
              river: false,
              gauge,
              near: true,
            };
          })
        : [];
      return [
        ...nearItems,
        ...recents.map((r): Item => ({ key: `r|${r.href}`, type: "recent", ...r })),
        ...(loc ? [] : [{ key: "locate", type: "locate" } as Item]),
      ];
    }
    return hits.flatMap((h, idx): Item[] => {
      const g = h.gauges[0];
      const gauge = g ? byName.get(g.station) : undefined;
      if (h.kind === "river") {
        return [{ key: `r|${h.label}`, type: "result", label: riverName(h.label, lang), sub: t("search.gauges", { n: h.gauges.length }), href: p(basinPath(h.label)), river: true, away: awayKm(h) }];
      }
      if (h.kind === "place") {
        // A town opens its own flood estimate; the best match also offers the river gauge it is based on.
        const town: Item = {
          key: `place|${h.label}`,
          type: "result",
          label: h.label,
          sub: h.sub,
          href: p(townPath(h.label)),
          river: false,
          gauge,
          km: (g as { km: number }).km,
          away: awayKm(h),
        };
        const gaugeRow: Item[] = idx === 0 && gauge
          ? [{ key: `gauge|${gauge.station}`, type: "result", label: gauge.station, sub: riverName(gauge.basin, lang), href: p(gauge.href), river: false, gauge, away: awayKm({ kind: "station", label: gauge.station, sub: gauge.basin, score: h.score, gauges: [{ station: gauge.station, basin: gauge.basin, km: null }] }) }]
          : [];
        return [town, ...gaugeRow];
      }
      return [{
        key: `${h.kind}|${h.label}`,
        type: "result",
        label: h.label,
        sub: h.sub,
        href: p(gauge?.href ?? "/"),
        river: false,
        gauge,
        away: awayKm(h),
      }];
    });
  }, [hits, byName, recents, trimmed, near, loc, awayKm, t, p, lang]);

  // Track no-match once per settled query, not per keystroke.
  useEffect(() => {
    if (!noMatch) return;
    const t = setTimeout(() => trackEvent("search_no_match", { query: trimmed.slice(0, 60) }), 800);
    return () => clearTimeout(t);
  }, [noMatch, trimmed]);

  const locate = useCallback(() => {
    trackEvent("find_nearest_clicked");
    if (!navigator.geolocation) {
      setLocError(t("search.errNoGeo"));
      return;
    }
    setLocError(null);
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude: la, longitude: lo } = pos.coords;
        storeLocation(la, lo);
        const near = stations
          .filter((s) => Number.isFinite(s.latitude) && Number.isFinite(s.longitude))
          .map((s) => ({ s, km: distanceKm({ lat: la, lon: lo }, { lat: s.latitude, lon: s.longitude }) }))
          .sort((a, b) => a.km - b.km)[0];
        setLocating(false);
        if (!near) return;
        trackEvent("find_nearest_success", { nearest: near.s.station, nearest_km: Number(near.km.toFixed(1)) });
        onDone?.();
        window.dispatchEvent(new Event("sl:nav-start"));
        router.push(p(near.s.href));
      },
      (err) => {
        setLocating(false);
        trackEvent("find_nearest_error", { code: err.code });
        if (err.code === err.PERMISSION_DENIED) markDenied();
        setLocError(err.code === err.PERMISSION_DENIED ? t("search.errDenied") : t("search.errFail"));
      },
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 5 * 60_000 },
    );
  }, [stations, router, onDone, t, p]);

  const reset = useCallback(() => {
    setQuery("");
    setActive(0);
    setLocError(null);
  }, []);

  const choose = useCallback(
    (item: Item) => {
      if (item.type === "locate") return locate();
      if (item.type === "result") {
        writeRecent({ label: item.label, sub: item.sub, href: item.href });
        trackEvent("search", { query: trimmed.slice(0, 60), result: item.label, kind: item.river ? "river" : item.gauge ? "place" : "station" });
      } else {
        trackEvent("search", { result: item.label, kind: "recent" });
      }
      onDone?.();
      reset();
      window.dispatchEvent(new Event("sl:nav-start"));
      router.push(item.href);
    },
    [locate, router, onDone, trimmed, reset],
  );

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => (items.length ? (a + 1) % items.length : 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => (items.length ? (a - 1 + items.length) % items.length : 0));
    } else if (e.key === "Enter") {
      const it = items[Math.min(active, items.length - 1)];
      if (it) {
        e.preventDefault();
        choose(it);
      }
    }
  };

  return { t, p, lang, query, setQuery, active, setActive, items, noMatch, locating, locError, choose, onKeyDown, refreshRecents, reset, done: onDone, hasLoc: !!loc, forget };
}

function Rows({ s, listId }: { s: ReturnType<typeof useSearch>; listId: string }) {
  const empty = s.query.trim().length < 2;
  return (
    <>
      <ul id={listId} role="listbox" aria-label={s.t("search.results")}>
        {s.items.map((it, i) => {
          const on = i === s.active;
          const group = !empty ? null : it.type === "recent" ? s.t("search.recent") : it.type === "result" && it.near ? s.t("search.nearYou") : null;
          const prev = s.items[i - 1];
          const prevGroup = !prev ? null : prev.type === "recent" ? s.t("search.recent") : prev.type === "result" && prev.near ? s.t("search.nearYou") : null;
          return (
            <Fragment key={it.key}>
              {group && group !== prevGroup && (
                <li role="presentation" className="px-3.5 pt-3 pb-1 text-xs text-slate-500 dark:text-slate-400 font-medium">
                  {group}
                </li>
              )}
            <li
              id={`${listId}-${i}`}
              role="option"
              aria-selected={on}
              onMouseMove={() => s.setActive(i)}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => s.choose(it)}
              className={`flex items-center justify-between gap-3 px-3.5 min-h-11 py-2 cursor-pointer transition ${
                on ? "bg-slate-50 dark:bg-slate-800/60" : ""
              }`}
            >
              {it.type === "locate" ? (
                <span className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
                  {s.locating ? <Loader2 className="size-3.5 animate-spin text-slate-400" /> : <MapPin className="size-3.5 text-slate-400" />}
                  {s.locating ? s.t("search.locating") : s.t("search.locate")}
                  {s.locError && <span className="text-xs text-amber-700 dark:text-amber-300">{s.locError}</span>}
                </span>
              ) : it.type === "recent" ? (
                <span className="flex items-center gap-2 min-w-0">
                  <Clock className="size-3.5 text-slate-400 shrink-0" />
                  <span className="text-sm text-slate-900 dark:text-slate-100 truncate">{it.label}</span>
                  <span className="text-xs text-slate-500 dark:text-slate-400 truncate">{it.sub}</span>
                </span>
              ) : (
                <>
                  <span className="min-w-0">
                    <span className="flex items-baseline gap-2">
                      <span className="text-sm font-medium text-slate-900 dark:text-slate-100 truncate">{it.label}</span>
                      <span className="text-xs text-slate-500 dark:text-slate-400 truncate">{it.sub}</span>
                    </span>
                    {it.gauge && (
                      <span className="mt-0.5 flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
                        <span className={`size-1.5 rounded-full shrink-0 ${dot[it.gauge.tier] ?? dot.none}`} />
                        <span className="truncate">
                          {it.gauge.station !== it.label && `→ ${it.gauge.station} · `}{riverName(it.gauge.basin, s.lang)}
                        </span>
                        {it.gauge.level != null && (
                          <span className="tabular-nums text-slate-700 dark:text-slate-300 shrink-0">
                            {formatLevel(it.gauge.level, it.gauge.unit)}
                          </span>
                        )}
                      </span>
                    )}
                  </span>
                  <span className="flex items-center gap-2 shrink-0">
                    {it.away != null && !it.near && (
                      <span className="text-xs tabular-nums text-slate-500 dark:text-slate-400">{formatKm(it.away, s.t)}</span>
                    )}
                    {it.river ? (
                      <Waves className="size-3.5 text-slate-400" />
                    ) : (
                      <ArrowRight className={`size-3.5 transition ${on ? "text-sky-500" : "text-slate-400"}`} />
                    )}
                  </span>
                </>
              )}
            </li>
            </Fragment>
          );
        })}
      </ul>
      {s.hasLoc && (
        <div className="px-2.5 py-0 sm:py-1 border-t border-slate-100 dark:border-slate-800 text-right">
          <ForgetLink onClick={s.forget} />
        </div>
      )}
      {s.noMatch && (
        <div className="px-3.5 py-4 text-sm text-slate-500 dark:text-slate-400">
          {s.t("search.noMatch", { q: s.query.trim() })}{" "}
          <Link href={s.p("/")} onClick={s.done} className="text-sky-700 dark:text-sky-300 underline underline-offset-2">
            {s.t("search.browse")}
          </Link>
        </div>
      )}
    </>
  );
}

export function PlaceSearch({ variant, stations }: Props) {
  return variant === "hero" ? <Hero stations={stations} /> : <HeaderSearch stations={stations} />;
}

function Hero({ stations }: { stations: SearchStation[] }) {
  const { t } = useI18n();
  const id = useId();
  const listId = `${id}-list`;
  const wrap = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const closeList = useCallback(() => setOpen(false), []);
  const s = useSearch(stations, closeList);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const showList = open && (s.items.length > 0 || s.noMatch);

  return (
    <div ref={wrap} className="relative mb-5">
      <div className="flex items-center gap-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-sm px-3.5 focus-within:border-sky-500 dark:focus-within:border-sky-500 focus-within:ring-2 focus-within:ring-sky-500/30 transition">
        <Search className="size-4 text-slate-400 shrink-0" aria-hidden />
        <input
          type="text"
          role="combobox"
          aria-expanded={showList}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={showList ? `${listId}-${s.active}` : undefined}
          aria-label={t("search.aria")}
          inputMode="search"
          enterKeyHint="go"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          placeholder={t("search.placeholder")}
          value={s.query}
          onChange={(e) => {
            s.setQuery(e.target.value);
            s.setActive(0);
            setOpen(true);
          }}
          onFocus={() => {
            s.refreshRecents();
            setOpen(true);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") setOpen(false);
            else {
              setOpen(true);
              s.onKeyDown(e);
            }
          }}
          className="flex-1 min-w-0 bg-transparent py-3 text-base sm:text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 outline-none"
        />
        {s.query && (
          <button type="button" aria-label={t("search.clear")} onClick={() => s.reset()} className="grid place-items-center size-11 -mr-3 shrink-0 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200">
            <X className="size-4" aria-hidden />
          </button>
        )}
      </div>
      {showList && (
        <div className="absolute inset-x-0 top-full mt-1.5 z-30 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-lg overflow-hidden">
          <Rows s={s} listId={listId} />
        </div>
      )}
    </div>
  );
}

function HeaderSearch({ stations }: { stations: SearchStation[] }) {
  const { t } = useI18n();
  const id = useId();
  const listId = `${id}-list`;
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const close = useCallback(() => setOpen(false), []);
  const s = useSearch(stations, close);
  const { refreshRecents, reset } = s;

  // Global shortcuts: "/" (not while typing) and Cmd/Ctrl+K.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const typing = !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable);
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen(true);
      } else if (e.key === "/" && !typing && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        setOpen(true);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!open) return;
    refreshRecents();
    reset();
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    input.current?.focus();
    const btn = trigger.current;
    return () => {
      document.body.style.overflow = prev;
      btn?.focus();
    };
  }, [open, refreshRecents, reset]);

  const onPanelKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    } else if (e.key === "Tab" && panel.current) {
      const f = [...panel.current.querySelectorAll<HTMLElement>("input, button, a[href]")].filter((el) => !el.hasAttribute("disabled"));
      if (!f.length) return;
      const first = f[0];
      const last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  };

  const showList = s.items.length > 0;

  return (
    <>
      <button
        ref={trigger}
        type="button"
        onClick={() => setOpen(true)}
        aria-label={t("search.openAria")}
        aria-haspopup="dialog"
        title={t("search.hint")}
        className="inline-flex items-center justify-center h-11 w-10 sm:size-9 rounded-md text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
      >
        <Search className="size-4" />
      </button>

      {open &&
        // Portal: the sticky header's backdrop-blur would otherwise become the containing block of `fixed`.
        createPortal(
        <div className="fixed inset-0 z-50 sm:bg-slate-950/40 sm:backdrop-blur-sm sm:flex sm:items-start sm:justify-center sm:pt-[12vh] sm:px-4" onMouseDown={(e) => e.target === e.currentTarget && close()}>
          <div
            ref={panel}
            role="dialog"
            aria-modal="true"
            aria-label={t("search.openAria")}
            onKeyDown={onPanelKey}
            className="h-full sm:h-auto w-full sm:max-w-lg flex flex-col pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] sm:pt-0 sm:pb-0 bg-white dark:bg-slate-900 sm:rounded-xl sm:border border-slate-200 dark:border-slate-800 sm:shadow-xl overflow-hidden text-slate-900 dark:text-slate-100"
          >
            <div className="flex items-center gap-2 px-3.5 border-b border-slate-100 dark:border-slate-800">
              <Search className="size-4 text-slate-400 shrink-0" aria-hidden />
              <input
                ref={input}
                type="text"
                role="combobox"
                aria-expanded={showList}
                aria-controls={listId}
                aria-autocomplete="list"
                aria-activedescendant={showList ? `${listId}-${s.active}` : undefined}
                aria-label={t("search.aria")}
                inputMode="search"
                enterKeyHint="go"
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
                placeholder={t("search.placeholder")}
                value={s.query}
                onChange={(e) => {
                  s.setQuery(e.target.value);
                  s.setActive(0);
                }}
                onKeyDown={s.onKeyDown}
                className="flex-1 min-w-0 bg-transparent py-3.5 text-base sm:text-sm placeholder:text-slate-400 outline-none"
              />
              <button type="button" onClick={close} aria-label={t("search.close")} className="grid place-items-center size-11 -mr-3 shrink-0 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200">
                <X className="size-4" aria-hidden />
              </button>
            </div>
            <div className="flex-1 sm:flex-none sm:max-h-[60vh] overflow-y-auto">
              <Rows s={s} listId={listId} />
            </div>
          </div>
        </div>,
        document.body,
        )}
    </>
  );
}
