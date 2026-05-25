import Link from "next/link";
import type { Metadata } from "next";
import { Activity, AlertTriangle, Clock, Database, Radio, Ruler } from "lucide-react";

export const revalidate = 86400;

const SITE = "https://sl-water-levels.vercel.app";

export const metadata: Metadata = {
  title: "About & methodology",
  description:
    "How Sri Lanka Water Levels sources data, what alert / minor-flood / major-flood thresholds mean, how the next-hour forecast works, and how the site handles the unit and ordering quirks of the Department of Irrigation feed.",
  alternates: { canonical: "/about" },
  openGraph: {
    title: "About — Sri Lanka Water Levels",
    description:
      "Methodology, data sources, thresholds, and forecast model behind the site.",
    url: `${SITE}/about`,
    type: "website",
  },
};

export default function AboutPage() {
  return (
    <main className="bg-gradient-to-b from-slate-50 to-white dark:from-slate-950 dark:to-slate-900">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8 sm:py-12">
        <nav className="text-xs text-slate-500 dark:text-slate-400 mb-3">
          <Link href="/" className="hover:underline">
            All basins
          </Link>{" "}
          <span aria-hidden>›</span>{" "}
          <span className="text-slate-700 dark:text-slate-300">About</span>
        </nav>

        <header className="mb-8">
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-sky-700 dark:text-sky-400 font-medium mb-2">
            <span className="size-1.5 rounded-full bg-sky-500" />
            About
          </div>
          <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight">
            About & methodology
          </h1>
          <p className="text-slate-600 dark:text-slate-400 mt-2 max-w-prose">
            This site is a community-built window onto the Sri Lanka Department
            of Irrigation&apos;s real-time river-gauge feed — re-plotted against
            the same flood thresholds the Department uses, with a short next-hour
            forecast layered on top.
          </p>
        </header>

        <section className="space-y-8">
          <Card icon={<Database className="size-5" />} title="Where the data comes from">
            <p>
              All readings are pulled from the Department of Irrigation&apos;s public{" "}
              <a
                className="underline decoration-slate-400/40 hover:text-sky-700 dark:hover:text-sky-300"
                href="https://services3.arcgis.com/J7ZFXmR8rSmQ3FGf/arcgis/rest/services/gauges_2_view/FeatureServer/0"
                target="_blank"
                rel="noreferrer"
              >
                ArcGIS feature service
              </a>
              . That feed is the source of truth for water-level, rainfall, and
              threshold data. Each station also has hydrostations metadata
              (latitude, longitude, basin) which the site uses to group stations
              by river and order them upstream → downstream.
            </p>
            <p>
              No database is involved. The feed is fetched on demand and ISR-cached
              for 60 seconds, so under typical traffic each station triggers at most
              one upstream call per minute.
            </p>
          </Card>

          <Card icon={<AlertTriangle className="size-5" />} title="What the thresholds mean">
            <p>
              Each station has three thresholds published by the Department,
              shown on every chart as horizontal reference lines:
            </p>
            <ul className="list-disc pl-5 space-y-1.5">
              <li>
                <strong>Alert</strong> — water level the Department flags as
                worth attention. People living near the gauge should keep an eye
                on the river.
              </li>
              <li>
                <strong>Minor flood</strong> — low-lying areas near the river
                may start to flood. Local action — moving valuables, checking
                drains — is appropriate.
              </li>
              <li>
                <strong>Major flood</strong> — significant flooding expected.
                Follow Department and Disaster Management Centre instructions.
              </li>
            </ul>
            <p>
              These thresholds come directly from the feed. The site does not
              substitute its own values or interpret them — it only re-presents
              them next to the current reading.
            </p>
          </Card>

          <Card icon={<Ruler className="size-5" />} title="Units (meters vs feet)">
            <p>
              The source feed does not include unit metadata. Most stations
              report in <strong>feet</strong>, but some highland stations on the
              Kelani basin (Norwood, for example) report in <strong>meters</strong>.
              The site uses a heuristic based on threshold values to detect the
              unit per station, and only displays a unit suffix when confidence
              is high.
            </p>
            <p>
              If a station&apos;s unit looks wrong, the safest interpretation is
              the published threshold values: alert / minor / major are in the
              same unit as the current reading for that station.
            </p>
          </Card>

          <Card icon={<Activity className="size-5" />} title="Next-hour forecast">
            <p>
              The forecast panel under each station combines three signals:
            </p>
            <ul className="list-disc pl-5 space-y-1.5">
              <li>
                <strong>Persistence</strong> — what the level has been doing in
                the last few hours at this station.
              </li>
              <li>
                <strong>Upstream momentum</strong> — whether stations upstream
                on the same basin are rising or falling, with travel-time
                weighting.
              </li>
              <li>
                <strong>Rainfall</strong> — recent rainfall at the gauge (when
                available; many downstream gauges don&apos;t report rain).
              </li>
            </ul>
            <p>
              The model is direction-correct in most cases; <em>magnitudes are
              not calibrated against historical flood events</em>, so treat
              numbers as indicative, not predictive. The anomaly banner above
              the chart fires when the level jumps in a way that looks like an
              inferred upstream release.
            </p>
          </Card>

          <Card icon={<Clock className="size-5" />} title="How often it updates">
            <p>
              The Department&apos;s gauges publish at roughly hourly cadence;
              the site re-fetches at most every 60 seconds (ISR). Each station
              page is statically prerendered at build time and then revalidated
              on traffic. Sitemap entries refresh hourly.
            </p>
          </Card>

          <Card icon={<Radio className="size-5" />} title="MCP server">
            <p>
              The same dataset is exposed as an MCP (Model Context Protocol)
              server at{" "}
              <code className="font-mono text-xs px-1 py-0.5 rounded bg-slate-100 dark:bg-slate-800">
                /mcp
              </code>{" "}
              — point a compatible LLM client at it to ask questions like
              &quot;is Kelani rising right now?&quot; or &quot;list the top 3
              stations closest to major flood&quot;.
            </p>
          </Card>

          <div className="rounded-xl border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/30 p-4 sm:p-5 text-sm">
            <div className="font-semibold text-amber-900 dark:text-amber-200 mb-1">
              Not an official warning service
            </div>
            <p className="text-amber-800 dark:text-amber-300/90">
              For official flood warnings, follow the{" "}
              <a
                className="underline"
                href="https://www.dmc.gov.lk/"
                target="_blank"
                rel="noreferrer"
              >
                Disaster Management Centre
              </a>{" "}
              and the{" "}
              <a
                className="underline"
                href="https://www.irrigation.gov.lk/"
                target="_blank"
                rel="noreferrer"
              >
                Department of Irrigation
              </a>
              . This site is a re-presentation of public data for situational
              awareness and is not affiliated with either agency.
            </p>
          </div>

          <div className="text-sm text-slate-600 dark:text-slate-400">
            Source code is open at{" "}
            <a
              className="underline decoration-slate-400/40 hover:text-sky-700 dark:hover:text-sky-300"
              href="https://github.com/shakee93/sl-water-levels"
              target="_blank"
              rel="noreferrer"
            >
              github.com/shakee93/sl-water-levels
            </a>
            . Patches welcome.
          </div>
        </section>
      </div>
    </main>
  );
}

function Card({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <article className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 sm:p-6">
      <header className="flex items-center gap-2.5 mb-3">
        <span className="grid place-items-center size-9 rounded-lg bg-sky-50 dark:bg-sky-950/50 text-sky-700 dark:text-sky-300">
          {icon}
        </span>
        <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
      </header>
      <div className="space-y-3 text-sm text-slate-700 dark:text-slate-300 leading-relaxed">
        {children}
      </div>
    </article>
  );
}
