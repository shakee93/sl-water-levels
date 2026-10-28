import Link from "next/link";
import type { Metadata } from "next";
import { CheckCircle2, AlertTriangle, XCircle } from "lucide-react";
import { notFound } from "next/navigation";
import { isLocale } from "@/lib/i18n/config";
import { getI18n } from "@/lib/i18n/server";
import { statusT, type StatusKey } from "@/lib/i18n/status";
import { runHealthChecks, type HealthCheck } from "@/lib/health";

// Public data-source status. Same checks as /api/health, cached a few minutes. Not indexed.
export const revalidate = 300;

export async function generateMetadata({ params }: { params: Promise<{ lang: string }> }): Promise<Metadata> {
  const { lang } = await params;
  if (!isLocale(lang)) return {};
  const s = statusT(lang);
  // absolute: the dictionary title already carries the site name, the layout template would add it twice.
  return { title: { absolute: s("title") }, description: s("desc"), robots: { index: false, follow: false } };
}

const GROUPS: { key: StatusKey; ids: (id: string) => boolean }[] = [
  { key: "g.gauges", ids: (id) => id === "gauges" },
  { key: "g.sheet", ids: (id) => id === "sheet" },
  { key: "g.wms", ids: (id) => id === "wms" },
  { key: "g.dmc", ids: (id) => id === "dmc" },
  { key: "g.openai", ids: (id) => id === "openai" },
  { key: "g.hmis", ids: (id) => id === "hmis" },
  { key: "g.rivernet", ids: (id) => id === "rivernet" },
  { key: "g.weather", ids: (id) => ["rain", "ensemble", "glofas", "rain-sensors"].includes(id) },
  { key: "g.news", ids: (id) => id.startsWith("feed-") },
  { key: "g.archive", ids: (id) => id.startsWith("pipe-") },
];

type State = "ok" | "delayed" | "down";
const stateOf = (cs: HealthCheck[]): State =>
  cs.some((c) => !c.ok && c.severity === "critical") ? "down" : cs.some((c) => !c.ok) ? "delayed" : "ok";

export default async function StatusPage({ params }: { params: Promise<{ lang: string }> }) {
  const { lang } = await params;
  if (!isLocale(lang)) notFound();
  const { p } = getI18n(lang);
  const s = statusT(lang);
  const report = await runHealthChecks(false);

  const ago = (m: number | undefined) => {
    if (m == null) return null;
    if (m < 1) return s("ago.now");
    if (m < 90) return s("ago.min", { n: m });
    if (m < 48 * 60) return s("ago.hour", { n: Math.round(m / 60) });
    return s("ago.day", { n: Math.round(m / 1440) });
  };

  const rows = GROUPS.map((g) => {
    const cs = report.checks.filter((c) => g.ids(c.id));
    const ages = cs.map((c) => c.ageMinutes).filter((a): a is number => a != null);
    return { key: g.key, state: stateOf(cs), updated: ago(ages.length ? Math.max(...ages) : undefined) };
  });
  const overall = rows.some((r) => r.state === "down") ? "down" : rows.some((r) => r.state === "delayed") ? "delayed" : "ok";
  const look = {
    ok: { icon: <CheckCircle2 className="size-5 text-emerald-600" aria-hidden />, pill: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200", label: s("s.ok") },
    delayed: { icon: <AlertTriangle className="size-5 text-amber-600" aria-hidden />, pill: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200", label: s("s.delayed") },
    down: { icon: <XCircle className="size-5 text-red-600" aria-hidden />, pill: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200", label: s("s.down") },
  } as const;

  return (
    <main className="bg-gradient-to-b from-slate-50 to-white dark:from-slate-950 dark:to-slate-900">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 sm:py-12">
        <nav className="text-xs text-slate-500 dark:text-slate-400 mb-3">
          <Link href={p("/")} className="hover:underline inline-block py-3 -my-3">
            {s("back")}
          </Link>
        </nav>
        <header className="mb-6">
          <h1 className="text-2xl sm:text-4xl font-semibold tracking-tight">{s("h1")}</h1>
          <p className="text-slate-600 dark:text-slate-400 mt-2 max-w-prose">{s("intro")}</p>
          <p className="mt-3 flex items-center gap-2 font-medium">
            {look[overall].icon}
            {s(overall === "ok" ? "all.ok" : overall === "delayed" ? "all.delayed" : "all.down")}
          </p>
        </header>
        <ul className="divide-y divide-slate-200 dark:divide-slate-800 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
          {rows.map((r) => (
            <li key={r.key} className="flex items-center justify-between gap-3 px-4 py-3">
              <div className="min-w-0">
                <p className="font-medium">{s(r.key)}</p>
                <p className="text-xs text-slate-500 dark:text-slate-400">{r.updated ? s("upd", { ago: r.updated }) : s("upd.none")}</p>
              </div>
              <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${look[r.state].pill}`}>{look[r.state].label}</span>
            </li>
          ))}
        </ul>
        <p className="mt-4 text-xs text-slate-500 dark:text-slate-400">{s("checked", { time: new Date(report.checkedAt).toLocaleTimeString("en-GB", { timeZone: "Asia/Colombo", hour: "2-digit", minute: "2-digit" }) })}</p>
      </div>
    </main>
  );
}
