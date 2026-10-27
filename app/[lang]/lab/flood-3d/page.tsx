import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { isLocale } from "@/lib/i18n/config";
import Flood3dMap from "./Flood3dMap";
import { makeT } from "./strings";
import { PLACES } from "@/lib/places";
import { BOUNDS } from "@/lib/flood3dReports";
import acc from "@/public/flood3d/accuracy.json";

// Unlisted test (owner, 27 Oct 2026): noindex, not in the sitemap or any menu. en, si and ta (si/ta are drafts, see strings.ts).
export async function generateMetadata({ params }: { params: Promise<{ lang: string }> }): Promise<Metadata> {
  const { lang } = await params;
  if (!isLocale(lang)) return {};
  return { title: { absolute: "Flood map test (3D)" }, description: "Test map of low ground near the Kelani river.", robots: { index: false, follow: false, nocache: true } };
}

type Row = { fit_on: string; test_on: string; area: string; method: string; csi: number; hit: number; far: number };
const pct = (v: number) => `${Math.round(v * 100)}%`;

// The accuracy paragraph with the numbers filled in. si/ta are DRAFTS.
const ACC: Record<"en" | "si" | "ta", (hit: string, far: string, phit: string, pfar: string) => string> = {
  en: (hit, far, phit, pfar) => `We tested it against the Copernicus satellite flood maps of 30 Nov and 3 Dec 2025, fitting on one day and checking on the other. The calibrated map found about ${hit} of the ground the satellite saw underwater, and about ${far} of what it painted blue was dry in the satellite map. Plain elevation bands (no calibration): found ${phit}, ${pfar} painted blue was dry. A random guess scores far lower, but this is still a rough guide: it ignores drains, pumps, bunds and tide, and 30 m elevation is wrong by a metre or more in built-up streets.`,
  si: (hit, far, phit, pfar) => `අපි මෙය 2025 නොවැ. 30 සහ දෙසැ. 3 Copernicus චන්ද්‍රිකා ගංවතුර සිතියම් සමඟ පරීක්ෂා කළෙමු (එක් දිනකින් ගැලපී අනෙක් දිනෙන් පරීක්ෂා කිරීම). ක්‍රමාංකිත සිතියම චන්ද්‍රිකාවට ජලයෙන් යට වූ බිමෙන් ආසන්න වශයෙන් ${hit}ක් හඳුනාගත් අතර, එය නිල් පාට කළ ප්‍රදේශයෙන් ${far}ක් චන්ද්‍රිකා සිතියමේ වියළි විය. සරල උස කලාප (ක්‍රමාංකනයක් නැතිව): ${phit}ක් හඳුනාගත්තා, නිල් පාට කළ ප්‍රදේශයෙන් ${pfar}ක් වියළි විය. අහඹු අනුමානයකට වඩා බෙහෙවින් හොඳය, නමුත් මෙය තවමත් දළ මඟපෙන්වීමකි: ඇළ, පොම්ප, බන්ධ සහ මුහුදු රළ නොසලකයි, ගොඩනැගිලි සහිත වීදිවල මීටර් 30 උස දත්ත මීටරයක් හෝ ඊට වැඩි වශයෙන් වැරදිය හැක.`,
  ta: (hit, far, phit, pfar) => `2025 நவ. 30 மற்றும் டிச. 3 ஆகிய Copernicus செயற்கைக்கோள் வெள்ள வரைபடங்களுடன் இதைச் சோதித்தோம் (ஒரு நாளில் பொருத்தி மற்றொன்றில் சரிபார்த்தல்). அளவுத்திருத்திய வரைபடம் செயற்கைக்கோள் நீருக்குள் கண்ட நிலத்தில் சுமார் ${hit} ஐக் கண்டறிந்தது; அது நீல நிறமிட்டதில் சுமார் ${far} செயற்கைக்கோள் வரைபடத்தில் வறண்டிருந்தது. எளிய உயரப் பட்டைகள் (அளவுத்திருத்தம் இல்லாமல்): ${phit} கண்டறிந்தது, நீல நிறமிட்டதில் ${pfar} வறண்டது. தற்செயல் ஊகத்தைவிட மிகவும் நல்லது, ஆனாலும் இது தோராயமான வழிகாட்டி மட்டுமே: வடிகால், பம்புகள், கரைகள், ஓதம் ஆகியவற்றைப் புறக்கணிக்கிறது; கட்டடங்கள் நிறைந்த தெருக்களில் 30 மீ உயரத் தரவு ஒரு மீட்டர் அல்லது அதற்கு மேல் தவறலாம்.`,
};

export default async function Flood3dPage({ params }: { params: Promise<{ lang: string }> }) {
  const { lang } = await params;
  if (!isLocale(lang)) notFound();
  const tr = makeT(lang);
  // Search index (towns with their Sinhala/Tamil aliases, and the gauges in this corridor): small, passed as props; the place and road names load on first focus.
  const inside = (p: { lat: number; lon: number }) => p.lat >= BOUNDS.south && p.lat <= BOUNDS.north && p.lon >= BOUNDS.west && p.lon <= BOUNDS.east;
  const towns = PLACES.filter(inside).map((p) => ({ n: p.name, lat: p.lat, lon: p.lon, al: p.aliases }));
  const gauges = [{ n: "Nagalagam Street", lat: 6.958265, lon: 79.878642 }, { n: "Hanwella", lat: 6.9097, lon: 80.083126 }];
  const rows = (acc.loeo as Row[]).filter((r) => r.area === "Kelaniya");
  const avg = (pred: (r: Row) => boolean) => {
    const rs = rows.filter(pred);
    const m = (k: "csi" | "hit" | "far") => rs.reduce((s, r) => s + r[k], 0) / Math.max(1, rs.length);
    return { hit: m("hit"), far: m("far"), csi: m("csi") };
  };
  const learned = avg((r) => r.method === "learned");
  const plain = avg((r) => r.method.startsWith("plain HAND<="));
  return (
    <main className="mx-auto max-w-5xl space-y-3 px-4 py-4">
      <Flood3dMap towns={towns} gauges={gauges} lang={lang} />
      <section className="space-y-2 rounded-lg border border-slate-200 p-3 text-sm dark:border-slate-700" data-testid="flood3d-accuracy">
        <h2 className="font-semibold">{tr("How good is it? (Kelaniya area, honest numbers)")}</h2>
        <p>{ACC[lang](pct(learned.hit), pct(learned.far), pct(plain.hit), pct(plain.far))}</p>
        <details>
          <summary className="cursor-pointer text-xs text-slate-600 dark:text-slate-400">{tr("Numbers per test")}</summary>
          <table className="mt-2 w-full text-xs">
            <thead><tr className="text-left"><th>{tr("Fitted on")}</th><th>{tr("Tested on")}</th><th>{tr("Method")}</th><th>{tr("Found")}</th><th>{tr("Painted but dry")}</th><th>{tr("Overall score (CSI)")}</th></tr></thead>
            <tbody>
              {rows.filter((r) => !r.method.includes("cheating")).map((r, i) => (
                <tr key={i}><td>{tr(r.fit_on === "E1" ? "30 Nov" : "3 Dec")}</td><td>{tr(r.test_on === "E1" ? "30 Nov" : "3 Dec")}</td><td>{r.method === "learned" ? tr("Calibrated") : tr("Plain elevation band")}</td><td>{pct(r.hit)}</td><td>{pct(r.far)}</td><td>{r.csi.toFixed(2)}</td></tr>
              ))}
            </tbody>
          </table>
        </details>
      </section>
      <p className="text-xs text-slate-500">
        {tr("Data: Copernicus GLO-30 elevation (ESA, free licence); Copernicus Emergency Management Service EMSR851 flood extents, contains modified Copernicus EMS information; map and roads © OpenStreetMap contributors (ODbL) via OpenFreeMap; terrain tiles Mapzen/AWS; rain: GSMaP (JAXA) and HMIS ground gauges; river levels Irrigation Department (ArcGIS) and HMIS via waterlevels.lk.")}
      </p>
    </main>
  );
}
