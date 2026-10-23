"use client";

// Filter bar for the reservoir index: search, status with counts, river, district and sort, kept in
// the URL query. Every row is rendered on the server (so each link is in the HTML for search
// engines); this only hides, shows and reorders them.
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { ArrowRight, ArrowUpDown, ChevronDown, Search, SearchX, SlidersHorizontal, X } from "lucide-react";
import { compareRelease, matches, type SortKey } from "@/lib/reservoirSearch";

export type FilterStatus = "spilling" | "releasing" | "holding" | "nodata";
export type FilterItem = {
  key: string;
  name: string;
  river: string | null;
  district: string | null;
  status: FilterStatus;
  barrage: boolean;
  cusecs: number;
  pct: number | null;
  search: string;
  node: React.ReactNode;
};
/** Texts for the bar; {n}, {m}, {x} and {river} are filled in here. */
export type FilterLabels = Record<
  | "search" | "status" | "all" | "spilling" | "releasing" | "holding" | "nodata" | "river" | "allRivers" | "district" | "allDistricts"
  | "sort" | "sortRelease" | "sortFull" | "sortName" | "filters" | "clear" | "clearAll" | "showing" | "showN" | "remove" | "mapLink"
  | "close" | "clearSearch" | "empty" | "active",
  string
>;

const STATUSES: FilterStatus[] = ["spilling", "releasing", "holding", "nodata"];
const SORTS: SortKey[] = ["release", "full", "name"];
const fill = (s: string, v: Record<string, string | number>) => s.replace(/\{(\w+)\}/g, (m, k: string) => (k in v ? String(v[k]) : m));

type Params = { q: string; status: FilterStatus | ""; river: string; district: string; sort: SortKey };

// The query string is the state. Reading it through useSyncExternalStore keeps the server render
// (no filters) and the first client render identical, then applies the URL.
const EVENT = "rv-filter";
const subscribe = (cb: () => void) => {
  window.addEventListener("popstate", cb);
  window.addEventListener(EVENT, cb);
  return () => {
    window.removeEventListener("popstate", cb);
    window.removeEventListener(EVENT, cb);
  };
};
const snapshot = () => window.location.search;
const serverSnapshot = () => "";

const selectCls =
  "h-11 sm:h-10 w-full appearance-none rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 pl-3 pr-9 text-sm text-slate-800 dark:text-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 truncate";

function Select({ label, value, onChange, children, icon, className = "" }: { label: string; value: string; onChange: (v: string) => void; children: React.ReactNode; icon?: React.ReactNode; className?: string }) {
  return (
    <label className={`relative block min-w-0 ${className}`}>
      <span className="sr-only">{label}</span>
      {icon && <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 dark:text-slate-400">{icon}</span>}
      <select value={value} onChange={(e) => onChange(e.target.value)} className={`${selectCls} ${icon ? "pl-9" : ""}`}>
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-slate-500 dark:text-slate-400" aria-hidden />
    </label>
  );
}

const chipBtn =
  "inline-flex items-center gap-1.5 min-h-11 sm:min-h-9 rounded-full border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 pl-3 pr-2.5 text-sm text-slate-700 dark:text-slate-300 hover:border-sky-300 dark:hover:border-sky-700 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500";

export function ReservoirFilter({
  items,
  rivers,
  riverLabels,
  districts,
  mapLinks,
  lang,
  labels: L,
}: {
  items: FilterItem[];
  rivers: string[];
  riverLabels: Record<string, string>;
  districts: string[];
  mapLinks: Record<string, string>;
  lang: string;
  labels: FilterLabels;
}) {
  const search = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  const params: Params = useMemo(() => {
    const sp = new URLSearchParams(search);
    const status = sp.get("status") as FilterStatus | null;
    const river = sp.get("river") ?? "";
    const district = sp.get("district") ?? "";
    const sort = sp.get("sort") as SortKey | null;
    return {
      q: (sp.get("q") ?? "").slice(0, 80),
      status: status && STATUSES.includes(status) ? status : "",
      river: rivers.includes(river) ? river : "",
      district: districts.includes(district) ? district : "",
      sort: sort && SORTS.includes(sort) ? sort : "release",
    };
  }, [search, rivers, districts]);

  /** Typing replaces the history entry; choosing a filter adds one, so Back undoes it. */
  const update = useCallback((patch: Partial<Params>, mode: "push" | "replace" = "push") => {
    const sp = new URLSearchParams(window.location.search);
    for (const [k, v] of Object.entries(patch)) {
      if (!v || (k === "sort" && v === "release")) sp.delete(k);
      else sp.set(k, v);
    }
    const qs = sp.toString();
    const url = window.location.pathname + (qs ? `?${qs}` : "") + window.location.hash;
    if (mode === "push") window.history.pushState(window.history.state, "", url);
    else window.history.replaceState(window.history.state, "", url);
    window.dispatchEvent(new Event(EVENT));
  }, []);

  const { q, status, river, district, sort } = params;
  const match = useCallback(
    (i: FilterItem, skip?: "status" | "river" | "district") =>
      (skip === "status" || !status || i.status === status) &&
      (skip === "river" || !river || i.river === river) &&
      (skip === "district" || !district || i.district === district) &&
      matches(i.search, q),
    [status, river, district, q],
  );

  const counts = useMemo(() => {
    const st: Record<string, number> = { all: 0, spilling: 0, releasing: 0, holding: 0, nodata: 0 };
    const rv: Record<string, number> = {};
    const di: Record<string, number> = {};
    for (const i of items) {
      if (match(i, "status")) {
        st.all++;
        st[i.status]++;
      }
      if (match(i, "river") && i.river) rv[i.river] = (rv[i.river] ?? 0) + 1;
      if (match(i, "district") && i.district) di[i.district] = (di[i.district] ?? 0) + 1;
    }
    return { st, rv, di };
  }, [items, match]);

  const totalNoData = useMemo(() => items.filter((i) => i.status === "nodata").length, [items]);

  const ordered = useMemo(() => {
    const a = [...items];
    if (sort === "full") a.sort((x, y) => (y.pct ?? -1) - (x.pct ?? -1) || x.name.localeCompare(y.name, lang));
    else if (sort === "name") a.sort((x, y) => x.name.localeCompare(y.name, lang));
    else a.sort(compareRelease);
    return a;
  }, [items, sort, lang]);

  const shown = useMemo(() => new Set(items.filter((i) => match(i)).map((i) => i.key)), [items, match]);
  const n = shown.size;
  const total = items.length;

  const statusLabel = (s: FilterStatus) => L[s];
  const sortLabel = (s: SortKey) => (s === "release" ? L.sortRelease : s === "full" ? L.sortFull : L.sortName);
  const hiddenCount = (river ? 1 : 0) + (district ? 1 : 0) + (sort !== "release" ? 1 : 0);
  const anyFilter = !!(q || status || river || district);
  const clearAll = () => update({ q: "", status: "", river: "", district: "" });

  // Bottom sheet for river, district and sort on narrow screens: a native modal dialog gives the focus trap and Esc.
  const [open, setOpen] = useState(false);
  const dlg = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = dlg.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
    document.body.style.overflow = open ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  const riverSelect = (cls?: string) => (
    <Select label={L.river} value={river} onChange={(v) => update({ river: v })} className={cls}>
      <option value="">{L.allRivers}</option>
      {rivers.map((r) => {
        const c = counts.rv[r] ?? 0;
        return (
          <option key={r} value={r} disabled={c === 0 && r !== river}>
            {riverLabels[r] ?? r} ({c})
          </option>
        );
      })}
    </Select>
  );
  const districtSelect = (cls?: string) => (
    <Select label={L.district} value={district} onChange={(v) => update({ district: v })} className={cls}>
      <option value="">{L.allDistricts}</option>
      {districts.map((d) => {
        const c = counts.di[d] ?? 0;
        return (
          <option key={d} value={d} disabled={c === 0 && d !== district}>
            {d} ({c})
          </option>
        );
      })}
    </Select>
  );

  const seg = (id: string, label: string, count: number, on: boolean, onClick: () => void) => (
    <button
      key={id}
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={`flex min-h-11 sm:min-h-9 min-w-fit flex-1 sm:flex-none flex-col sm:flex-row items-center justify-center sm:gap-1.5 rounded-lg px-1.5 sm:px-3 text-xs sm:text-sm leading-tight transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 ${
        on ? "bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-50 shadow-sm font-medium" : `text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-slate-100 ${count === 0 ? "opacity-50" : ""}`
      }`}
    >
      <span className="whitespace-nowrap">{label}</span>
      <span className="tabular-nums text-slate-500 dark:text-slate-400">{count}</span>
    </button>
  );

  const removable: { id: string; text: string; clear: () => void }[] = [];
  if (q) removable.push({ id: "q", text: `“${q}”`, clear: () => update({ q: "" }) });
  if (status) removable.push({ id: "status", text: statusLabel(status), clear: () => update({ status: "" }) });
  if (river) removable.push({ id: "river", text: riverLabels[river] ?? river, clear: () => update({ river: "" }) });
  if (district) removable.push({ id: "district", text: district, clear: () => update({ district: "" }) });

  return (
    <div>
      <div className="sticky top-[57px] z-20 -mx-4 px-4 sm:-mx-6 sm:px-6 py-2 bg-white/90 dark:bg-slate-950/90 backdrop-blur border-b border-slate-200/70 dark:border-slate-800/70">
        <div className="flex gap-2">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-500 dark:text-slate-400" aria-hidden />
            <input
              type="search"
              value={q}
              onChange={(e) => update({ q: e.target.value }, "replace")}
              placeholder={L.search}
              aria-label={L.search}
              autoComplete="off"
              spellCheck={false}
              enterKeyHint="search"
              className="h-11 sm:h-10 w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 pl-9 pr-10 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-500 dark:placeholder:text-slate-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 [&::-webkit-search-cancel-button]:appearance-none"
            />
            {q && (
              <button type="button" onClick={() => update({ q: "" }, "replace")} aria-label={L.clearSearch} className="absolute right-0 top-1/2 flex size-11 sm:size-10 -translate-y-1/2 items-center justify-center rounded-xl text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500">
                <X className="size-4" aria-hidden />
              </button>
            )}
          </div>
          {riverSelect("hidden sm:block sm:w-48")}
          {districtSelect("hidden sm:block sm:w-40")}
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="sm:hidden relative inline-flex h-11 shrink-0 items-center gap-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 text-sm text-slate-800 dark:text-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
          >
            <SlidersHorizontal className="size-4" aria-hidden />
            {L.filters}
            {hiddenCount > 0 && (
              <span className="inline-flex min-w-5 h-5 items-center justify-center rounded-full bg-sky-600 dark:bg-sky-500 px-1 text-xs font-medium text-white dark:text-slate-950 tabular-nums">{hiddenCount}</span>
            )}
          </button>
        </div>
        <div className="mt-2 flex items-center justify-between gap-2">
          <div role="group" aria-label={L.status} className="flex w-full sm:w-auto gap-0.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden rounded-xl bg-slate-100 dark:bg-slate-800/70 p-1">
            {seg("all", L.all, counts.st.all, !status, () => update({ status: "" }))}
            {STATUSES.filter((s) => s !== "nodata" || totalNoData > 0).map((s) => seg(s, statusLabel(s), counts.st[s], status === s, () => update({ status: status === s ? "" : s })))}
          </div>
          <Select label={L.sort} value={sort} onChange={(v) => update({ sort: v as SortKey })} icon={<ArrowUpDown className="size-4" />} className="hidden sm:block w-44">
            {SORTS.map((s) => <option key={s} value={s}>{sortLabel(s)}</option>)}
          </Select>
        </div>
      </div>

      <div className="mt-3 mb-3 flex flex-wrap items-center gap-2" >
        <p role="status" aria-live="polite" className="mr-1 text-sm text-slate-600 dark:text-slate-300 tabular-nums">
          {fill(L.showing, { n, m: total })}
        </p>
        {removable.length > 0 && (
          <ul className="contents" aria-label={L.active}>
            {removable.map((r) => (
              <li key={r.id}>
                <button type="button" onClick={r.clear} aria-label={fill(L.remove, { x: r.text })} className={chipBtn}>
                  <span className="max-w-[12rem] truncate">{r.text}</span>
                  <X className="size-3.5 shrink-0 text-slate-500 dark:text-slate-400" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        )}
        {anyFilter && (
          <button type="button" onClick={clearAll} className="inline-flex items-center min-h-11 sm:min-h-9 rounded-full px-2 text-sm font-medium text-sky-700 dark:text-sky-400 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500">
            {L.clearAll}
          </button>
        )}
      </div>

      {river && mapLinks[river] && (
        <p className="mb-3">
          <Link href={mapLinks[river]} className="inline-flex items-center gap-1.5 min-h-11 sm:min-h-9 text-sm font-medium text-sky-700 dark:text-sky-400 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 rounded">
            {fill(L.mapLink, { river: riverLabels[river] ?? river })}
            <ArrowRight className="size-4" aria-hidden />
          </Link>
        </p>
      )}

      <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {ordered.map((i) => (
          <li key={i.key} className="min-w-0" hidden={!shown.has(i.key)}>{i.node}</li>
        ))}
      </ul>
      {n === 0 && (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-slate-300 dark:border-slate-700 px-4 py-10 text-center">
          <SearchX className="size-7 text-slate-400 dark:text-slate-500" aria-hidden />
          <p className="text-sm text-slate-700 dark:text-slate-300">{L.empty}</p>
          <button type="button" onClick={clearAll} className="inline-flex items-center min-h-11 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-4 text-sm font-medium text-slate-800 dark:text-slate-200 hover:border-sky-300 dark:hover:border-sky-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500">
            {L.clear}
          </button>
        </div>
      )}

      <dialog
        ref={dlg}
        aria-label={L.filters}
        onClose={() => setOpen(false)}
        onClick={(e) => { if (e.target === e.currentTarget) setOpen(false); }}
        className="m-0 mt-auto w-full max-w-none max-h-[88dvh] overflow-y-auto rounded-t-2xl border border-b-0 border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-0 text-slate-900 dark:text-slate-100 backdrop:bg-slate-950/50"
      >
        <div className="flex items-center justify-between px-4 pt-3">
          <h2 className="text-base font-semibold">{L.filters}</h2>
          <button type="button" onClick={() => setOpen(false)} aria-label={L.close} className="flex size-11 items-center justify-center rounded-xl text-slate-600 dark:text-slate-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500">
            <X className="size-5" aria-hidden />
          </button>
        </div>
        <div className="space-y-4 px-4 pb-3">
          <div>
            <span className="mb-1 block text-xs font-medium text-slate-500 dark:text-slate-400">{L.river}</span>
            {riverSelect()}
          </div>
          <div>
            <span className="mb-1 block text-xs font-medium text-slate-500 dark:text-slate-400">{L.district}</span>
            {districtSelect()}
          </div>
          <fieldset>
            <legend className="mb-1 text-xs font-medium text-slate-500 dark:text-slate-400">{L.sort}</legend>
            <div className="divide-y divide-slate-100 dark:divide-slate-800 rounded-xl border border-slate-200 dark:border-slate-700">
              {SORTS.map((s) => (
                <label key={s} className="flex min-h-11 cursor-pointer items-center gap-3 px-3 text-sm has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-sky-500 has-[:focus-visible]:rounded-xl">
                  <input type="radio" name="rv-sort" checked={sort === s} onChange={() => update({ sort: s })} className="size-4 accent-sky-600" />
                  {sortLabel(s)}
                </label>
              ))}
            </div>
          </fieldset>
        </div>
        <div className="sticky bottom-0 flex gap-2 border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-4 py-3">
          {anyFilter || sort !== "release" ? (
            <button type="button" onClick={() => update({ q: "", status: "", river: "", district: "", sort: "release" })} className="min-h-12 rounded-xl border border-slate-200 dark:border-slate-700 px-4 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500">
              {L.clear}
            </button>
          ) : null}
          <button type="button" onClick={() => setOpen(false)} className="min-h-12 flex-1 rounded-xl bg-sky-600 dark:bg-sky-500 px-4 text-sm font-medium text-white dark:text-slate-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2">
            {fill(L.showN, { n })}
          </button>
        </div>
      </dialog>
    </div>
  );
}
