import Link from "next/link";
import type { Metadata } from "next";
import { CheckCircle2, CircleDashed, XCircle } from "lucide-react";
import { notFound } from "next/navigation";
import { ogBase } from "@/lib/seoMeta";
import { isLocale, pageAlternates } from "@/lib/i18n/config";
import { getI18n } from "@/lib/i18n/server";
import { fkT, versionText } from "@/lib/i18n/forecastKpi";
import { getForecastKpi, part, type Kpi, type KpiSummary } from "@/lib/forecastKpiData";
import { JsonLd } from "@/app/Answer";
import { CONTENT_UPDATED, DATA_BRANCH, SITE, breadcrumbLd, publisherLd, webPageLd } from "@/lib/seo";

// Public forecast scorecard: the ten targets, how the forecast did over the last 30 days, and how each version did.
// Reads kpi/latest.json from the `data` branch (written nightly by scripts/forecast-kpi.mjs). Fails soft: no file = a short "being prepared" line.
export const revalidate = 3600;

export async function generateMetadata({ params }: { params: Promise<{ lang: string }> }): Promise<Metadata> {
  const { lang } = await params;
  if (!isLocale(lang)) return {};
  const s = fkT(lang);
  const alternates = pageAlternates(lang, "/forecast-accuracy");
  return {
    title: { absolute: s("title") },
    description: s("desc"),
    alternates,
    openGraph: { ...ogBase(lang), title: s("h1"), description: s("desc"), url: `${SITE}${alternates.canonical}`, type: "website" },
  };
}

const pill = {
  met: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200",
  notmet: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200",
  early: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
} as const;

const roundPct = (v: number | null | undefined) => (v == null ? null : `${Math.round(v)}%`);
const ft = (v: number | null | undefined) => (v == null ? "–" : Math.abs(v).toFixed(2));

function dateText(iso: string, lang: string) {
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00+05:30` : iso);
  return d.toLocaleDateString(lang === "en" ? "en-GB" : lang === "si" ? "si-LK" : "ta-LK", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Colombo" });
}

export default async function ForecastAccuracyPage({ params }: { params: Promise<{ lang: string }> }) {
  const { lang } = await params;
  if (!isLocale(lang)) notFound();
  const { p, t } = getI18n(lang);
  const s = fkT(lang);
  const kpi = await getForecastKpi();

  /** The one-sentence result for a row, in plain words. */
  const valueText = (k: Kpi): string => {
    if (k.n === 0 && k.key !== "inputs") return s("dash");
    const d = k.detail ?? {};
    switch (k.key) {
      case "warned":
        return s("k1.value", { caught: d.caught ?? 0, n: d.events ?? k.n }) + (d.caught && d.medianLeadWhenCaughtH != null ? s("k1.lead", { lead: d.medianLeadWhenCaughtH }) : "");
      case "falseAlarms":
        return s("k2.value", { p: roundPct(part(k, "possible")?.value) ?? "–", l: roundPct(part(k, "likely")?.value) ?? "–" });
      case "honest":
        return d.groupsJudged ? s("k3.value", { ok: d.groupsOk, j: d.groupsJudged }) : s("dash");
      case "skill":
        return s("k4.value", {
          h1: roundPct(part(k, "h1")?.value) ?? "–", h3: roundPct(part(k, "h3")?.value) ?? "–", h6: roundPct(part(k, "h6")?.value) ?? "–",
          h12: roundPct(part(k, "h12")?.value) ?? "–", h24: roundPct(part(k, "h24")?.value) ?? "–", w: roundPct(part(k, "worstPhase")?.value) ?? "–",
        });
      case "bias": {
        const worst = Math.max(0, ...k.parts.map((x) => Math.abs(x.value ?? 0)));
        const v = k.value ?? 0;
        return s(Math.abs(v) < 0.005 ? "k5.value.zero" : v > 0 ? "k5.value.high" : "k5.value.low", { v: ft(v), w: worst.toFixed(2) });
      }
      case "coverage":
        return s("k6.value", { c: roundPct(k.value) ?? "–", a: roundPct(part(k, "h1")?.value) ?? "–", b: roundPct(part(k, "h6")?.value) ?? "–", d: roundPct(part(k, "h12")?.value) ?? "–", e: roundPct(part(k, "h24")?.value) ?? "–" });
      case "fastRises":
        return s("k7.value", { v: roundPct(k.value) ?? "–", n: k.n });
      case "risingRight":
        return s("k8.value", { v: roundPct(k.value) ?? "–", n: k.n });
      case "inputs":
        return k.n === 0 ? s("dash") : s("k9.value", { h: k.value ?? "–", g: Math.round(part(k, "gaugesPerHour")?.value ?? 0), f: roundPct(part(k, "flaggedShare")?.value) ?? "0%" });
      case "people":
        return s("k10.value", { v: roundPct(k.value) ?? "–", n: k.n });
    }
  };

  /** A few characters for the per-version table. */
  const shortValue = (k: Kpi): string => {
    if (k.n === 0 && k.key !== "inputs") return "–";
    switch (k.key) {
      case "falseAlarms": return `${roundPct(part(k, "possible")?.value) ?? "–"} / ${roundPct(part(k, "likely")?.value) ?? "–"}`;
      case "honest": return k.detail?.groupsJudged ? `${k.detail.groupsOk}/${k.detail.groupsJudged}` : "–";
      case "skill": return roundPct(part(k, "h6")?.value) ?? "–";
      case "bias": return k.value == null ? "–" : `${k.value > 0 ? "+" : k.value < 0 ? "−" : ""}${ft(k.value)} ft`;
      case "inputs": return k.value == null ? "–" : `${k.value} h`;
      default: return roundPct(k.value) ?? "–";
    }
  };

  const badge = (met: boolean | null) => {
    const kind = met == null ? "early" : met ? "met" : "notmet";
    const Icon = met == null ? CircleDashed : met ? CheckCircle2 : XCircle;
    return (
      <span className={`shrink-0 inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ${pill[kind]}`}>
        <Icon className="size-3.5" aria-hidden />
        {s(met == null ? "early" : met ? "met" : "notmet")}
      </span>
    );
  };

  const summaryLine = (sm: KpiSummary) => s("verdict", { met: sm.met, total: sm.assessable, days: kpi?.window.days ?? 0 });

  const modified = kpi ? Date.parse(kpi.generatedAt) : Date.parse(CONTENT_UPDATED);
  return (
    <main className="bg-gradient-to-b from-slate-50 to-white dark:from-slate-950 dark:to-slate-900">
      <JsonLd
        graph={[
          webPageLd({ lang, path: "/forecast-accuracy", name: s("title"), description: s("desc"), modified }),
          breadcrumbLd([{ name: t("crumb.home"), path: "/" }, { name: s("nav"), path: "/forecast-accuracy" }], lang),
          publisherLd(),
        ]}
      />
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 sm:py-12">
        <nav className="text-xs text-slate-500 dark:text-slate-400 mb-3">
          <Link href={p("/")} className="hover:underline inline-block py-3 -my-3">
            {s("back")}
          </Link>{" "}
          <span aria-hidden>›</span>{" "}
          <span className="text-slate-700 dark:text-slate-300">{s("nav")}</span>
        </nav>
        <header className="mb-6">
          <h1 className="text-2xl sm:text-4xl font-semibold tracking-tight">{s("h1")}</h1>
          <p className="text-slate-600 dark:text-slate-400 mt-2 max-w-prose">{s("intro")}</p>
          {kpi && (
            <>
              <p className="mt-3 font-medium">
                {kpi.window.days >= 28
                  ? summaryLine(kpi.summary)
                  : s("verdict.early", { met: kpi.summary.met, total: kpi.summary.assessable, days: kpi.window.days })}
                {kpi.summary.notJudged > 0 && <span className="font-normal text-slate-600 dark:text-slate-400"> {s("verdict.few", { n: kpi.summary.notJudged })}</span>}
              </p>
              <p className="mt-2 text-sm text-slate-600 dark:text-slate-400 max-w-prose">{s("events", { events: kpi.kpis[0]?.detail?.events ?? 0 })}</p>
            </>
          )}
        </header>

        {!kpi ? (
          <p className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-4 py-4 text-slate-600 dark:text-slate-400">{s("none")}</p>
        ) : (
          <>
            <ul className="divide-y divide-slate-200 dark:divide-slate-800 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
              {kpi.kpis.map((k) => (
                <li key={k.id} className="px-4 py-4">
                  <div className="flex items-start justify-between gap-3">
                    <h2 className="font-medium">{s(`k${k.id}.title` as "k1.title")}</h2>
                    {badge(k.met)}
                  </div>
                  <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">{s(`k${k.id}.what` as "k1.what")}</p>
                  <p className="mt-2">{valueText(k)}</p>
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                    {s("target", { t: s(`k${k.id}.target` as "k1.target") })}
                    {k.n > 0 && k.key !== "inputs" && <> · {s("cases", { n: k.n })}</>}
                  </p>
                </li>
              ))}
            </ul>

            {kpi.storm && (
              <section className="mt-8">
                <h2 className="text-lg font-semibold">{s("storm.h")}</h2>
                <p className="mt-1 text-slate-600 dark:text-slate-400">{s("storm.p", { days: kpi.storm.days, met: kpi.storm.summary.met, total: kpi.storm.summary.assessable })}</p>
              </section>
            )}

            <section className="mt-8">
              <h2 className="text-lg font-semibold">{s("ver.h")}</h2>
              <p className="mt-1 text-slate-600 dark:text-slate-400 max-w-prose">{s("ver.p")}</p>
              <ul className="mt-4 space-y-3">
                {[...kpi.versions].reverse().map((v) => (
                  <li key={v.id} className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h3 className="font-medium">{versionText(lang, v.id, "name", v.name)}</h3>
                        <p className="text-xs text-slate-500 dark:text-slate-400">{s("ver.live", { date: dateText(v.from, lang) })}{v.runs > 0 && <> · {s("ver.runs", { n: v.runs.toLocaleString("en-GB") })}</>}</p>
                      </div>
                      {v.summary && v.kpis ? (
                        <span className="shrink-0 text-xs font-semibold text-slate-600 dark:text-slate-300">{s("ver.result", { met: v.summary.met, total: v.summary.assessable })}</span>
                      ) : null}
                    </div>
                    <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">{versionText(lang, v.id, "what", v.what)}</p>
                    {v.kpis ? (
                      <dl className="mt-3 grid grid-cols-2 sm:grid-cols-5 gap-x-3 gap-y-2 text-xs">
                        {v.kpis.map((k) => (
                          <div key={k.id}>
                            <dt className="text-slate-500 dark:text-slate-400">{s(`s${k.id}` as "s1")}</dt>
                            <dd className="tabular-nums font-medium text-slate-800 dark:text-slate-200">
                              {shortValue(k)}{" "}
                              <span className={k.met == null ? "text-slate-400" : k.met ? "text-emerald-600" : "text-amber-600"} aria-hidden>{k.met == null ? "·" : k.met ? "✓" : "✗"}</span>
                              <span className="sr-only">{s(k.met == null ? "early" : k.met ? "met" : "notmet")}</span>
                            </dd>
                          </div>
                        ))}
                      </dl>
                    ) : (
                      <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">{s("ver.none")}</p>
                    )}
                  </li>
                ))}
              </ul>
            </section>

            <p className="mt-6 text-xs text-slate-500 dark:text-slate-400">
              {s("updated", { date: dateText(kpi.generatedAt, lang), from: dateText(kpi.window.from, lang), to: dateText(kpi.window.to, lang) })}{" "}
              <a href={`${DATA_BRANCH}/kpi`} className="underline underline-offset-2 hover:no-underline" rel="noopener">{s("numbers")}</a>
            </p>
          </>
        )}
      </div>
    </main>
  );
}
