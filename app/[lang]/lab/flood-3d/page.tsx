import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { isLocale } from "@/lib/i18n/config";
import Flood3dMap from "./Flood3dMap";
import acc from "@/public/flood3d/accuracy.json";

// Unlisted test (owner, 27 Oct 2026): noindex, not in the sitemap or any menu. English only for now.
// TODO(si, ta): translate the copy when this graduates from /lab.
export async function generateMetadata({ params }: { params: Promise<{ lang: string }> }): Promise<Metadata> {
  const { lang } = await params;
  if (!isLocale(lang)) return {};
  return { title: { absolute: "Flood map test (3D)" }, description: "Test map of low ground near the Kelani river.", robots: { index: false, follow: false, nocache: true } };
}

type Row = { fit_on: string; test_on: string; area: string; method: string; csi: number; hit: number; far: number };
const pct = (v: number) => `${Math.round(v * 100)}%`;

export default async function Flood3dPage({ params }: { params: Promise<{ lang: string }> }) {
  const { lang } = await params;
  if (!isLocale(lang)) notFound();
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
      <div role="note" className="rounded-lg border border-amber-400 bg-amber-50 p-3 text-sm text-amber-950 dark:border-amber-600 dark:bg-amber-950/40 dark:text-amber-100">
        <strong>Test map.</strong> Illustration of low ground likely to flood at this river level, from 30 m satellite elevation. Not an official flood map. In an emergency call 117.
      </div>
      <h1 className="text-xl font-semibold">Where the Kelani could flood: Kelaniya first</h1>
      <p className="text-sm text-slate-700 dark:text-slate-300">Move the river level, or leave it on live, and the blue fills the low ground. Tap anywhere for the level at which that spot floods. Roads turn orange and red where they sit on low ground.</p>
      <Flood3dMap />
      <section className="space-y-2 rounded-lg border border-slate-200 p-3 text-sm dark:border-slate-700" data-testid="flood3d-accuracy">
        <h2 className="font-semibold">How good is it? (Kelaniya area, honest numbers)</h2>
        <p>
          We tested it against the Copernicus satellite flood maps of 30 Nov and 3 Dec 2025, fitting on one day and checking on the other. The calibrated map found about <strong>{pct(learned.hit)}</strong> of the ground the satellite saw underwater, and about <strong>{pct(learned.far)}</strong> of what it painted blue was dry in the satellite map. Plain elevation bands (no calibration): found {pct(plain.hit)}, {pct(plain.far)} painted blue was dry. A random guess scores far lower, but this is still a rough guide: it ignores drains, pumps, bunds and tide, and 30 m elevation is wrong by a metre or more in built-up streets.
        </p>
        <details>
          <summary className="cursor-pointer text-xs text-slate-600 dark:text-slate-400">Numbers per test</summary>
          <table className="mt-2 w-full text-xs">
            <thead><tr className="text-left"><th>Fitted on</th><th>Tested on</th><th>Method</th><th>Found</th><th>Painted but dry</th><th>Overall score (CSI)</th></tr></thead>
            <tbody>
              {rows.filter((r) => !r.method.includes("cheating")).map((r, i) => (
                <tr key={i}><td>{r.fit_on === "E1" ? "30 Nov" : "3 Dec"}</td><td>{r.test_on === "E1" ? "30 Nov" : "3 Dec"}</td><td>{r.method === "learned" ? "Calibrated" : "Plain elevation band"}</td><td>{pct(r.hit)}</td><td>{pct(r.far)}</td><td>{r.csi.toFixed(2)}</td></tr>
              ))}
            </tbody>
          </table>
        </details>
      </section>
      <p className="text-xs text-slate-500">
        Data: Copernicus GLO-30 elevation (ESA, free licence); Copernicus Emergency Management Service EMSR851 flood extents, contains modified Copernicus EMS information; map and roads © OpenStreetMap contributors (ODbL) via OpenFreeMap; terrain tiles Mapzen/AWS; river levels Irrigation Department (ArcGIS) and HMIS via waterlevels.lk.
      </p>
    </main>
  );
}
