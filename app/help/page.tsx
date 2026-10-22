import Link from "next/link";
import type { Metadata } from "next";
import { ChevronDown, ExternalLink, Phone } from "lucide-react";
import {
  DONATING_SAFELY,
  EMERGENCY_CONTACTS,
  FAMILY_ABROAD,
  GUIDANCE,
  HELP_CHECKED,
  HELP_SOURCES,
  LABELS,
  RELIEF_STEPS,
  WARNING_CHANNELS,
} from "@/lib/help";
import { DistrictPicker } from "./HelpClient";

export const revalidate = 86400;

const SITE = "https://sl-water-levels.vercel.app";
const TITLE = "Flood help Sri Lanka — emergency numbers, what to do";
const DESC =
  "Emergency numbers for floods in Sri Lanka (DMC 117, Police 119, Ambulance 1990), your district DMC office, and short steps for before, during and after a flood.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESC,
  alternates: { canonical: "/help" },
  openGraph: { title: TITLE, description: DESC, url: `${SITE}/help`, type: "website" },
};

const BIG = ["dmc", "police", "ambulance"].map(
  (id) => EMERGENCY_CONTACTS.find((c) => c.id === id)!,
);
const SHORT: Record<string, string> = { dmc: "Disaster Management Centre", police: "Police", ambulance: "Ambulance" };

const jsonLd = {
  "@context": "https://schema.org",
  "@type": "WebPage",
  name: TITLE,
  description: DESC,
  url: `${SITE}/help`,
  dateModified: "2026-10-22",
  mainEntity: {
    "@type": "ItemList",
    itemListElement: EMERGENCY_CONTACTS.filter((c) => ["dmc", "police", "ambulance", "fire"].includes(c.id)).map(
      (c, i) => ({ "@type": "ListItem", position: i + 1, name: `${c.name}: ${c.number}`, url: c.source }),
    ),
  },
};

export default function HelpPage() {
  return (
    <main className="bg-gradient-to-b from-slate-50 to-white dark:from-slate-950 dark:to-slate-900">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8 sm:py-12 space-y-6">
        <nav className="text-xs text-slate-500 dark:text-slate-400">
          <Link href="/" className="hover:underline">All basins</Link> <span aria-hidden>›</span>{" "}
          <span className="text-slate-700 dark:text-slate-300">Help</span>
        </nav>

        <header>
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-sky-700 dark:text-sky-400 font-medium mb-2">
            <span className="size-1.5 rounded-full bg-sky-500" />
            <span>Help</span>
            <span lang="si" className="normal-case tracking-normal">{LABELS.help.si}</span>
            <span lang="ta" className="normal-case tracking-normal">{LABELS.help.ta}</span>
          </div>
          <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight">Flood help</h1>
          <p className="text-slate-600 dark:text-slate-400 mt-2">In danger now? Call 117.</p>
        </header>

        <section aria-labelledby="emergency-h">
          <h2 id="emergency-h" className="sr-only">Emergency numbers</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {BIG.map((c, i) => (
              <a
                key={c.id}
                href={c.tel}
                className={
                  "flex items-center gap-3 rounded-xl p-4 transition " +
                  (i === 0
                    ? "sm:col-span-2 bg-sky-700 hover:bg-sky-800 text-white"
                    : "border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800/60")
                }
              >
                <Phone className="size-6 shrink-0" aria-hidden />
                <span className="flex-1">
                  <span className="block text-2xl font-semibold tabular-nums leading-tight">
                    {i === 0 ? (
                      <>Call {c.number}</>
                    ) : (
                      c.number
                    )}
                  </span>
                  <span className={"block text-sm " + (i === 0 ? "text-sky-100" : "text-slate-500 dark:text-slate-400")}>
                    {SHORT[c.id]}
                  </span>
                  {i === 0 && (
                    <span className="block text-sm text-sky-100 mt-0.5">
                      <span lang="si">{LABELS.callDmc.si}</span> · <span lang="ta">{LABELS.callDmc.ta}</span>
                    </span>
                  )}
                </span>
              </a>
            ))}
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-2">Numbers checked {HELP_CHECKED}. Tap to call.</p>
        </section>

        <DistrictPicker />

        <div className="space-y-3">
          <Acc title="Before" open items={GUIDANCE.before.map((g) => g.text)} />
          <Acc title="During" items={GUIDANCE.during.map((g) => g.text)} />
          <Acc title="After the water goes down" items={GUIDANCE.after.map((g) => g.text)} />
          <Acc title="Relief & compensation" items={RELIEF_STEPS.map((g) => g.text)} note="Amounts and deadlines change each time. Your Divisional Secretariat has the latest." />
          <Acc title="Family abroad" items={FAMILY_ABROAD} />
          <Acc title="Donating safely" items={DONATING_SAFELY} />
        </div>

        <section aria-labelledby="warn-h" className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 sm:p-5">
          <h2 id="warn-h" className="text-lg font-semibold tracking-tight mb-3">Official warnings</h2>
          <ul className="space-y-2 text-sm">
            {WARNING_CHANNELS.map((w) => (
              <li key={w.id}>
                {w.url ? (
                  <a href={w.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-sky-700 dark:text-sky-300 hover:underline">
                    {w.name} <ExternalLink className="size-3.5" aria-hidden />
                  </a>
                ) : (
                  <Link href="/" className="text-sky-700 dark:text-sky-300 hover:underline">{w.name}</Link>
                )}
              </li>
            ))}
          </ul>
        </section>

        <footer className="text-xs text-slate-500 dark:text-slate-400 space-y-2">
          <p>Information, not an emergency service. Checked {HELP_CHECKED}.</p>
          <details className="group">
            <summary className="cursor-pointer inline-flex items-center gap-1 hover:text-slate-700 dark:hover:text-slate-200">
              Sources <ChevronDown className="size-3.5 transition group-open:rotate-180" aria-hidden />
            </summary>
            <ul className="mt-2 space-y-1 list-disc pl-5">
              {HELP_SOURCES.map((s) => (
                <li key={s.url}>
                  <a href={s.url} target="_blank" rel="noreferrer" className="underline decoration-slate-400/40 hover:text-sky-700 dark:hover:text-sky-300">{s.label}</a>
                </li>
              ))}
            </ul>
            <p className="mt-2">Police 119, ambulance 1990 and fire 110 are widely published but not confirmed on official sites.</p>
          </details>
        </footer>
      </div>
    </main>
  );
}

function Acc({ title, items, note, open }: { title: string; items: string[]; note?: string; open?: boolean }) {
  return (
    <details open={open} className="group rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
      <summary className="flex items-center justify-between gap-3 cursor-pointer list-none p-4 sm:px-5 [&::-webkit-details-marker]:hidden">
        <h2 className="text-base font-semibold tracking-tight">{title}</h2>
        <ChevronDown className="size-5 text-slate-500 transition group-open:rotate-180" aria-hidden />
      </summary>
      <div className="px-4 sm:px-5 pb-4 -mt-1">
        <ul className="list-disc pl-5 space-y-2 text-sm text-slate-700 dark:text-slate-300 leading-relaxed">
          {items.map((t) => <li key={t}>{t}</li>)}
        </ul>
        {note && <p className="text-xs text-slate-500 dark:text-slate-400 mt-3">{note}</p>}
      </div>
    </details>
  );
}
