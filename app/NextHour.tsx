// Server components that add the next-hour forecast to a page's answer text and FAQ without holding the
// page back: they sit inside <Suspense>, so the heading, the first answer sentence and the shell are sent
// first and these stream in behind them (the forecast is cached per river and time-boxed to 1.5 s).
// If the forecast is not ready in time they render the page's normal text without the next-hour part.
import { AnswerLine, FaqList, JsonLd } from "@/app/Answer";
import { nextHourSentence, type Faq } from "@/lib/answers";
import type { Locale } from "@/lib/i18n/config";
import { getNextHourForBasin, timeBox, type NextHour } from "@/lib/nextHour";
import { faqLd } from "@/lib/seo";

type NhMap = Record<string, NextHour | null> | null;
const forBasin = (basin: string): Promise<NhMap> => timeBox(getNextHourForBasin(basin));

/** The second sentence under a station heading: "In the next hour it is expected to ...". Nothing when there is no forecast. */
export async function StationNextHourLine({ lang, basin, station }: { lang: Locale; basin: string; station: string }) {
  const nh = (await forBasin(basin))?.[station] ?? null;
  const text = nextHourSentence(lang, nh);
  return text ? <AnswerLine text={text} className="mt-1" /> : null;
}

/** The FAQ block (visible list + FAQPage JSON-LD built from the same items) once the next-hour answer is known. */
export async function NextHourFaq({
  lang,
  basin,
  build,
  note,
}: {
  lang: Locale;
  basin: string | null;
  build: (m: NhMap) => Faq[];
  note?: string;
}) {
  const m = basin ? await forBasin(basin) : null;
  const items = build(m);
  if (!items.length) return null;
  return (
    <>
      <JsonLd graph={[faqLd(items)]} />
      <FaqList lang={lang} items={items} note={note} />
    </>
  );
}
