import Link from "next/link";
import type { Metadata } from "next";
import { Activity, AlertTriangle, Database } from "lucide-react";

export const revalidate = 86400;

const SITE = "https://sl-water-levels.vercel.app";

export const metadata: Metadata = {
  title: "About",
  description:
    "Where the river levels come from, what alert, minor flood and major flood mean, and how the next-hour and next-24-hour forecast works.",
  alternates: { canonical: "/about" },
  openGraph: {
    title: "About — Sri Lanka Water Levels",
    description:
      "Where the river levels come from, what the flood levels mean, and how the forecast works.",
    url: `${SITE}/about`,
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "About — Sri Lanka Water Levels",
    description:
      "Where the river-gauge data comes from, what the flood thresholds mean, and how the next-hour forecast works.",
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
          <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight">About</h1>
          <p className="text-slate-600 dark:text-slate-400 mt-2 max-w-prose">
            A free, independent site that shows how high Sri Lanka&apos;s rivers are right now,
            whether they&apos;re rising, and what to expect next, using the Department of
            Irrigation&apos;s own river gauges.
          </p>
        </header>

        <section className="space-y-8">
          <Card icon={<Database className="size-5" />} title="Where the readings come from">
            <p>
              Every level on this site comes from the Department of Irrigation&apos;s river
              gauges. Gauges report about once an hour, and the site shows the newest reading
              with the time it was taken.
            </p>
            <p>
              Official flood warnings are taken from the Disaster Management Centre and shown
              on the river they mention, with a link to the original bulletin.
            </p>
          </Card>

          <Card icon={<AlertTriangle className="size-5" />} title="What the levels mean">
            <ul className="list-disc pl-5 space-y-1.5">
              <li>
                <strong>Alert</strong>: the river is high. Keep an eye on it and get ready.
              </li>
              <li>
                <strong>Minor flood</strong>: low-lying areas near the river may flood.
              </li>
              <li>
                <strong>Major flood</strong>: serious flooding. Follow official instructions.
              </li>
            </ul>
            <p>These levels are set by the Department of Irrigation for each gauge.</p>
          </Card>

          <Card icon={<Activity className="size-5" />} title="The forecast">
            <p>
              The &quot;next hour&quot; and &quot;next 24 hours&quot; estimates look at how the
              river has been moving, what the gauges upstream are doing, and the rain falling
              and forecast over the hills that drain into it.
            </p>
            <p>
              It&apos;s new and still learning from this season&apos;s data, so it&apos;s marked
              experimental. Always go by official warnings first.
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
