import { getReservoirs } from "@/lib/reservoirData";
import { RESERVOIR_COORDS } from "@/lib/reservoirCoords";
import { MapClient, type HomeLake } from "./MapClient";
import type { HomeStation } from "./tierUi";
import { getI18n } from "@/lib/i18n/server";
import type { Locale } from "@/lib/i18n/config";

export async function SriLankaMap({ lang, stations }: { lang: Locale; stations: HomeStation[] }) {
  const { t } = getI18n(lang);
  const valid = stations.filter(
    (s) => Number.isFinite(s.latitude) && Number.isFinite(s.longitude),
  );

  // Reservoirs that are spilling or releasing into a river right now, linked to their pages.
  const data = await getReservoirs().catch(() => null);
  const lakes: HomeLake[] = (data?.items ?? [])
    .filter((r) => !r.barrage && (r.status === "spilling" || (r.status === "releasing" && r.flow != null && r.flow.kind !== "outlets")) && RESERVOIR_COORDS[r.slug])
    .map((r) => ({ slug: r.slug, name: r.name, lat: RESERVOIR_COORDS[r.slug].lat, lon: RESERVOIR_COORDS[r.slug].lon, status: r.status as "spilling" | "releasing", href: `/reservoirs/${r.slug}` }));

  return (
    <section className="mb-8" aria-labelledby="map-heading">
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden shadow-sm">
        <div className="px-4 sm:px-5 py-3 border-b border-slate-200 dark:border-slate-800">
          <h2
            id="map-heading"
            className="text-base font-semibold tracking-tight text-slate-900 dark:text-slate-100"
          >
            {t("map.heading")}
          </h2>
        </div>
        <div className="relative h-[520px] sm:h-[700px]">
          <MapClient stations={valid} lakes={lakes} />
        </div>
      </div>
    </section>
  );
}
