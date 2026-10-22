"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, Clock, Loader2, MapPin, Search, Waves, X } from "lucide-react";
import { buildIndex, search, type Hit } from "@/lib/fuzzy";
import { PLACES, RIVERS } from "@/lib/places";
import { basinPath } from "@/lib/slug";
import { formatLevel } from "@/lib/units";
import { trackEvent } from "@/lib/umami";
import type { SearchStation } from "./PlaceSearchData";

type Props = { variant: "hero" | "header"; stations: SearchStation[] };

type Item =
  | { key: string; type: "result"; label: string; sub: string; href: string; river: boolean; gauge?: SearchStation; km?: number }
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

function distanceKm(aLat: number, aLon: number, bLat: number, bLon: number) {
  const r = (d: number) => (d * Math.PI) / 180;
  const h = Math.sin(r(bLat - aLat) / 2) ** 2 + Math.cos(r(aLat)) * Math.cos(r(bLat)) * Math.sin(r(bLon - aLon) / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
}

/** Shared state + behaviour for both variants. */
function useSearch(stations: SearchStation[], onDone?: () => void) {
  const router = useRouter();
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

  const refreshRecents = useCallback(() => setRecents(readRecents()), []);

  const hits: Hit[] = useMemo(() => search(query, index, 6), [query, index]);
  const trimmed = query.trim();
  const noMatch = trimmed.length >= 2 && hits.length === 0;

  const items: Item[] = useMemo(() => {
    if (trimmed.length < 2) {
      return [
        ...recents.map((r): Item => ({ key: `r|${r.href}`, type: "recent", ...r })),
        { key: "locate", type: "locate" },
      ];
    }
    return hits.map((h): Item => {
      const g = h.gauges[0];
      const gauge = g ? byName.get(g.station) : undefined;
      if (h.kind === "river") {
        return { key: `r|${h.label}`, type: "result", label: h.label, sub: h.sub, href: basinPath(h.label), river: true };
      }
      return {
        key: `${h.kind}|${h.label}`,
        type: "result",
        label: h.label,
        sub: h.kind === "place" ? h.sub : h.sub,
        href: gauge?.href ?? "/",
        river: false,
        gauge,
        km: h.kind === "place" ? (g as { km: number }).km : undefined,
      };
    });
  }, [hits, byName, recents, trimmed]);

  // Track no-match once per settled query, not per keystroke.
  useEffect(() => {
    if (!noMatch) return;
    const t = setTimeout(() => trackEvent("search_no_match", { query: trimmed.slice(0, 60) }), 800);
    return () => clearTimeout(t);
  }, [noMatch, trimmed]);

  const locate = useCallback(() => {
    trackEvent("find_nearest_clicked");
    if (!navigator.geolocation) {
      setLocError("Location isn't available in this browser.");
      return;
    }
    setLocError(null);
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude: la, longitude: lo } = pos.coords;
        const near = stations
          .filter((s) => Number.isFinite(s.latitude) && Number.isFinite(s.longitude))
          .map((s) => ({ s, km: distanceKm(la, lo, s.latitude, s.longitude) }))
          .sort((a, b) => a.km - b.km)[0];
        setLocating(false);
        if (!near) return;
        trackEvent("find_nearest_success", { nearest: near.s.station, nearest_km: Number(near.km.toFixed(1)) });
        onDone?.();
        router.push(near.s.href);
      },
      (err) => {
        setLocating(false);
        trackEvent("find_nearest_error", { code: err.code });
        setLocError(err.code === err.PERMISSION_DENIED ? "Location permission was denied." : "Couldn't get your location.");
      },
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 5 * 60_000 },
    );
  }, [stations, router, onDone]);

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

  return { query, setQuery, active, setActive, items, noMatch, locating, locError, choose, onKeyDown, refreshRecents, reset, done: onDone };
}

function Rows({ s, listId }: { s: ReturnType<typeof useSearch>; listId: string }) {
  const empty = s.query.trim().length < 2;
  return (
    <>
      {empty && s.items.some((i) => i.type === "recent") && (
        <div className="px-3.5 pt-2.5 pb-1 text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400 font-medium">
          Recent
        </div>
      )}
      <ul id={listId} role="listbox" aria-label="Search results">
        {s.items.map((it, i) => {
          const on = i === s.active;
          return (
            <li
              key={it.key}
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
                  {s.locating ? "Locating…" : "Use my location"}
                  {s.locError && <span className="text-xs text-amber-700 dark:text-amber-300">{s.locError}</span>}
                </span>
              ) : it.type === "recent" ? (
                <span className="flex items-center gap-2 min-w-0">
                  <Clock className="size-3.5 text-slate-400 shrink-0" />
                  <span className="text-sm text-slate-900 dark:text-slate-100 truncate">{it.label}</span>
                  <span className="text-[11px] text-slate-500 dark:text-slate-400 truncate">{it.sub}</span>
                </span>
              ) : (
                <>
                  <span className="min-w-0">
                    <span className="flex items-baseline gap-2">
                      <span className="text-sm font-medium text-slate-900 dark:text-slate-100 truncate">{it.label}</span>
                      <span className="text-[11px] text-slate-500 dark:text-slate-400 truncate">{it.sub}</span>
                    </span>
                    {it.gauge && (
                      <span className="mt-0.5 flex items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400">
                        <span className={`size-1.5 rounded-full shrink-0 ${dot[it.gauge.tier] ?? dot.none}`} />
                        <span className="truncate">
                          → {it.gauge.station} · {it.gauge.basin}
                        </span>
                        {it.gauge.level != null && (
                          <span className="tabular-nums text-slate-700 dark:text-slate-300 shrink-0">
                            {formatLevel(it.gauge.level, it.gauge.unit)}
                          </span>
                        )}
                      </span>
                    )}
                  </span>
                  {it.river ? (
                    <Waves className="size-3.5 text-slate-400 shrink-0" />
                  ) : (
                    <ArrowRight className={`size-3.5 shrink-0 transition ${on ? "text-sky-500" : "text-slate-400"}`} />
                  )}
                </>
              )}
            </li>
          );
        })}
      </ul>
      {s.noMatch && (
        <div className="px-3.5 py-4 text-sm text-slate-500 dark:text-slate-400">
          No match for “{s.query.trim()}”.{" "}
          <Link href="/" onClick={s.done} className="text-sky-700 dark:text-sky-300 underline underline-offset-2">
            Browse all rivers
          </Link>
        </div>
      )}
    </>
  );
}

const PLACEHOLDER = "Search your town or river — Kaduwela, Ratnapura, කැලණි";

export function PlaceSearch({ variant, stations }: Props) {
  return variant === "hero" ? <Hero stations={stations} /> : <HeaderSearch stations={stations} />;
}

function Hero({ stations }: { stations: SearchStation[] }) {
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
      <div className="flex items-center gap-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-sm px-3.5 focus-within:border-sky-400 dark:focus-within:border-sky-700 transition">
        <Search className="size-4 text-slate-400 shrink-0" aria-hidden />
        <input
          type="text"
          role="combobox"
          aria-expanded={showList}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={showList ? `${listId}-${s.active}` : undefined}
          aria-label="Search your town or river"
          inputMode="search"
          enterKeyHint="go"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          placeholder={PLACEHOLDER}
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
          <button type="button" aria-label="Clear" onClick={() => s.reset()} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200">
            <X className="size-4" />
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
        aria-label="Search towns and rivers"
        aria-haspopup="dialog"
        title="Search ( / )"
        className="inline-flex items-center justify-center size-9 rounded-md text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition"
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
            aria-label="Search towns and rivers"
            onKeyDown={onPanelKey}
            className="h-full sm:h-auto w-full sm:max-w-lg flex flex-col bg-white dark:bg-slate-900 sm:rounded-xl sm:border border-slate-200 dark:border-slate-800 sm:shadow-xl overflow-hidden text-slate-900 dark:text-slate-100"
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
                aria-label="Search your town or river"
                inputMode="search"
                enterKeyHint="go"
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
                placeholder={PLACEHOLDER}
                value={s.query}
                onChange={(e) => {
                  s.setQuery(e.target.value);
                  s.setActive(0);
                }}
                onKeyDown={s.onKeyDown}
                className="flex-1 min-w-0 bg-transparent py-3.5 text-base sm:text-sm placeholder:text-slate-400 outline-none"
              />
              <button type="button" onClick={close} aria-label="Close search" className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-1">
                <X className="size-4" />
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
