import Link from "next/link";
import type { Metadata } from "next";
import { connection } from "next/server";
import { notFound } from "next/navigation";
import { isLocale, pageAlternates, type Locale } from "@/lib/i18n/config";
import { getI18n } from "@/lib/i18n/server";
import { clock } from "@/lib/i18n/format";
import { ccFor } from "@/lib/i18n/colombo";
import { BASINS } from "@/lib/colombo";
import { placeBySlug } from "@/lib/places";
import { getCanals } from "@/lib/curw";
import { tideEvents } from "@/lib/tide";
import { AnswerLine, JsonLd } from "@/app/Answer";
import { breadcrumbLd, webPageLd } from "@/lib/seo";
import { TideLine, highTideTimes } from "@/app/colombo/TideLine";
import { CanalLevels } from "@/app/colombo/CanalLevels";
import { ColomboMap } from "@/app/colombo/ColomboMap";

const SITE = "https://sl-water-levels.vercel.app";
type Params = { params: Promise<{ lang: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { lang } = await params;
  if (!isLocale(lang)) return {};
  const cc = ccFor(lang);
  const alternates = pageAlternates(lang, "/colombo-canals");
  return {
    title: { absolute: cc("page.title") },
    description: cc("page.desc"),
    alternates,
    openGraph: { title: cc("page.title"), description: cc("page.desc"), url: `${SITE}${alternates.canonical}`, type: "website" },
    twitter: { card: "summary_large_image", title: cc("page.title"), description: cc("page.desc") },
  };
}

export default async function ColomboCanalsPage({ params }: Params) {
  await connection();
  const { lang: raw } = await params;
  if (!isLocale(raw)) notFound();
  const lang: Locale = raw;
  const { t, p } = getI18n(lang);
  const cc = ccFor(lang);
  // eslint-disable-next-line react-hooks/purity -- rendered per request (connection() above), the tide times are for right now
  const now = Date.now();
  const canals = await getCanals();
  const h = highTideTimes(lang, now);
  const answer = cc("page.answer", { tide: h.times ? cc("tide.highs", { times: h.times }) : "" }).replace("  ", " ");
  const events = tideEvents(now, 48);
  const mt = lang !== "en" ? t("common.machineTranslated") : undefined;
  const ld = [
    webPageLd({ lang, path: "/colombo-canals", name: cc("page.title"), description: answer, modified: now, speakable: [".answer-line"] }),
    breadcrumbLd([{ name: t("crumb.home"), path: "/" }, { name: cc("crumb"), path: "/colombo-canals" }], lang),
  ];
  const day = (ms: number) => new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Colombo", weekday: "short", day: "numeric", month: "short" }).format(ms);
  return (
    <main className="min-h-screen bg-gradient-to-b from-slate-50 to-white dark:from-slate-950 dark:to-slate-900 text-slate-900 dark:text-slate-100">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6 sm:py-10">
        <JsonLd graph={ld} />
        <nav className="text-xs text-slate-500 dark:text-slate-400 mb-3">
          <Link href={p("/")} className="hover:underline inline-block py-3 -my-3">{t("crumb.home")}</Link> <span aria-hidden>›</span>{" "}
          <span className="text-slate-700 dark:text-slate-300">{cc("crumb")}</span>
        </nav>
        <header className="mb-4">
          <h1 className="text-xl sm:text-2xl md:text-3xl font-semibold tracking-tight">{cc("page.h1")}</h1>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">{cc("page.lead")}</p>
          <AnswerLine text={answer} note={mt} />
        </header>

        <TideLine lang={lang} now={now} sea={canals?.sea ?? null} />
        <section className="mt-4" aria-label={cc("tide.title")}>
          <h2 className="text-base font-semibold">{cc("tide.title")}</h2>
          <ul className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-4">
            {events.map((e) => (
              <li key={e.t} className={e.kind === "high" ? "font-medium" : "text-slate-600 dark:text-slate-400"}>
                {cc(e.kind === "high" ? "tide.table.high" : "tide.table.low")}: {clock(e.t, t)} <span className="text-xs text-slate-500 dark:text-slate-400">{day(e.t)}</span>
              </li>
            ))}
          </ul>
          <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">{cc("about.tide")} {cc("tide.basis")}</p>
        </section>

        <section className="mt-6" aria-label={cc("map.title")}>
          <h2 className="text-base font-semibold">{cc("map.title")}</h2>
          <div className="mt-2"><ColomboMap lang={lang} /></div>
          <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">{cc("map.note")}</p>
        </section>

        {BASINS.map((b) => (
          <section key={b.id} className="mt-8" aria-label={cc(b.nameKey)}>
            <h2 className="text-lg font-semibold">{cc(b.nameKey)}</h2>
            <p className="mt-1 text-sm text-slate-700 dark:text-slate-300">{cc(b.drainKey)}</p>
            {canals ? <CanalLevels lang={lang} canals={canals} names={b.gauges} showSea={false} notes={false} title={cc("canal.title")} /> : <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">{cc("canal.none")}</p>}
            <p className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-sm">
              {b.towns.map((s) => placeBySlug(s)).filter((x): x is NonNullable<typeof x> => !!x).map((x) => (
                <Link key={x.slug} href={p(`/flood/${x.slug}`)} className="text-sky-700 dark:text-sky-300 underline underline-offset-2 hover:no-underline inline-block py-2">{x.name}</Link>
              ))}
            </p>
          </section>
        ))}
        {canals && <CanalLevels lang={lang} canals={canals} names={[]} showSea title={cc("canal.sea")} />}

        <section className="mt-8" aria-label={cc("early.title")}>
          <h2 className="text-lg font-semibold">{cc("early.title")}</h2>
          <p className="mt-1 text-sm text-slate-700 dark:text-slate-300">{cc("early.p1")}</p>
          <p className="mt-2 text-sm text-slate-700 dark:text-slate-300">{cc("early.p2")}</p>
        </section>
        <p className="mt-6 text-xs text-slate-600 dark:text-slate-400">{cc("area.credit")}</p>
      </div>
    </main>
  );
}
