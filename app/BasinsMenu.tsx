"use client";

// Desktop header "Basins" mega-menu. The list (name, worst official step, gauge count) is computed on the server from the
// already-cached national fetch and passed in as props: opening it never makes a request. Closes on outside pointer-down,
// Escape (focus returns to the button), focus leaving, choosing a river and any route change.
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronDown, Search } from "lucide-react";
import { useI18n } from "./LocaleProvider";
import { TierPill, type PillTier } from "./TierPill";
import { useNavSection } from "@/lib/navActive";
import { navGroups } from "@/lib/navGroups";
import { BASINS_MENU } from "@/lib/i18n/basinsMenu";

export type BasinItem = { basin: string; slug: string; label: string; href: string; tier: PillTier; n: number; search: string };

const ring = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500";
const fold = (s: string) => s.normalize("NFKD").toLowerCase();
const HOT = new Set<PillTier>(["alert", "minor", "major"]);

export function BasinsMenu({ items, label }: { items: BasinItem[]; label: string }) {
  const { t, p, lang } = useI18n();
  const s = BASINS_MENU[lang];
  const pathname = usePathname();
  const current = useNavSection(useMemo(() => items.map((b) => b.slug), [items])) === "basins";
  const id = useId();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const [shift, setShift] = useState<number | null>(null);

  // Keep the wide panel inside the viewport (16 px gutters): right-aligned to the button, nudged when that would overflow.
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const r = root.current?.getBoundingClientRect();
      if (!r) return;
      const w = Math.min(704, window.innerWidth - 32);
      let left = r.width - w;
      if (r.left + left < 16) left = 16 - r.left;
      if (r.left + left + w > window.innerWidth - 16) left = window.innerWidth - 16 - w - r.left;
      setShift(left);
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [open]);

  const close = useCallback((refocus = false) => {
    setOpen(false);
    setShift(null);
    setQ("");
    setActive(0);
    if (refocus) btn.current?.focus();
  }, []);

  // Route change closes it.
  const [seen, setSeen] = useState(pathname);
  if (seen !== pathname) {
    setSeen(pathname);
    if (open) close();
  }

  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) close();
    };
    const focusOut = (e: FocusEvent) => {
      const to = e.relatedTarget as Node | null;
      if (to && !root.current?.contains(to)) close();
    };
    document.addEventListener("pointerdown", down, true);
    const r = root.current;
    r?.addEventListener("focusout", focusOut);
    return () => {
      document.removeEventListener("pointerdown", down, true);
      r?.removeEventListener("focusout", focusOut);
    };
  }, [open, close]);

  const { hot, rest, flat } = useMemo(() => {
    const f = fold(q.trim());
    const rows = items.filter((b) => !f || fold(b.search).includes(f));
    const hot = rows.filter((b) => HOT.has(b.tier)).sort((a, b) => ["major", "minor", "alert"].indexOf(a.tier) - ["major", "minor", "alert"].indexOf(b.tier) || a.basin.localeCompare(b.basin));
    const rest = rows.filter((b) => !HOT.has(b.tier));
    return { hot, rest, flat: [...hot, ...rest] };
  }, [items, q]);

  const footer = useMemo(() => {
    const links = navGroups(lang, t as never)[0].items;
    const by = (h: string) => links.find((l) => l.href === h)!;
    return [{ href: "/", label: s.allBasins, event: "home_nav_click" }, by("/rain"), by("/colombo-canals"), by("/reservoirs")];
  }, [lang, t, s]);

  // Focus the filter once the panel is placed (it is visibility:hidden until then, which cannot take focus).
  useEffect(() => {
    if (open && shift !== null) input.current?.focus();
  }, [open, shift !== null]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    list.current?.querySelector(`[data-idx="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const go = (i: number) => (document.getElementById(`${id}-o${i}`) as HTMLAnchorElement | null)?.click();

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close(true);
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!flat.length) return;
      setActive((a) => (e.key === "ArrowDown" ? (a + 1) % flat.length : (a - 1 + flat.length) % flat.length));
    } else if (e.key === "Home" || e.key === "End") {
      if (e.target === input.current) return;
      e.preventDefault();
      setActive(e.key === "Home" ? 0 : Math.max(0, flat.length - 1));
    } else if (e.key === "Enter" && e.target === input.current && flat.length) {
      e.preventDefault();
      go(Math.min(active, flat.length - 1));
    }
  };

  const row = (b: BasinItem, i: number) => {
    const isActive = i === active;
    const tier = b.tier;
    return (
      <Link
        key={b.basin}
        id={`${id}-o${i}`}
        role="option"
        aria-selected={isActive}
        data-idx={i}
        href={b.href}
        tabIndex={-1}
        onClick={() => close()}
        onMouseMove={() => i !== active && setActive(i)}
        data-umami-event="basin_nav_click"
        data-umami-event-basin={b.basin}
        className={`flex items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-sm transition-colors ${
          isActive ? "bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-slate-100" : "text-slate-700 dark:text-slate-300"
        }`}
      >
        <span className="min-w-0">
          <span className="block truncate">{b.label}</span>
          <span className="block text-xs text-slate-500 dark:text-slate-400">{b.n === 1 ? s.gauge1 : s.gauges.replace("{n}", String(b.n))}</span>
        </span>
        {HOT.has(tier) ? <TierPill label={t(`tier.${tier}` as "tier.alert")} tier={tier} /> : <Dot tier={tier} label={t(`tier.${tier}` as "tier.normal")} />}
      </Link>
    );
  };

  return (
    <div ref={root} className="relative hidden sm:block" onKeyDown={open ? onKey : undefined}>
      <button
        ref={btn}
        type="button"
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-current={current ? "true" : undefined}
        aria-controls={`${id}-panel`}
        onClick={() => (open ? close() : setOpen(true))}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" && !open) {
            e.preventDefault();
            setOpen(true);
          }
        }}
        className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 transition ${ring} ${current ? "text-sky-700 dark:text-sky-300 font-medium" : "text-slate-700 dark:text-slate-300"} ${open ? "bg-slate-100 dark:bg-slate-800" : ""}`}
      >
        {label}
        <ChevronDown className={`size-3.5 text-slate-400 transition-transform ${open ? "rotate-180" : ""}`} aria-hidden />
      </button>

      {open && (
        <div
          id={`${id}-panel`}
          style={{ left: shift ?? undefined, visibility: shift === null ? "hidden" : undefined }}
          className="basins-panel absolute top-full mt-2 z-50 w-[min(44rem,calc(100vw-2rem))] rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-lg overflow-hidden flex flex-col max-h-[min(34rem,calc(100vh-5rem))]"
        >
          <div className="p-2 border-b border-slate-200 dark:border-slate-800">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-slate-400" aria-hidden />
              <input
                ref={input}
                type="text"
                role="combobox"
                aria-expanded="true"
                aria-controls={`${id}-list`}
                aria-activedescendant={flat.length ? `${id}-o${Math.min(active, flat.length - 1)}` : undefined}
                aria-autocomplete="list"
                aria-label={s.filter}
                placeholder={s.filter}
                value={q}
                onChange={(e) => {
                  setQ(e.target.value);
                  setActive(0);
                }}
                autoComplete="off"
                spellCheck={false}
                className={`w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 pl-8 pr-3 py-1.5 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 ${ring}`}
              />
            </div>
          </div>

          <div ref={list} id={`${id}-list`} role="listbox" aria-label={label} className="basins-scroll overflow-y-auto p-2 min-h-0">
            {flat.length === 0 && <p className="px-2 py-6 text-center text-sm text-slate-500 dark:text-slate-400">{s.none}</p>}
            {hot.length > 0 && (
              <div role="group" aria-label={s.attention}>
                <p className="px-2.5 pb-1 pt-0.5 text-xs font-semibold text-amber-800 dark:text-amber-300">{s.attention}</p>
                <div className="grid grid-cols-2 gap-x-1 gap-y-0.5 pb-2">{hot.map((b, i) => row(b, i))}</div>
              </div>
            )}
            {rest.length > 0 && (
              <div role="group" aria-label={s.all}>
                {hot.length > 0 && <p className="px-2.5 pb-1 pt-1 text-xs font-semibold text-slate-500 dark:text-slate-400">{s.all}</p>}
                <div className="grid grid-cols-2 lg:grid-cols-3 gap-x-1 gap-y-0.5">{rest.map((b, i) => row(b, hot.length + i))}</div>
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-x-1 gap-y-1 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/50 px-2 py-1.5 text-sm">
            {footer.map((l) => (
              <Link
                key={l.href}
                href={p(l.href)}
                onClick={() => close()}
                data-umami-event={l.event}
                className={`rounded-md px-2.5 py-1 text-slate-700 dark:text-slate-300 hover:bg-slate-200/70 dark:hover:bg-slate-800 ${ring}`}
              >
                {l.label}
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Dot({ tier, label }: { tier: PillTier; label: string }) {
  const c = tier === "normal" ? "bg-emerald-500" : "bg-slate-400";
  return (
    <span className="inline-flex shrink-0 items-center" title={label}>
      <span className={`size-2 rounded-full ${c}`} aria-hidden />
      <span className="sr-only">{label}</span>
    </span>
  );
}
