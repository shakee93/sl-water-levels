import { AlertTriangle, Siren } from "lucide-react";
import { fetchBasinSnapshot } from "@/lib/arcgis";
import { detectAnomaly } from "@/lib/anomaly";
import { getI18n } from "@/lib/i18n/server";
import type { Locale } from "@/lib/i18n/config";

// The banner text in si / ta (DRAFT translations, marked "machine-translated" under the text). The detector's own English message and reasons
// (lib/anomaly.ts) stay the source; this picks the same case in the page language. The reasons carry figures and stay English (marked).
const MESSAGE: Record<"likely" | "rain" | "norain", { si: string; ta: string }> = {
  likely: {
    si: "උඩුගං මුදාහැරීමක් විය හැක: මෙහි ඉහළ යාම වර්ෂාවෙන් හෝ ස්වභාවික උඩුගං ජල ගලනයෙන් පැහැදිලි නොවේ.",
    ta: "மேலே நீர் திறக்கப்பட்டிருக்கலாம்: இங்கு உயர்வை மழையாலோ இயற்கையான மேலிருந்து வரும் நீராலோ விளக்க முடியவில்லை.",
  },
  rain: {
    si: "මෙහි අසාමාන්‍ය ඉහළ යාමක් ඇත: සාමාන්‍ය හේතු එකක් හෝ කිහිපයක් නොගැළපේ.",
    ta: "இங்கு வழக்கத்துக்கு மாறான உயர்வு உள்ளது: இயல்பான காரணங்களில் ஒன்று அல்லது சில பொருந்தவில்லை.",
  },
  norain: {
    si: "මෙහි අසාමාන්‍ය ඉහළ යාමක් ඇත: උඩුගං මාන ඒ අනුව ඉහළ යන්නේ නැත, නමුත් මුදාහැරීමක් තහවුරු කිරීමට වර්ෂා දත්ත නැත.",
    ta: "இங்கு வழக்கத்துக்கு மாறான உயர்வு உள்ளது: மேலுள்ள நிலையங்கள் அதற்கேற்ப உயரவில்லை, ஆனால் நீர் திறப்பை உறுதிப்படுத்த மழைத் தரவு இல்லை.",
  },
};

export async function Anomaly({
  lang,
  basin,
  selectedStation,
}: {
  lang: Locale;
  basin: string;
  selectedStation: string;
}) {
  if (!basin) return null;
  const { t } = getI18n(lang);
  const snapshot = await fetchBasinSnapshot(basin);
  if (snapshot.length === 0) return null;
  const a = detectAnomaly(basin, snapshot, selectedStation);

  if (a.status === "normal" || !a.message) return null;

  const isLikely = a.status === "likely_release";
  const Icon = isLikely ? Siren : AlertTriangle;
  const bg = isLikely
    ? "bg-red-50 dark:bg-red-950/40 border-red-200 dark:border-red-900"
    : "bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-900";
  const iconColor = isLikely
    ? "text-red-600 dark:text-red-400"
    : "text-amber-600 dark:text-amber-400";
  const titleColor = isLikely
    ? "text-red-900 dark:text-red-200"
    : "text-amber-900 dark:text-amber-200";
  const bodyColor = isLikely
    ? "text-red-800 dark:text-red-300"
    : "text-amber-800 dark:text-amber-300";

  return (
    <section className={`mt-6 rounded-xl border ${bg} p-4`}>
      <div className="flex items-start gap-3">
        <Icon className={`size-5 shrink-0 mt-0.5 ${iconColor}`} aria-hidden />
        <div className="flex-1 min-w-0">
          <h3 className={`text-base font-semibold ${titleColor}`}>
            {isLikely ? t("anomaly.likely") : t("anomaly.unusual")}
          </h3>
          {lang === "en" ? (
            <p className={`mt-1 text-sm ${bodyColor}`}>{a.message}</p>
          ) : (
            <p className={`mt-1 text-sm ${bodyColor}`} lang={lang}>
              {MESSAGE[isLikely ? "likely" : a.rainKnown ? "rain" : "norain"][lang]} <span className="text-xs opacity-70">({t("common.machineTranslated")})</span>
            </p>
          )}
          {a.reasons.length > 0 && (
            <details className={`text-sm ${bodyColor}`}>
              <summary className="cursor-pointer min-h-11 inline-flex items-center rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500">
                {t("anomaly.why")}
              </summary>
              <ul className="space-y-1" lang="en">
                {lang !== "en" && <li className="opacity-80">{t("common.englishNote")}</li>}
                {a.reasons.map((r, i) => (
                  <li key={i}>· {r}</li>
                ))}
              </ul>
            </details>
          )}
        </div>
      </div>
    </section>
  );
}
