import { fetchBasinSnapshot } from "@/lib/arcgis";
import { getReleases } from "@/lib/releases";
import { reservoirsByBasin } from "@/lib/reservoirData";
import { reservoirById } from "@/lib/reservoirs";
import { PLACES } from "@/lib/places";
import { orderStations } from "@/lib/basinOrder";
import { shapeFor } from "@/lib/riverTopology";
import { buildGeoMap } from "@/lib/riverMapGeo";
import { buildMap, type GaugeIn, type ReservoirIn, type TownIn } from "@/lib/riverMap";
import { stationDisplayName } from "@/lib/displayName";
import { formatLevel } from "@/lib/units";
import { stationPath } from "@/lib/slug";
import { getI18n } from "@/lib/i18n/server";
import { rtFor } from "@/lib/i18n/reservoirs";
import { riverName } from "@/lib/i18n/format";
import type { Locale } from "@/lib/i18n/config";
import { Map as MapIcon } from "lucide-react";
import { SpillWatchChip } from "./SpillWatchChip";
import { tierLine } from "./tierUi";
import { RiverMapView } from "./RiverMapView";

import { SITE } from "@/lib/seo";

/**
 * The river on one small map: its gauges (coloured by level), the reservoirs that feed it, and a
 * pulse of flow from any reservoir releasing water to the gauges below it. Every point links to
 * its page. Fails soft: no gauges or nothing to draw, no map.
 *
 * `highlight` marks one reservoir (its own page); `jsonLd` adds the places as a schema.org ItemList.
 */
export async function RiverMap({ lang, basin, highlight, jsonLd, focusStation, focusReservoir, focusTown, embedded }: { lang: Locale; basin: string; highlight?: string; jsonLd?: boolean; focusStation?: string; focusReservoir?: string; focusTown?: string; embedded?: boolean }) {
  const { t, p } = getI18n(lang);
  const rt = rtFor(lang);
  const b = basin.trim();

  const [snapRaw, metas, rels] = await Promise.all([
    fetchBasinSnapshot(b).catch(() => []),
    reservoirsByBasin(b).catch(() => []),
    getReleases().catch(() => null),
  ]);
  const snap = orderStations(b, snapRaw);
  if (snap.length === 0) return null;

  const releasingIds = new Set((rels?.releases ?? []).filter((r) => r.basin.trim() === b).map((r) => r.reservoirId));
  const shape = shapeFor(b, snap.map((s) => s.station));
  const waypoints = new Set([...shape.main, ...(shape.tribs ?? []).flatMap((x) => x.path)].filter((x) => x.startsWith("@")).map((x) => x.slice(1)));

  const gauges: GaugeIn[] = snap.map((s) => {
    const name = stationDisplayName(s.station);
    const level = s.latest && s.tier !== "stale" ? formatLevel(s.latest.water_level, s.unit, 1) : null;
    return {
      id: s.station, station: s.station, lat: s.latitude, lon: s.longitude, label: name, sub: level, tier: s.tier,
      href: p(stationPath(s.basin, s.station)),
      detail: [tierLine(t, s.tier), level].filter(Boolean).join(", "),
    };
  });

  const stationsHere = new Set(snap.map((s) => s.station));
  const reservoirs: ReservoirIn[] = metas
    .filter((m) => m.lat != null && m.lon != null)
    .map((m) => {
      const active = !m.barrage && ((m.catalogueId != null && releasingIds.has(m.catalogueId)) || m.status === "spilling" || (m.status === "releasing" && m.releaseCusecs != null));
      return {
        id: m.slug, slug: m.slug, lat: m.lat!, lon: m.lon!, label: m.name,
        status: m.status, active,
        onRiver: m.catalogueId != null || waypoints.has(m.slug),
        linked: m.linkedGauges.filter((g) => stationsHere.has(g.station)).map((g) => g.station),
        href: p(`/reservoirs/${m.slug}`),
        detail: rt(`s.${m.status}` as "s.spilling"),
        highlight: m.slug === highlight,
      };
    });

  // Towns below the catalogue reservoirs (the "reservoir -> gauge -> town" chains).
  const towns: TownIn[] = [];
  const seen = new Set<string>();
  for (const m of metas) {
    const res = m.catalogueId ? reservoirById(m.catalogueId) : undefined;
    for (const g of res?.gauges ?? []) {
      if (!g.town || seen.has(g.town) || !stationsHere.has(g.station)) continue;
      const place = PLACES.find((x) => x.name === g.town);
      if (!place) continue;
      seen.add(g.town);
      towns.push({ id: g.town, lat: place.lat, lon: place.lon, label: g.town });
    }
  }

  if (gauges.length < 2 && reservoirs.length === 0 && !shape.sea) return null;
  if (gauges.length === 1 && reservoirs.length === 0) return null;

  // Real river geometry (OpenStreetMap) where it exists for this basin; otherwise the old schematic.
  const townCands: TownIn[] = PLACES.filter((x) => x.stations.some((st) => stationsHere.has(st))).map((x) => ({ id: x.name, lat: x.lat, lon: x.lon, label: x.name }));
  const geoIn = { basin: b, gauges, reservoirs, towns: townCands, seaLabel: rt("map.sea"), focusStation, focusReservoir, focusTown };
  const geoNarrow = buildGeoMap(geoIn);
  // A reservoir page embeds the map only where there is real river geometry; otherwise its diagram stands alone.
  if (focusReservoir && !geoNarrow) return null;
  const model = geoNarrow ?? buildMap({ gauges, reservoirs, towns, shape, seaLabel: rt("map.sea") });
  const wide = geoNarrow ? buildGeoMap({ ...geoIn, width: 720 }) : null;
  const rn = riverName(b, lang);

  const ld = jsonLd
    ? {
        "@context": "https://schema.org",
        "@type": "ItemList",
        name: rt("map.ldName", { river: rn }),
        itemListElement: [...gauges.map((g) => ({ name: g.label, url: SITE + g.href })), ...reservoirs.filter((r) => r.onRiver).map((r) => ({ name: r.label, url: SITE + r.href }))].map((x, i) => ({
          "@type": "ListItem",
          position: i + 1,
          ...x,
        })),
      }
    : null;

  const view = (
        <RiverMapView
          model={model}
          wide={wide}
          extras={Object.fromEntries(
            metas.filter((m) => m.lat != null).map((m) => [`r:${m.slug}`, <SpillWatchChip key={m.slug} lang={lang} slug={m.slug} catalogueId={m.catalogueId} />]),
          )}
          strings={{
            aria: rt("map.aria", { river: rn }),
            hint: rt("map.hint"),
            gauge: rt("map.gauge"),
            reservoir: rt("map.reservoir"),
            release: rt("map.release"),
            simplified: rt("map.simplified"),
            list: rt("map.list"),
            openGauge: rt("map.openGauge"),
            openReservoir: rt("map.openReservoir"),
          }}
        />
  );
  if (embedded) return <div id="map" className="mb-4 scroll-mt-4" aria-label={rt("map.title")}>{view}</div>;
  return (
    <section id="map" className="mb-5 scroll-mt-4" aria-label={rt("map.title")}>
      {ld && <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(ld) }} />}
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3 sm:p-4">
        <h2 className="mb-2 flex items-center gap-1.5 text-sm font-medium text-slate-600 dark:text-slate-300"><MapIcon className="size-4" aria-hidden />{rt("map.title")}</h2>
        {view}
      </div>
    </section>
  );
}
