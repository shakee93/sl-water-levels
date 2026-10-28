"use client";

// The /embed page's builder: pick a widget and what it shows, set the options, see the real widget in a live preview and copy the code.
// Prefilled from the address (?w=river&id=kalu-ganga&unit=m ...), which is how every river, gauge and town page's "Embed this on your site"
// button opens it. Labels are English for now (the page text around it follows the site language).
import { useEffect, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";
import { DEFAULTS, USES, WIDGETS, cfgQuery, fixedHeight, isWidget, parseCfg, type EmbedCfg, type Widget } from "@/lib/embedConfig";
import type { Locale } from "@/lib/i18n/config";

export type BuilderLists = {
  rivers: { slug: string; name: string; count: number }[];
  gauges: { slug: string; name: string; river: string }[];
  towns: { slug: string; name: string }[];
};

const NAMES: Record<Widget, { name: string; hint: string }> = {
  river: { name: "River", hint: "All gauges of one river" },
  gauge: { name: "Gauge", hint: "One gauge with marks and chart" },
  town: { name: "Town", hint: "Flood status for a town" },
  now: { name: "Right now", hint: "Gauges at Alert or above" },
  reservoirs: { name: "Reservoirs", hint: "Spilling or releasing now" },
  ticker: { name: "Ticker", hint: "One line for a header bar" },
};

const field = "block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1";
const select = "w-full h-11 sm:h-10 rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500";

function Seg<T extends string | number>({ label, value, options, onChange }: { label: string; value: T; options: { v: T; l: string }[]; onChange: (v: T) => void }) {
  return (
    <div>
      <span className={field} id={`seg-${label}`}>{label}</span>
      <div role="radiogroup" aria-labelledby={`seg-${label}`} className="inline-flex max-w-full rounded-md border border-slate-300 dark:border-slate-700 overflow-hidden">
        {options.map((o) => (
          <button
            key={String(o.v)}
            type="button"
            role="radio"
            aria-checked={value === o.v}
            onClick={() => onChange(o.v)}
            className={`min-h-11 sm:min-h-9 px-2.5 sm:px-3 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sky-500 ${value === o.v ? "bg-sky-600 text-white" : "bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800"}`}
          >
            {o.l}
          </button>
        ))}
      </div>
    </div>
  );
}

function Toggle({ label, on, onChange }: { label: string; on: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="inline-flex items-center gap-2 min-h-11 sm:min-h-9 text-sm text-slate-700 dark:text-slate-200 cursor-pointer">
      <input type="checkbox" checked={on} onChange={(e) => onChange(e.target.checked)} className="size-4 accent-sky-600" />
      {label}
    </label>
  );
}

/** Reads the prefilled settings from the address after the page loads (so the page itself stays static), then shows the builder. */
export function EmbedBuilder(props: { lists: BuilderLists; lang: Locale; origin: string }) {
  const [init, setInit] = useState<Record<string, string> | null>(null);
  useEffect(() => {
    const o: Record<string, string> = {};
    new URLSearchParams(window.location.search).forEach((v, k) => (o[k] = v));
    setInit(o);
  }, []);
  if (!init) return <div className="mt-5 min-h-[40rem] rounded-xl border border-slate-200 dark:border-slate-800" aria-hidden />;
  return <Builder {...props} init={init} />;
}

function Builder({ lists, lang, origin, init }: { lists: BuilderLists; lang: Locale; origin: string; init: Record<string, string> }) {
  const [widget, setWidget] = useState<Widget>(isWidget(init.w) ? init.w : "river");
  const [cfg, setCfg] = useState<EmbedCfg>(() => ({ ...parseCfg(init), lang: init.lang ? parseCfg(init).lang : lang }));
  const [id, setId] = useState<string>(init.id ?? "");
  const [tickerBy, setTickerBy] = useState<"river" | "gauge">(init.gauge ? "gauge" : "river");
  const [wide, setWide] = useState(false);
  const [script, setScript] = useState(true);
  const [copied, setCopied] = useState(false);
  const [h, setH] = useState<number | null>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const set = <K extends keyof EmbedCfg>(k: K, v: EmbedCfg[K]) => setCfg((c) => ({ ...c, [k]: v }));
  const uses = USES[widget];

  // a sensible id when the widget needs one and none (or one of another kind) is chosen
  const idOk = widget === "river" ? lists.rivers.some((r) => r.slug === id) : widget === "gauge" ? lists.gauges.some((g) => g.slug === id) : widget === "town" ? lists.towns.some((x) => x.slug === id) : true;
  const effId = idOk ? id : widget === "river" ? "kalu-ganga" : widget === "gauge" ? "rathnapura" : widget === "town" ? "ratnapura" : "";

  const path = widget === "river" || widget === "gauge" || widget === "town" ? `/embed/${widget}/${effId}` : `/embed/${widget}`;
  const query = cfgQuery({ ...cfg, gauge: widget === "ticker" && tickerBy === "gauge" ? cfg.gauge : null, rivers: widget === "ticker" && tickerBy === "gauge" ? [] : cfg.rivers }, widget);
  const rel = `${path}${query}`;
  const nGauges = widget === "river" ? lists.rivers.find((r) => r.slug === effId)?.count ?? 4 : widget === "now" ? 4 : 4;
  const fixed = fixedHeight(widget, cfg.size, nGauges);
  const title = widget === "river" ? `${lists.rivers.find((r) => r.slug === effId)?.name ?? ""} live river levels` : widget === "gauge" ? `${lists.gauges.find((g) => g.slug === effId)?.name ?? ""} live river level` : widget === "town" ? `${lists.towns.find((x) => x.slug === effId)?.name ?? ""} flood status` : widget === "now" ? "Sri Lanka rivers right now" : widget === "reservoirs" ? "Reservoirs spilling in Sri Lanka" : "Live river level";
  const code =
    `<iframe src="${origin}${rel}" width="100%" height="${fixed}" style="border:0;max-width:${widget === "ticker" ? "760" : "560"}px" loading="lazy" title="${title.trim()}"></iframe>` +
    (script ? `\n<script src="${origin}/embed.js" async></script>` : "");

  // the preview is the real widget, and it sizes itself the same way the optional script would
  useEffect(() => setH(null), [rel]);
  useEffect(() => {
    const on = (e: MessageEvent) => {
      if (e.source === frame.current?.contentWindow && e.data?.type === "waterlevels-embed-height" && typeof e.data.h === "number") setH(Math.ceil(e.data.h));
    };
    window.addEventListener("message", on);
    return () => window.removeEventListener("message", on);
  }, []);

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* the text is selectable in the box */
    }
  }

  const toggleRiver = (slug: string) => set("rivers", cfg.rivers.includes(slug) ? cfg.rivers.filter((x) => x !== slug) : [...cfg.rivers, slug]);

  return (
    <div className="mt-5 grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
      <div className="min-w-0 space-y-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
        <div>
          <span className={field}>1. What to embed</span>
          <div className="grid grid-cols-2 gap-2">
            {WIDGETS.map((w) => (
              <button
                key={w}
                type="button"
                aria-pressed={widget === w}
                onClick={() => setWidget(w)}
                className={`min-w-0 text-left rounded-lg border px-2.5 sm:px-3 py-2 min-h-11 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 ${widget === w ? "border-sky-600 bg-sky-50 dark:bg-sky-950/40" : "border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800"}`}
              >
                <span className="block text-sm font-semibold break-words">{NAMES[w].name}</span>
                <span className="block text-xs text-slate-500 dark:text-slate-400 leading-snug break-words">{NAMES[w].hint}</span>
              </button>
            ))}
          </div>
        </div>

        {widget === "river" && (
          <label className="block">
            <span className={field}>River</span>
            <select className={select} value={effId} onChange={(e) => setId(e.target.value)}>
              {lists.rivers.map((r) => <option key={r.slug} value={r.slug}>{r.name} ({r.count})</option>)}
            </select>
          </label>
        )}
        {widget === "gauge" && (
          <label className="block">
            <span className={field}>Gauge</span>
            <select className={select} value={effId} onChange={(e) => setId(e.target.value)}>
              {[...new Set(lists.gauges.map((g) => g.river))].map((rv) => (
                <optgroup key={rv} label={rv}>
                  {lists.gauges.filter((g) => g.river === rv).map((g) => <option key={g.slug} value={g.slug}>{g.name}</option>)}
                </optgroup>
              ))}
            </select>
          </label>
        )}
        {widget === "town" && (
          <label className="block">
            <span className={field}>Town</span>
            <select className={select} value={effId} onChange={(e) => setId(e.target.value)}>
              {lists.towns.map((x) => <option key={x.slug} value={x.slug}>{x.name}</option>)}
            </select>
          </label>
        )}
        {widget === "ticker" && (
          <div className="space-y-2">
            <Seg label="Follow" value={tickerBy} options={[{ v: "river", l: "A river (or all)" }, { v: "gauge", l: "One gauge" }]} onChange={setTickerBy} />
            {tickerBy === "gauge" && (
              <select className={select} aria-label="Gauge" value={cfg.gauge ?? ""} onChange={(e) => set("gauge", e.target.value || null)}>
                <option value="">Choose a gauge</option>
                {lists.gauges.map((g) => <option key={g.slug} value={g.slug}>{g.name} · {g.river}</option>)}
              </select>
            )}
          </div>
        )}
        {uses.filter !== "none" && !(widget === "ticker" && tickerBy === "gauge") && (
          <fieldset>
            <legend className={field}>{widget === "ticker" ? "River (shows the highest step; none = all Sri Lanka)" : "Only these rivers (none = all)"}</legend>
            <div className="flex flex-wrap gap-1.5 max-h-40 overflow-auto">
              {lists.rivers.map((r) => (
                <button key={r.slug} type="button" aria-pressed={cfg.rivers.includes(r.slug)} onClick={() => (widget === "ticker" ? set("rivers", cfg.rivers[0] === r.slug ? [] : [r.slug]) : toggleRiver(r.slug))} className={`rounded-full border px-2.5 min-h-9 text-xs transition-colors ${cfg.rivers.includes(r.slug) ? "border-sky-600 bg-sky-600 text-white" : "border-slate-300 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800"}`}>
                  {r.name}
                </button>
              ))}
            </div>
          </fieldset>
        )}

        <div className="flex flex-wrap gap-x-4 gap-y-3 min-w-0">
          {widget !== "ticker" && <Seg label="Size" value={cfg.size} options={[{ v: "full", l: "Full" }, { v: "compact", l: "Compact" }]} onChange={(v) => set("size", v)} />}
          <Seg label="Language" value={cfg.lang} options={[{ v: "en", l: "English" }, { v: "si", l: "සිංහල" }, { v: "ta", l: "தமிழ்" }]} onChange={(v) => set("lang", v)} />
          <Seg label="Theme" value={cfg.theme} options={[{ v: "auto", l: "Match page" }, { v: "light", l: "Light" }, { v: "dark", l: "Dark" }]} onChange={(v) => set("theme", v)} />
          {uses.unit && <Seg label="Units" value={cfg.unit} options={[{ v: "ft", l: "Feet" }, { v: "m", l: "Metres" }]} onChange={(v) => set("unit", v)} />}
          {uses.hours && cfg.size === "full" && <Seg label="Chart" value={cfg.hours} options={[{ v: 0, l: "None" }, { v: 24, l: "24 h" }, { v: 72, l: "72 h" }]} onChange={(v) => set("hours", v)} />}
        </div>
        {(uses.forecast || uses.marks) && (
          <div className="flex flex-wrap gap-x-5">
            {uses.forecast && <Toggle label="Next-hour forecast" on={cfg.forecast} onChange={(v) => set("forecast", v)} />}
            {uses.marks && <Toggle label="Official flood marks" on={cfg.marks} onChange={(v) => set("marks", v)} />}
          </div>
        )}
        {uses.unit && cfg.unit === "m" && <p className="text-xs text-slate-500 dark:text-slate-400">Levels and the official marks are shown in metres, as in the Department&apos;s bulletins (Nagalagam Street is converted).</p>}
      </div>

      <div className="min-w-0 space-y-4">
        <div>
          <div className="flex flex-wrap items-end justify-between gap-x-3 gap-y-2 mb-1.5">
            <span className={field.replace("mb-1", "mb-0")}>Live preview (the real widget)</span>
            <Seg label="Preview width" value={wide ? "wide" : "narrow"} options={[{ v: "narrow", l: "Phone" }, { v: "wide", l: "Wide" }]} onChange={(v) => setWide(v === "wide")} />
          </div>
          <div className="rounded-xl border border-dashed border-slate-300 dark:border-slate-700 bg-slate-100/60 dark:bg-slate-800/40 p-2 sm:p-3 overflow-hidden">
            <div className="mx-auto min-w-0" style={{ width: wide ? "100%" : 340, maxWidth: "100%" }}>
              <iframe ref={frame} key={rel} src={rel} title="Preview" width="100%" style={{ border: 0, height: h ?? fixed, display: "block" }} />
            </div>
          </div>
        </div>
        <div>
          <div className="flex items-center justify-between gap-x-3 mb-1.5 flex-wrap">
            <label htmlFor="embed-code" className="text-xs font-medium text-slate-600 dark:text-slate-300">Code to paste into your page</label>
            <Toggle label="Include the resize script" on={script} onChange={setScript} />
          </div>
          <textarea id="embed-code" readOnly wrap="off" value={code} rows={3} onFocus={(e) => e.currentTarget.select()} className="block w-full max-w-full overflow-x-auto whitespace-pre rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 p-3 font-mono text-xs leading-relaxed" />
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2">
            <button type="button" onClick={copy} className="inline-flex items-center gap-2 h-11 sm:h-10 px-4 rounded-md bg-sky-600 text-white text-sm font-semibold hover:bg-sky-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2">
              {copied ? <Check className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />}
              {copied ? "Copied" : "Copy code"}
            </button>
            <span className="sr-only" aria-live="polite">{copied ? "Code copied" : ""}</span>
            <p className="min-w-0 flex-1 basis-48 text-xs text-slate-500 dark:text-slate-400">The script is optional: it makes the box grow to fit. Without it the box keeps the height above.</p>
          </div>
          <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">Free to use: keep the credit link inside the box. Not an official warning service. Defaults ({DEFAULTS.unit}, {DEFAULTS.theme}, {DEFAULTS.size}) are left out of the address.</p>
        </div>
      </div>
    </div>
  );
}
