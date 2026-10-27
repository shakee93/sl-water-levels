import type { Metadata } from "next";
import { fetchStations, type Station } from "@/lib/arcgis";
import { NotFoundBody } from "./NotFoundBody";
import { orderStations } from "@/lib/basinOrder";

export const revalidate = 3600;

export const metadata: Metadata = {
  title: "Page not found",
  // the layout says index + googleBot index: both must be overridden here or Google reads the 404 as indexable
  robots: { index: false, follow: true, googleBot: { index: false, follow: true } },
};


export default async function NotFound() {
  let stations: Station[] = [];
  try {
    stations = await fetchStations();
  } catch {
    /* show static fallback */
  }

  const basins = (() => {
    const set = new Set<string>();
    for (const s of stations) if (s.basin) set.add(s.basin);
    return [...set].sort();
  })();

  const popularStations = [
    "Nagalagam Street",
    "Hanwella",
    "Glencourse",
    "Peradeniya",
    "Rathnapura",
    "Pitabeddara",
  ]
    .map((name) => stations.find((s) => s.station === name))
    .filter((s): s is Station => Boolean(s))
    .slice(0, 6);

  const fallback = popularStations.length > 0
    ? popularStations
    : orderStations("Kelani Ganga", stations.filter((s) => s.basin === "Kelani Ganga")).slice(0, 6);

  return (
    <NotFoundBody
      stations={fallback.map((s) => ({ station: s.station, basin: s.basin }))}
      basins={basins}
    />
  );
}
