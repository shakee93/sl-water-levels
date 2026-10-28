import { hmisT } from "@/lib/i18n/hmis";
import type { Locale } from "@/lib/i18n/config";
import { formatDelta, formatLevel } from "@/lib/units";
import type { NationalStation } from "@/lib/arcgis";
import { RivernetNote } from "@/app/RivernetNote";

const HOUR = 3_600_000;

/**
 * Credit for a gauge that only HMIS has (source "hmis"), plus, for Karawanella Bridge, what it means downstream. Hanwella and
 * Glencourse get the reverse: Karawanella's level now as an early signal, no travel time claimed (none has been measured).
 */
export function HmisGaugeNote({ lang, station, nat, all }: { lang: Locale; station: string; nat: NationalStation | null; all: NationalStation[] }) {
  const h = hmisT(lang);
  const draft = lang !== "en" ? (lang === "si" ? " (කෙටුම්පත් පරිවර්තනය)" : " (வரைவு மொழிபெயர்ப்பு)") : "";
  const kara = all.find((s) => s.station === "Karawanella Bridge");
  const early =
    (station === "Glencourse" || station === "Hanwella") && kara?.latest && kara.ageMin != null && kara.ageMin < 180 ? kara : null;
  const change = early?.latest ? early.rate3h : null;
  const dir = change == null ? null : change > 0.02 ? "rising" : change < -0.02 ? "falling" : "steady";
  return (
    <>
      {nat?.source === "rivernet" && <RivernetNote lang={lang} station={station} nat={nat} />}
      {nat?.source === "hmis" && (
        <p className="mt-2 text-xs text-slate-500 dark:text-slate-400" data-testid="hmis-credit">
          {h("gauge.note", { n: nat.cadenceMin ?? 30 })} {h("creditWith", { inst: nat.institute ?? "" })}.{draft}
          {station === "Karawanella Bridge" && <span className="block mt-1">{h("gauge.upstream")}</span>}
        </p>
      )}
      {early && early.latest && (
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-300" data-testid="karawanella-early">
          {lang === "en"
            ? `Upstream on the Kelani Ganga, Karawanella Bridge is at ${formatLevel(early.latest.water_level, early.unit)}${dir && dir !== "steady" ? ` and ${dir}` : ""}${change != null && Math.abs(change) > 0.02 ? ` (${formatDelta(change * 3, early.unit, { sign: true })} in 3 hours)` : ""}. An early sign only: no travel time has been measured.`
            : h("gauge.upstream") + draft}
          {" "}
          <span className="text-xs text-slate-500 dark:text-slate-400">{h("creditWith", { inst: early.institute ?? "ACCIMT" })}.</span>
        </p>
      )}
    </>
  );
}
