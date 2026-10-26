import { getI18n } from "@/lib/i18n/server";
import type { Locale } from "@/lib/i18n/config";
import { RESERVOIR_COORDS } from "@/lib/reservoirCoords";
import { rainWord } from "@/lib/rainWords";
import { getTownRain } from "@/lib/townWeather";

const NOTABLE_MM = 10;

/**
 * Rain forecast at the dam itself (the weather model's cell at the dam's coordinates, lib/reservoirCoords.ts), next to the agency's
 * daily rain figure, which is a single point reading up to a day old. Only for dams with checked coordinates, only when 10 mm or more
 * is forecast, and always called a forecast model estimate. No satellite number: GSMaP is only computed per river-gauge catchment.
 */
export async function ReservoirRain({ lang, slug }: { lang: Locale; slug: string }) {
  const c = RESERVOIR_COORDS[slug];
  if (!c) return null;
  const r = await getTownRain(c.lat, c.lon).catch(() => null);
  if (!r || !r.ok || r.data.next24hMm < NOTABLE_MM) return null;
  const { t } = getI18n(lang);
  const mm = r.data.next24hMm;
  return (
    <p data-reservoir-rain className="mt-2 text-xs text-slate-600 dark:text-slate-400">
      {t("rv.rainNear", { mm: mm < 100 ? Math.round(mm) : Math.round(mm / 5) * 5, word: rainWord("24h", mm, lang) ?? "" })}
    </p>
  );
}
