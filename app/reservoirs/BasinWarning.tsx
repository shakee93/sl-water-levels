import { TriangleAlert } from "lucide-react";
import { ClampedText } from "@/app/ClampedText";
import { getOfficialWarnings, warningsForBasin } from "@/lib/warnings";
import { getI18n } from "@/lib/i18n/server";
import type { Locale } from "@/lib/i18n/config";

/** The compact amber line of a current official bulletin naming this basin (same as the river page). Fails soft. */
export async function BasinWarning({ basin, lang }: { basin: string; lang: Locale }) {
  const { t } = getI18n(lang);
  const w = warningsForBasin(await getOfficialWarnings().catch(() => ({ warnings: [] })), basin)[0];
  if (!w) return null;
  return (
    <div className="mb-4 flex items-start gap-2 rounded-lg border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 px-3 py-2 text-sm text-amber-900 dark:text-amber-200">
      <TriangleAlert className="size-4 mt-0.5 shrink-0" aria-hidden />
      <div className="min-w-0">
        <ClampedText
          footer={
            <a href={w.url} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 inline-flex items-center min-h-11 sm:min-h-6 whitespace-nowrap">
              {w.source}
            </a>
          }
        >
          {w.summary}{lang !== "en" && <span className="text-amber-800/80 dark:text-amber-300/80"> {t("common.englishNote")}</span>}
        </ClampedText>
      </div>
    </div>
  );
}
