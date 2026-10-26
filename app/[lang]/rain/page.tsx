import Link from "next/link";
import type { Metadata } from "next";
import { connection } from "next/server";
import { notFound } from "next/navigation";
import { isLocale, pageAlternates, type Locale } from "@/lib/i18n/config";
import { getI18n } from "@/lib/i18n/server";
import { riverName } from "@/lib/i18n/format";
import { rmFor } from "@/lib/i18n/rainMap";
import { getRainMap, MAP_BASINS } from "@/lib/rainMap";
import { basinForecast, basinSatellite } from "@/lib/rainMapCalc";
import { rainWord } from "@/lib/rainWords";
import { AnswerLine, JsonLd } from "@/app/Answer";
import { breadcrumbLd, webPageLd, SITE } from "@/lib/seo";
import { RainMap } from "@/app/rain/RainMap";

type Params = { params: Promise<{ lang: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { lang } = await params;
  if (!isLocale(lang)) return {};
  const rm = rmFor(lang);
  const alternates = pageAlternates(lang, "/rain");
  return {
    title: { absolute: rm("page.title") },
    description: rm("page.desc"),
    alternates,
    openGraph: { title: rm("page.title"), description: rm("page.desc"), url: `${SITE}${alternates.canonical}`, type: "website" },
    twitter: { card: "summary_large_image", title: rm("page.title"), description: rm("page.desc") },
  };
}

export default async function RainPage({ params }: Params) {
  await connection();
  const { lang: raw } = await params;
  if (!isLocale(raw)) notFound();
  const lang: Locale = raw;
  const { t, p } = getI18n(lang);
  const rm = rmFor(lang);
  const rivers = Object.fromEntries(MAP_BASINS.map((b) => [b, riverName(b, lang)]));

  // One plain sentence for search and screen readers: where the most rain fell, and where it is expected.
  const d = await getRainMap().catch(() => null);
  let answer = rm("page.answerNone");
  if (d) {
    const top = (vals: (number | null)[]) => d.basins.map((b, i) => ({ b: b.basin, mm: vals[i] })).filter((x) => x.mm != null).sort((a, b) => b.mm! - a.mm!)[0];
    const fell = top(basinSatellite(d, 24));
    const next = top(basinForecast(d, 24));
    const parts: string[] = [];
    if (fell) parts.push(fell.mm! >= 10 ? rm("page.answer", { river: rivers[fell.b], mm: Math.round(fell.mm!), word: rainWord("24h", fell.mm, lang) ?? "" }) : rm("page.answerDry"));
    if (next && next.mm! >= 10) parts.push(rm("page.answerNext", { river: rivers[next.b], mm: Math.round(next.mm!) }));
    if (parts.length) answer = parts.join(" ");
  }
  const mt = lang !== "en" ? t("common.machineTranslated") : undefined;
  const ld = [
    webPageLd({ lang, path: "/rain", name: rm("page.title"), description: answer, modified: d?.generatedAt ?? null, speakable: [".answer-line"] }),
    breadcrumbLd([{ name: t("crumb.home"), path: "/" }, { name: rm("crumb"), path: "/rain" }], lang),
  ];

  return (
    <main className="min-h-screen bg-gradient-to-b from-slate-50 to-white dark:from-slate-950 dark:to-slate-900 text-slate-900 dark:text-slate-100">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 pt-6 pb-24 sm:pt-10 lg:pb-10">
        <JsonLd graph={ld} />
        <nav className="text-xs text-slate-500 dark:text-slate-400 mb-3">
          <Link href={p("/")} className="hover:underline inline-block py-3 -my-3">{t("crumb.home")}</Link> <span aria-hidden>›</span>{" "}
          <span className="text-slate-700 dark:text-slate-300">{rm("crumb")}</span>
        </nav>
        <header className="mb-4">
          <h1 className="text-xl sm:text-2xl md:text-3xl font-semibold tracking-tight">{rm("page.h1")}</h1>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">{rm("page.lead")}</p>
          <AnswerLine text={answer} note={mt} />
        </header>
        <RainMap rivers={rivers} />
      </div>
    </main>
  );
}
