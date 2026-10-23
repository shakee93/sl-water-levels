import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CloudRain, Download, Quote, Waves } from "lucide-react";
import { isLocale, pageAlternates } from "@/lib/i18n/config";
import { getI18n } from "@/lib/i18n/server";
import { JsonLd, AnswerLine } from "@/app/Answer";
import { ResearchFigure } from "@/app/ResearchFigure";
import { OWNER, SITE, SITE_NAME, abs, breadcrumbLd, publisherLd, webPageLd, PUBLISHER_ID } from "@/lib/seo";
import { GSMAP_CREDIT, WF_ANSWER, WF_CITE, WF_CSV, WF_DESC, WF_FINDINGS, WF_I18N, WF_MODIFIED, WF_PATH, WF_PUBLISHED, WF_TITLE, wfArticleLd } from "@/lib/research";

export const revalidate = 86400;

export async function generateMetadata({ params }: { params: Promise<{ lang: string }> }): Promise<Metadata> {
  const { lang } = await params;
  if (!isLocale(lang)) return {};
  const alternates = pageAlternates(lang, WF_PATH);
  const og = `${SITE}/research/wellampitiya/22-oct-2026-timeline.png`;
  return {
    title: WF_TITLE[lang],
    description: WF_DESC[lang],
    alternates,
    authors: [{ name: OWNER.name, url: OWNER.x }],
    openGraph: {
      title: WF_TITLE[lang],
      description: WF_DESC[lang],
      url: `${SITE}${alternates.canonical}`,
      type: "article",
      publishedTime: WF_PUBLISHED,
      modifiedTime: WF_MODIFIED,
      authors: [OWNER.name],
      images: [{ url: og, width: 1600, height: 1100, alt: "Rain, rule and river gauges on 22 October 2026" }],
    },
    twitter: { card: "summary_large_image", title: WF_TITLE[lang], description: WF_DESC[lang], images: [og] },
  };
}

const card = "rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 sm:p-6";
const h2 = "text-lg sm:text-xl font-semibold tracking-tight scroll-mt-20";
const a = "underline underline-offset-2 hover:text-sky-700 dark:hover:text-sky-300";
const ext = { target: "_blank", rel: "noreferrer" } as const;
const th = "px-3 py-2 text-left font-medium text-slate-700 dark:text-slate-200 align-bottom";
const td = "px-3 py-2 align-top tabular-nums";

export default async function WellampitiyaResearch({ params }: { params: Promise<{ lang: string }> }) {
  const { lang } = await params;
  if (!isLocale(lang)) notFound();
  const { t, p } = getI18n(lang);
  const X = WF_I18N[lang];
  const nonEn = lang !== "en";

  return (
    <main className="bg-gradient-to-b from-slate-50 to-white dark:from-slate-950 dark:to-slate-900">
      <JsonLd
        graph={[
          webPageLd({ lang, path: WF_PATH, name: WF_TITLE[lang], description: WF_DESC[lang], modified: Date.parse(`${WF_MODIFIED}T00:00:00+05:30`), speakable: [".answer-line"] }),
          ...wfArticleLd(lang, PUBLISHER_ID),
          breadcrumbLd(
            [
              { name: t("crumb.home"), path: "/" },
              { name: X.crumb, path: "/research" },
              { name: WF_TITLE[lang], path: WF_PATH },
            ],
            lang,
          ),
          publisherLd(),
        ]}
      />
      <article className="max-w-3xl mx-auto px-4 sm:px-6 py-6 sm:py-12">
        <nav className="text-xs text-slate-500 dark:text-slate-400 mb-3">
          <Link href={p("/")} className="hover:underline inline-block py-3 -my-3">{t("crumb.home")}</Link> <span aria-hidden>›</span>{" "}
          <Link href={p("/research")} className="hover:underline inline-block py-3 -my-3">{X.crumb}</Link> <span aria-hidden>›</span>{" "}
          <span className="text-slate-700 dark:text-slate-300">Wellampitiya</span>
        </nav>

        <header className="mb-6 sm:mb-8">
          <h1 className="text-2xl sm:text-4xl font-semibold tracking-tight">{WF_TITLE[lang]}</h1>
          <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
            {OWNER.name} · {X.updated} {WF_MODIFIED}
          </p>
          <AnswerLine text={WF_ANSWER[lang]} className="mt-4 !text-base !leading-relaxed !text-slate-700 dark:!text-slate-300" />
          {nonEn && <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">{X.note}</p>}
        </header>

        {nonEn && (
          <section className={`${card} mb-8`} aria-labelledby="summary">
            <h2 id="summary" className={h2}>{X.findings}</h2>
            <ol className="mt-3 space-y-3 text-sm leading-relaxed text-slate-700 dark:text-slate-300">
              {WF_FINDINGS[lang].map((f, i) => (
                <li key={f.h}>
                  <p className="font-medium text-slate-900 dark:text-slate-100">{i + 1}. {f.h}</p>
                  <p>{f.p}</p>
                </li>
              ))}
            </ol>
            <p className="mt-4 text-sm">
              <a className={a} href="#full">{X.english}</a>
            </p>
          </section>
        )}

        <div id="full" lang="en" className="scroll-mt-20 space-y-8 text-sm sm:text-[15px] leading-relaxed text-slate-700 dark:text-slate-300">
          <section className={card} aria-labelledby="findings">
            <h2 id="findings" className={h2}>Key findings</h2>
            <ol className="mt-3 space-y-4">
              <li>
                <p className="font-medium text-slate-900 dark:text-slate-100">1. Two kinds of flood, and the river gauge sees only one.</p>
                <p>
                  Of 16 documented floods (6 Oct 2018 to 22 Oct 2026), the Kelani was at its minor flood level in 9. In 6 it was normal: the Nagalagam Street and Hanwella gauges read between 11% and 84% of their minor levels, so neither would have warned. One flood (27 Nov 2024) has no river record. Three floods earlier labelled &ldquo;rain only&rdquo; turned out to have the river at 5 ft, so they were river floods too. On 22 Oct 2026 Nagalagam read 3.0 ft against a 5 ft minor level and there was still water on a street.
                </p>
              </li>
              <li>
                <p className="font-medium text-slate-900 dark:text-slate-100">2. The rule: satellite rain over 24 hours, with the river as a second trigger.</p>
                <p>
                  Add up the last 24 hours of satellite rain over the area (JAXA GSMaP, counting at most 15 mm for any one hour). At <strong>60 mm</strong> street water is <strong>possible</strong>. At <strong>100 mm</strong>, or when the river reaches its minor flood level (Hanwella at 8.0 m, or 7.5 m on the 2026 sheets, or Nagalagam at 5 ft), it is <strong>likely</strong>.
                </p>
              </li>
              <li>
                <p className="font-medium text-slate-900 dark:text-slate-100">3. How well it works, with the uncertainty.</p>
                <p>
                  <strong>Likely</strong> caught 11 of the 16 floods (69%, 95% interval 44% to 86%) and raised about 1.3 alarms a year (0.6 to 2.3) with no recorded flood; about 4 in 10 of its alarms were followed by a documented flood. <strong>Possible</strong> caught 12 of 16 (75%, 51% to 90%) but fires about 8 times a year (6.6 to 10.6) without a recorded flood, so treat it as an early heads-up only. &ldquo;No recorded flood&rdquo; is not &ldquo;no flood&rdquo;: ankle-deep street water is almost never reported, so the real false-alarm rate is lower. The misses are small local floods where the satellite read under half of the nearest rain gauges. Sixteen floods is a small sample.
                </p>
              </li>
              <li>
                <p className="font-medium text-slate-900 dark:text-slate-100">4. Hours of warning, from observed rain.</p>
                <p>
                  On 21 Oct 2026 the satellite total passed 60 mm at 21:30 and 100 mm at 22:30; a resident in Wellampitiya reported ankle-deep water at about 13:00 on 22 Oct. That is about 15 hours. It is observed rain, not a forecast. On other floods the lead time was short, and river floods can start before the rain total reaches 100 mm.
                </p>
              </li>
              <li>
                <p className="font-medium text-slate-900 dark:text-slate-100">5. What did not help.</p>
                <p>
                  Tide (high water adds about 12 cm; scores moved by noise). Extra terms for short bursts of rain (1, 6 or 12 hours). Weather-model rain (the ERA5 reanalysis separated flood days from other wet days at 0.56 to 0.62 on a scale where 0.5 is a coin toss; the forecasts themselves were not tested). Elevation maps (global height models carry 1 to 1.6 m of error in built-up areas; the best terrain method matched about a third of the mapped flood, against 0.08 for chance). Radar satellite images in built-up areas (Sentinel-1 found none of the flooding within 1.5 km of Wellampitiya on 2 Dec 2025, two days after the peak).
                </p>
              </li>
              <li>
                <p className="font-medium text-slate-900 dark:text-slate-100">6. Satellite rain is a rough measure.</p>
                <p>
                  Against the average of three Colombo-area rain gauges, GSMaP_NOW has a rank correlation of 0.58. On days the gauges read 50 mm or more it showed no skill, and it sometimes invents rain (one hour of 118 mm on 8 Dec 2022 while the gauges read under 1 mm). The 15 mm hourly cap removes most such hours.
                </p>
              </li>
            </ol>
          </section>

          <section aria-labelledby="what-site">
            <h2 id="what-site" className={`${h2} flex items-center gap-2`}><CloudRain className="size-5 text-sky-600 dark:text-sky-400" aria-hidden />What the site does with this</h2>
            <p className="mt-2">
              The town pages for Wellampitiya, Kolonnawa and the neighbouring towns inside the same rain box (<Link className={a} href={p("/flood/wellampitiya")}>Wellampitiya</Link>, <Link className={a} href={p("/flood/kolonnawa")}>Kolonnawa</Link>, Kotikawatta, Mulleriyawa, Orugodawatta, Dematagoda, Angoda, Meethotamulla and Gothatuwa) show &ldquo;water on the streets possible&rdquo; at 60 mm of satellite rain in 24 hours and &ldquo;likely&rdquo; at 100 mm. The hourly cap and the river trigger recommended below are the update to that rule. The thresholds were not tested for other towns, so those keep the river-only estimate. The rule clears by itself when the 24-hour total falls, and it switches off, without saying all is calm, when the satellite data are more than 3 hours old.
            </p>
          </section>

          <section aria-labelledby="rain-or-river">
            <h2 id="rain-or-river" className={`${h2} flex items-center gap-2`}><Waves className="size-5 text-sky-600 dark:text-sky-400" aria-hidden />Rain or river?</h2>
            <p className="mt-2">
              The date of each flood comes from Disaster Management Centre situation reports (the Kolonnawa Divisional Secretariat rows), news reports and, for 22 Oct 2026, a resident&rsquo;s report. River levels come from the DMC&rsquo;s archive of daily river reports (1,786 usable Nagalagam Street and Hanwella readings, thin before 2021) and the Irrigation Department record from Nov 2025; where the two overlap they agree to r = 0.996.
            </p>
            <ResearchFigure
              n="1"
              file="rain-vs-river.png"
              w={1600}
              h={919}
              alt="Chart of 16 floods from 2018 to 2026. Left: satellite and rain-gauge rain for each flood. Right: Nagalagam Street and Hanwella readings as a share of their minor flood level. Nine floods (red rows) have the river at or near 100%; six (blue rows) have it between 11% and 84%."
              caption="Each row is one documented flood. Red rows: the Kelani was at its minor flood level (9 floods). Blue rows: the river stayed normal (6 floods). Left, rain around the flood day: satellite rain in 24 hours (orange) and the heaviest of three Colombo-area rain gauges (green). In 4 of the 6 blue floods the satellite read less than half of the heaviest gauge. Grey: no river record found."
            />
            <p>
              Hanwella does not warn earlier than Nagalagam: of 92 readings with Nagalagam at 5 ft or more, Hanwella was below its minor level in 28, and the reverse happened in 11 of 75. Both reach their minor level for the same events. The experience that streets flood before the gauge says so is real, but in those cases the water is local rain and drainage, and neither gauge would have flagged it.
            </p>
          </section>

          <section aria-labelledby="rule">
            <h2 id="rule" className={h2}>Finding the rule</h2>
            <p className="mt-2">
              Every heavy-rain day since March 2017 is a dot below. The floods that happened with a normal river (blue) sit at 20 to 170 mm, mixed in with many heavy days that had no recorded flood, which is why no rain rule can be sharp. Raising the threshold from 80 to 110 mm leaves the number of floods caught unchanged and removes alarms, so the round 100 mm was kept for &ldquo;likely&rdquo;, and 60 mm for &ldquo;possible&rdquo;. Lowering the first tier to 40 mm catches 13 of 16 floods but fires about 16 times a year.
            </p>
            <ResearchFigure
              n="2"
              file="rain-vs-floods.png"
              w={1600}
              h={819}
              alt="Two scatter plots of satellite rain in the last 24 hours against the heaviest single hour of the day, one dot per heavy-rain day since 2017. The 16 floods are marked in red (river at minor level), blue (river normal) or grey (no river record). Vertical lines mark 60 mm possible and 100 mm likely. The right panel clips each hour at 15 mm and moves several spike days left of 100 mm."
              caption="Heavy-rain days at Wellampitiya, 2017 to 2026. Left, rain as the site reads it. Right, the same with each hour capped at 15 mm: days that crossed 100 mm only because of one impossible hour drop out, and the floods stay where they were."
            />
            <ResearchFigure
              n="3"
              file="catch-vs-false-alarms.png"
              w={1600}
              h={840}
              alt="Line chart of the share of the 16 floods caught (vertical) against alarm episodes per year with no documented flood (horizontal, logarithmic), for thresholds from 40 to 180 mm. The clipped 100 mm rule sits at about half the floods caught and 1.3 alarms a year; the 60 mm rule at about 70% and 10 a year."
              caption="The trade-off. Each marker is a threshold. Moving right means more alarms with no recorded flood; moving up means more floods caught. The clipped 100 mm rule gives the same floods as the plain one with fewer alarms. Bars are 95% intervals."
            />
          </section>

          <section aria-labelledby="scores">
            <h2 id="scores" className={h2}>How often it is right</h2>
            <p className="mt-2">Expected scores over 8.65 years (March 2018 to October 2026) and the 16 floods. Brackets give the 95% interval.</p>
            <div className="mt-3 overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
              <table className="w-full min-w-[34rem] text-xs sm:text-sm">
                <thead className="bg-slate-50 dark:bg-slate-800/60">
                  <tr>
                    <th className={th}>Tier</th>
                    <th className={th}>Floods caught</th>
                    <th className={th}>Alarms a year with no recorded flood</th>
                    <th className={th}>Alarms followed by a flood</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                  <tr>
                    <td className={`${td} font-medium`}>Likely: clipped 100 mm, or river at minor level</td>
                    <td className={td}>11 of 16 (69%; 44 to 86%)</td>
                    <td className={td}>1.3 (0.6 to 2.3)</td>
                    <td className={td}>about 42%</td>
                  </tr>
                  <tr>
                    <td className={`${td} font-medium`}>Possible: clipped 60 mm, or river at minor level</td>
                    <td className={td}>12 of 16 (75%; 51 to 90%)</td>
                    <td className={td}>8.4 (6.6 to 10.6)</td>
                    <td className={td}>about 12%</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p className="mt-3">
              The river trigger was never seen to fire without a flood, but the river readings are not continuous (sparse in 2018 to 2020, a gap in late 2024), so that is weaker evidence than it looks. Without the cap the same rule raises about 2.4 alarms a year at 100 mm and 10 at 60 mm, mostly from single impossible hours.
            </p>
            <ResearchFigure
              n="4"
              file="alarms-per-year.png"
              w={1600}
              h={720}
              alt="Three bar charts of alarm episodes per year from 2017 to 2026: the 60 mm rule (6 to 18 a year), the 100 mm rule (0 to 6 a year) and the 100 mm rule with hourly spikes clipped (0 to 6). Blue sections are alarms followed by a documented flood; grey are alarms with none."
              caption="Alarms per year. Blue: followed by a documented flood. Grey: no documented flood (some will have been real, unreported street water). 2017 has no flood record, so none of its alarms count as hits. The 60 mm tier fires on 6 to 18 episodes a year; the clipped 100 mm tier on 0 to 6."
            />
            <p>
              The same pattern holds across years. Every year from 2021 had at least one alarm followed by a flood, but not every flood was caught (1 of 3 in 2022, none of 2 in 2023), and the three floods of 2018 to 2020 were missed. October to January has about twice as many unmatched alarms as the south-west monsoon at the same threshold, which suggests wording that is more careful in that season rather than a different threshold.
            </p>
          </section>

          <section aria-labelledby="oct22">
            <h2 id="oct22" className={h2}>22 October 2026: the case with a normal river</h2>
            <p className="mt-2">
              Rain began on the evening of 21 Oct. The 24-hour total crossed 60 mm at 21:30 and 100 mm at 22:30 (Sri Lanka time). Nagalagam Street stayed under 3.5 ft and Hanwella under 5 m, far below their minor flood levels, when a resident in Wellampitiya reported ankle-deep water at about 13:00 the next day. The same day roads flooded in Colombo city (<a className={a} href="https://english.newsfirst.lk/2026/10/22/heavy-rains-flood-colombo-roads-major-traffic-chaos-reported" {...ext}>Newsfirst report</a>).
            </p>
            <ResearchFigure
              n="5"
              file="22-oct-2026-timeline.png"
              w={1600}
              h={1100}
              alt="Three stacked charts for 21 to 23 October 2026. Top: hourly satellite rain peaking at over 30 mm per hour on the evening of 21 October. Middle: rain in the last 24 hours rising through the 60 mm line at 21:30 and the 100 mm line at 22:30 on 21 October. Bottom: Nagalagam Street and Hanwella river gauges staying well under their minor flood levels. A marker at about 13:00 on 22 October shows a resident's report of ankle-deep water."
              caption="Top, satellite rain each hour. Middle, the 24-hour total the rule reads (black) and the same with spikes clipped (orange dashed), with the 60 mm and 100 mm lines. Bottom, both river gauges stayed far below their minor flood levels. The green line is a report from a resident in Wellampitiya of ankle-deep water at about 13:00."
            />
          </section>

          <section aria-labelledby="satellite">
            <h2 id="satellite" className={h2}>How good is satellite rain here?</h2>
            <p className="mt-2">
              Not very, and that is a property of the satellite, not of the rule. Against the Sri Lanka Meteorological Department gauges at Colombo, Katunayake and Ratmalana (3,022 paired days), GSMaP_NOW over-reads dry and moderate days by about a third and under-reads heavy ones by up to half. A day at 60 mm of satellite rain is a gauge day of 60 mm only about one time in eight; floods happened at roughly 90 to 120 mm on the gauges. Even with the gauges, a rain-only rule cannot be much sharper than the one here, because many heavy-rain days simply had no reported flood.
            </p>
            <ResearchFigure
              n="6"
              file="satellite-vs-rain-gauges.png"
              w={1600}
              h={819}
              alt="Left and middle: scatter plots of satellite rain against the average of three Colombo-area rain gauges for GSMaP_NOW (rank correlation 0.58) and GSMaP_NRT (0.70), with many points far from the line of perfect agreement. Right: boxplots of the gauge rain on days the satellite said 60 or 100 mm or more, mostly 10 to 45 mm."
              caption="Satellite rain against rain gauges, March 2017 to October 2026. Left and middle, one dot per day. Right, what the gauges read on the days the satellite said 60 or 100 mm or more: usually well under that."
            />
          </section>

          <section aria-labelledby="nothelp">
            <h2 id="nothelp" className={h2}>What did not help, and why</h2>
            <ul className="mt-2 list-disc pl-5 space-y-1.5">
              <li><strong>Tide.</strong> High water in Colombo adds about 12 cm, small beside 100 mm or more of rain. Adding it changed scores by noise.</li>
              <li><strong>Burst terms.</strong> A rule on 1, 6 or 12 hours of rain did no better than 24 hours. Floods and other heavy days separate no better than about 0.8 on a 0.5 (chance) to 1.0 (perfect) scale for any window.</li>
              <li><strong>Weather-model rain.</strong> At the model&rsquo;s resolution it gives no usable signal for this rule. A forecast lead beyond the observed-rain lead above is unproven.</li>
              <li><strong>Elevation maps.</strong> Free 30 m height models matched at best about a third of the flood mapped by Copernicus on 30 Nov 2025 (the observed map from the peak day predicted the flood three days later better, 0.39 against 0.33 for the best terrain method). A hydraulic model was worse than a simple height threshold, and moving its river boundary by one metre made it fail. Observed flood maps are worth more than modelled ones.</li>
              <li><strong>Radar in built-up areas.</strong> Sentinel-1 radar found 0.0% flooded within 1.5 km of Wellampitiya on 2 Dec 2025, while the Copernicus emergency map showed about 10.6% flooded on 30 Nov. Copernicus&rsquo; own flood monitor excludes 80% of this window as not mappable (urban, dense vegetation).</li>
            </ul>
          </section>

          <section aria-labelledby="method">
            <h2 id="method" className={h2}>Method</h2>
            <ul className="mt-2 list-disc pl-5 space-y-1.5">
              <li><strong>Period.</strong> Satellite rain every hour from 29 Mar 2017 to 22 Oct 2026 (83,880 files); floods from 6 Oct 2018 to 22 Oct 2026; river readings 2018 to 2026.</li>
              <li><strong>Rain.</strong> The mean of the four 0.1 degree pixels around 6.9 N 79.9 E from JAXA GSMaP_NOW, the feed the site reads live. GSMaP_NRT (slower, gauge-adjusted) was used for comparison; thresholds are never mixed between the two.</li>
              <li><strong>Rain gauges.</strong> Met Department stations Colombo, Katunayake and Ratmalana, via OGIMET synoptic reports and NOAA GHCN-Daily.</li>
              <li><strong>River levels.</strong> Nagalagam Street and Hanwella from the DMC&rsquo;s river-level reports and the Irrigation Department record.</li>
              <li><strong>Floods.</strong> DMC situation reports (4,809 listed, 3,587 read), Copernicus EMS and news in English, Sinhala and Tamil; each flood given a confidence. Floods that are only road flooding elsewhere in Colombo, wind events and warnings with no impact are not counted as floods.</li>
              <li><strong>Scoring.</strong> An alarm episode is a run of days at or above the threshold. It is a hit if a flood began from the day before to the day after. Intervals: Wilson for the share caught, exact Poisson for alarms a year. Thresholds were checked by leaving one year out at a time, and 16 floods is too few to say more than that the choice is on a plateau (105 to 135 mm).</li>
            </ul>
            <p className="mt-2">The table of the 16 floods with the rain and river figures is a <a className={`${a} inline-flex items-center gap-1`} href={WF_CSV} download><Download className="size-3.5" aria-hidden />CSV download</a>.</p>
          </section>

          <section aria-labelledby="limits">
            <h2 id="limits" className={h2}>Limits and open questions</h2>
            <ul className="mt-2 list-disc pl-5 space-y-1.5">
              <li>Small street flooding is almost never reported. The list of floods is biased toward big Kelani floods and days the DMC counted families, so false-alarm numbers are upper bounds and the small local floods are under-represented.</li>
              <li>Sixteen floods. A difference of one flood moves the share caught by 6 points; the intervals are about 20 points either side.</li>
              <li>The cap on hourly rain was picked from four caps on these same floods. It should be tested again after the next wet season.</li>
              <li>Satellite rain is one pixel box, not a gauge in the neighbourhood. The satellite algorithm changed three times; no step change in skill was found at any of those dates.</li>
              <li>The rule reads observed rain, so the warning time is hours, not a day.</li>
              <li>The 22 Oct 2026 flood is one resident&rsquo;s report. Whether the evening of 12 Oct 2026, when Colombo city roads flooded, also put water on Wellampitiya streets is unknown.</li>
            </ul>
            <h3 className="mt-4 font-medium text-slate-900 dark:text-slate-100">What would improve it</h3>
            <ul className="mt-1.5 list-disc pl-5 space-y-1.5">
              <li><strong>Residents&rsquo; reports.</strong> Dated reports of when streets did and did not get water are the most valuable missing data. Please answer &ldquo;Did the streets near you get water?&rdquo; on the <Link className={a} href={p("/flood/wellampitiya")}>Wellampitiya page</Link> (or your own town&rsquo;s page). It is anonymous.</li>
              <li><strong>Canal water levels.</strong> The Colombo canals are monitored by the Center for Urban Water (CUrW), part of the Sri Lanka Land Development Corporation. We have asked for permission to use its data; until we have it, none of it is used or published here.</li>
              <li><strong>Survey Department LiDAR.</strong> Height data at street scale would replace the 1 to 1.6 m error of global models, and make a flood-depth map worth trying.</li>
              <li><strong>A rain gauge in the neighbourhood</strong> would remove the biggest error, the satellite pixel.</li>
              <li><strong>Hanwella and Nagalagam hourly before Nov 2025</strong> from the Irrigation Department, to test the river trigger on continuous data.</li>
            </ul>
          </section>

          <section aria-labelledby="credits">
            <h2 id="credits" className={h2}>Credits and licences</h2>
            <ul className="mt-2 list-disc pl-5 space-y-1.5">
              <li>{GSMAP_CREDIT} Satellite rain: <a className={a} href="https://sharaku.eorc.jaxa.jp/GSMaP/" {...ext}>GSMaP_NOW and GSMaP_NRT</a>, used under JAXA&rsquo;s terms; the figures and table here show derived values only.</li>
              <li>Flood maps and satellite images: contains modified Copernicus Emergency Management Service information (<a className={a} href="https://rapidmapping.emergency.copernicus.eu/EMSR851" {...ext}>EMSR851</a>) and Copernicus Sentinel-1 and Sentinel-2 data (European Union / ESA), free, full and open. Copernicus Global Flood Monitoring is part of GloFAS.</li>
              <li>ESA: Sentinel-1 and Sentinel-2 imagery and the Copernicus GLO-30 elevation model (provided by ESA, produced by Airbus) were used for the radar and terrain tests. NASA: the MODIS and VIIRS global flood products were reviewed, but at 250 m they cannot resolve a town and are not used.</li>
              <li>Rain gauges: Sri Lanka Meteorological Department synoptic stations, as published by <a className={a} href="https://www.ogimet.com/" {...ext}>OGIMET</a> and <a className={a} href="https://www.ncei.noaa.gov/products/land-based-station/global-historical-climatology-network-daily" {...ext}>NOAA GHCN-Daily</a>.</li>
              <li>River levels, flood dates and warnings: <a className={a} href="https://www.dmc.gov.lk/" {...ext}>Disaster Management Centre</a> and <a className={a} href="https://www.irrigation.gov.lk/" {...ext}>Department of Irrigation</a>, Sri Lanka. For individual floods, for example the <a className={a} href="https://reliefweb.int/attachments/06e16a4e-9667-315b-ba02-25ee8309cc9e/Situation_Report__on_2018__1539091743.pdf" {...ext}>DMC situation report of 9 Oct 2018</a> and the <a className={a} href="https://newsfirst.lk/2020/09/09/colombo-flooded-after-several-hours-of-rain/" {...ext}>Newsfirst report of 9 Sep 2020</a>. News is cited for facts only.</li>
              <li>No data from CUrW is used or published (see above). This is an independent study, not an official warning: in an emergency call 117 and follow the <a className={a} href="https://www.dmc.gov.lk/" {...ext}>DMC</a>.</li>
              <li>The figures and text are by {OWNER.name}. The code and the archive are open: <a className={a} href="https://github.com/shakee93/sl-water-levels" {...ext}>github.com/shakee93/sl-water-levels</a>.</li>
            </ul>
          </section>

          <section className={card} aria-labelledby="cite">
            <h2 id="cite" className={`${h2} flex items-center gap-2`}><Quote className="size-5 text-sky-600 dark:text-sky-400" aria-hidden />How to cite</h2>
            <p className="mt-2 rounded-lg bg-slate-100 dark:bg-slate-800/70 px-3 py-2 text-xs sm:text-sm font-mono break-words text-slate-800 dark:text-slate-200">{WF_CITE}</p>
            <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
              Author: {OWNER.name} (<a className={a} href={OWNER.x} {...ext} rel="noreferrer me">x.com/shakeeb_x</a>). Published {WF_PUBLISHED}. Last updated {WF_MODIFIED}. Web address: <a className={a} href={abs("en", WF_PATH)}>{abs("en", WF_PATH).replace("https://", "")}</a>. Corrections welcome on X or as an <a className={a} href="https://github.com/shakee93/sl-water-levels/issues" {...ext}>issue on GitHub</a>. {SITE_NAME} is run by one person and is not an official warning service.
            </p>
          </section>
        </div>
      </article>
    </main>
  );
}
