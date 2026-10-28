"use client";

// The widgets that carry the chart (gauge, forecast, card): one client shell (refresh every 5 minutes from /api/embed, height to the
// parent window, one analytics event). The other widgets are static HTML (views.tsx + the static route), with no React in the browser.
import { useCallback, useEffect, useRef, useState } from "react";
import type { EmbedCfg, Widget } from "@/lib/embedConfig";
import { styleOf } from "@/lib/embedStyle";
import { EmbedChart } from "./EmbedChart";
import { ArrowIcon, CARD, MarksBar, Shell, StaticView, Trend } from "./views";
import { StepWord, TierPill } from "@/app/TierPill";
import type { CardPayload, EmbedPayload, ForecastPayload, GaugePayload } from "@/lib/embedTypes";

const REFRESH_MS = 5 * 60_000;

function GaugeView({ p }: { p: GaugePayload }) {
  const r = p.row;
  const full = p.cfg.size === "full";
  return (
    <Shell p={p} tone={r.tier}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-base sm:text-lg font-semibold leading-snug">{p.title}</h1>
          <p className="text-xs text-slate-500 dark:text-slate-400">{p.river}</p>
        </div>
        <TierPill label={r.step} tier={r.tier} />
      </div>
      <p className="mt-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className={`text-3xl sm:text-4xl font-semibold tabular-nums leading-none ${r.level ? "" : "text-slate-400"}`}>{r.level ?? "—"}</span>
        <Trend row={r} />
      </p>
      {r.outcome && <p className="mt-1.5 text-sm font-medium">{r.outcome}</p>}
      {(r.next || r.cross) && (
        <p className="mt-2 flex flex-wrap items-center gap-x-2 text-sm text-slate-700 dark:text-slate-300">
          <ArrowIcon a={r.nextArrow} className="size-4" />
          <span>{r.next}</span>
          {r.cross && <span className="font-semibold">· {r.cross}</span>}
        </p>
      )}
      {r.time && <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400 tabular-nums">{r.time}{r.age ? ` · ${r.age}` : ""}</p>}
      {p.bar && <MarksBar bar={p.bar} />}
      {full && p.chart && <EmbedChart chart={p.chart} lang={p.cfg.lang} station={p.row.key} accent={p.cfg.accent} />}
    </Shell>
  );
}

// ---- forecast: the prediction box and the forecasting chart -------------------------------------------------------------------------------


function ForecastView({ p }: { p: ForecastPayload }) {
  const r = p.row;
  const full = p.cfg.size === "full";
  return (
    <Shell p={p} tone={p.tone}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 [overflow-wrap:anywhere]">
          <h1 className="text-base sm:text-lg font-semibold leading-snug">{p.title}</h1>
          <p className="text-xs text-slate-500 dark:text-slate-400">{p.river}</p>
        </div>
        <TierPill label={p.verdict} tier={p.tone} />
      </div>
      <p className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className={`text-3xl font-semibold tabular-nums leading-none ${r.level ? "" : "text-slate-400"}`}>{r.level ?? "—"}</span>
        <Trend row={r} />
        {r.time && <span className="text-xs text-slate-500 dark:text-slate-400 tabular-nums">{r.time}{r.age ? ` · ${r.age}` : ""}</span>}
      </p>
      {p.noForecast && <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">{p.forecastLabel}</p>}
      {(p.hour || p.day) && (
        <div className={`mt-3 grid gap-2 ${p.hour && p.day ? "grid-cols-1 min-[440px]:grid-cols-2" : ""}`}>
          {p.hour && (
            <div className="emb-tile rounded-lg bg-white/80 dark:bg-slate-800/60 border border-slate-200/70 dark:border-slate-700/50 px-3 py-2">
              <p className="text-xs text-slate-500 dark:text-slate-400">{p.hour.label}</p>
              <p className="mt-0.5 flex items-start gap-1.5 text-sm font-semibold leading-snug"><span className="mt-0.5 shrink-0"><ArrowIcon a={p.hour.arrow} /></span>{p.hour.title}</p>
              {p.hour.sub && <p className="mt-0.5 text-xs text-slate-600 dark:text-slate-400 tabular-nums">{p.hour.sub}</p>}
            </div>
          )}
          {p.day && (
            <div className="emb-tile rounded-lg bg-white/80 dark:bg-slate-800/60 border border-slate-200/70 dark:border-slate-700/50 px-3 py-2">
              <p className="text-xs text-slate-500 dark:text-slate-400">{p.day.label}</p>
              <p className="mt-0.5 text-sm font-semibold leading-snug">{p.day.text}</p>
            </div>
          )}
        </div>
      )}
      {p.action && <p className="emb-tile mt-2.5 rounded-lg bg-slate-100 dark:bg-slate-800 px-3 py-2 text-sm font-medium">{p.action}</p>}
      {full && p.chart && <EmbedChart chart={p.chart} lang={p.cfg.lang} station={p.row.key} accent={p.cfg.accent} />}
      {full && p.note && <p className="mt-2.5 text-xs text-slate-500 dark:text-slate-400">{p.note}</p>}
    </Shell>
  );
}

// ---- card: the simplest box, one gauge, verdict first ----------------------------------------------------------------------------------

function CardView({ p }: { p: CardPayload }) {
  const r = p.row;
  const full = p.cfg.size === "full";
  return (
    <Shell p={p} tone={r.tier}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="emb-title text-base sm:text-lg font-semibold leading-snug">{p.title}</h1>
          <p className="text-xs text-slate-500 dark:text-slate-400">{p.river}</p>
        </div>
        {!r.since && <TierPill label={r.step} tier={r.tier} />}
      </div>
      {r.since ? (
        <p className="mt-3 text-sm font-medium">{r.since}</p>
      ) : (
        <>
          <p className="mt-2.5 flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className={`text-4xl font-semibold tabular-nums leading-none ${r.level ? "" : "text-slate-400"}`}>{r.level ?? "—"}</span>
            <Trend row={r} />
          </p>
          {r.outcome && <p className="mt-1.5 text-sm font-medium">{r.outcome}</p>}
          {full && (r.next || r.cross) && (
            <p className="mt-1.5 flex flex-wrap items-center gap-x-2 text-sm text-slate-700 dark:text-slate-300">
              <ArrowIcon a={r.nextArrow} className="size-4" />
              <span>{r.next}</span>
              {r.cross && <span className="font-semibold">· {r.cross}</span>}
            </p>
          )}
          {full && p.bar && <MarksBar bar={p.bar} />}
          {full && p.chart && <EmbedChart chart={p.chart} lang={p.cfg.lang} station={p.row.key} accent={p.cfg.accent} compact />}
          {r.time && <p className="mt-2 text-xs text-slate-500 dark:text-slate-400 tabular-nums">{r.time}{r.age ? ` · ${r.age}` : ""}</p>}
        </>
      )}
    </Shell>
  );
}

// ---- the shell -------------------------------------------------------------------------------------------------------------------------

function View({ p }: { p: EmbedPayload }) {
  switch (p.kind) {
    case "card": return <CardView p={p} />;
    case "gauge": return <GaugeView p={p} />;
    case "forecast": return <ForecastView p={p} />;
    default: return <StaticView p={p} />;
  }
}

export function EmbedApp({ initial, api, cfg, widget }: { initial: EmbedPayload | null; api: string; cfg: EmbedCfg; widget: Widget }) {
  const [data, setData] = useState<EmbedPayload | null>(initial);
  const wrap = useRef<HTMLDivElement>(null);
  const last = useRef(0);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(api, { cache: "default" });
      if (!res.ok) return;
      const j = (await res.json()) as EmbedPayload;
      setData(j);
      last.current = Date.now();
    } catch {
      /* keep what is on screen; try again next time */
    }
  }, [api]);

  // the 5-minute refresh (30 s while there is nothing to show), and a refresh when the tab comes back after a while
  useEffect(() => {
    const id = setInterval(refresh, data ? REFRESH_MS : 30_000);
    const vis = () => document.visibilityState === "visible" && Date.now() - last.current > REFRESH_MS && refresh();
    document.addEventListener("visibilitychange", vis);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", vis);
    };
  }, [refresh, data]);

  // content height to the parent page (the optional resize script listens); a plain fixed-height iframe just ignores it
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    let prev = 0;
    const send = () => {
      const h = Math.ceil(el.getBoundingClientRect().height);
      if (h !== prev && window.parent !== window) {
        prev = h;
        window.parent.postMessage({ type: "waterlevels-embed-height", h }, "*");
      }
    };
    send();
    const ro = new ResizeObserver(send);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // the only analytics: one embed_view event with the embedding site's hostname (never the path), not counted for our own pages
  useEffect(() => {
    let host = "";
    try {
      host = document.referrer ? new URL(document.referrer).hostname : "";
    } catch {
      host = "";
    }
    if (host === location.hostname || host === "waterlevels.lk" || host === "localhost") return;
    let n = 0;
    const id = setInterval(() => {
      const u = window.umami;
      if (u) {
        clearInterval(id);
        try {
          u.track("embed_view", { site: host || "unknown", widget });
        } catch {
          /* analytics must never break the widget */
        }
      } else if (++n > 40) clearInterval(id);
    }, 250);
    return () => clearInterval(id);
  }, [widget]);

  const st = styleOf(cfg);
  return (
    <div ref={wrap} className={`${st.classes} ${widget === "ticker" ? "p-1" : "p-1.5"}`} lang={cfg.lang}>
      <style dangerouslySetInnerHTML={{ __html: st.css }} />
      {st.fontHref && <link rel="stylesheet" href={st.fontHref} />}
      {data ? (
        <View p={{ ...data, cfg }} />
      ) : (
        <p className="rounded-xl border border-slate-200 dark:border-slate-800 p-4 text-sm text-slate-600 dark:text-slate-400">
          Live river levels are not available right now. Trying again soon.
        </p>
      )}
    </div>
  );
}
