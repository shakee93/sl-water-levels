import { getRivernetLevels, RIVERNET_NEW_BY_STATION, RIVERNET_URL } from "@/lib/rivernet";
import { getI18n } from "@/lib/i18n/server";
import { rivernetT } from "@/lib/i18n/rivernet";
import { fullStamp } from "@/lib/i18n/format";
import type { Locale } from "@/lib/i18n/config";
import type { NationalStation } from "@/lib/arcgis";

/** The credit line (with a plain link to rivernet.lk, in the language's own text). Shared by the gauge note and the "Latest" line. */
export function RivernetCredit({ lang }: { lang: Locale }) {
  const r = rivernetT(lang);
  return (
    <a href={RIVERNET_URL} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 decoration-slate-400 hover:text-sky-700 dark:hover:text-sky-300">
      {r("credit")}
    </a>
  );
}

/**
 * Source note for a gauge that only RiverNet has (source "rivernet"): what it is, the credit, that RiverNet publishes no marks when it
 * does not (so no step is shown, never invented), and, when the sensor is not reporting, when it last did (Sri Lanka time).
 */
export async function RivernetNote({ lang, station, nat }: { lang: Locale; station: string; nat: NationalStation | null }) {
  const def = RIVERNET_NEW_BY_STATION.get(station);
  if (!def) return null;
  const r = rivernetT(lang);
  const { t } = getI18n(lang);
  const draft = lang !== "en" ? (lang === "si" ? " (කෙටුම්පත් පරිවර්තනය)" : " (வரைவு மொழிபெயர்ப்பு)") : "";
  const noMarks = !nat || (nat.thresholds.alert == null && nat.thresholds.minor == null && nat.thresholds.major == null);
  let lastTs: number | null = null;
  if (!nat?.latest) {
    const dev = (await getRivernetLevels())?.devices.find((d) => d.key === def.key);
    lastTs = dev && Number.isFinite(dev.latestTs) ? dev.latestTs : null;
  }
  return (
    <div className="mt-2 text-xs text-slate-500 dark:text-slate-400" data-testid="rivernet-credit">
      <p>
        {r("gauge.note")}
        {draft}
      </p>
      {lastTs != null && <p className="mt-1">{r("gauge.last", { when: fullStamp(lastTs, t) })}</p>}
      {noMarks && <p className="mt-1">{r("gauge.noMarks")}</p>}
      <p className="mt-1">
        <RivernetCredit lang={lang} />
      </p>
    </div>
  );
}
