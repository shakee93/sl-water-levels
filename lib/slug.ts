import type { Station } from "./arcgis";

// Slug shape: lowercase, alphanumerics + hyphens.
// "Kelani Ganga" → "kelani-ganga"
// "Nagalagam Street" → "nagalagam-street"
// "Kalawellawa (Millakanda)" → "kalawellawa-millakanda"
// Trailing whitespace from ArcGIS (`hydrostations.basin`) is stripped first.
export function slugify(value: string | null | undefined): string {
  return (value ?? "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function basinSlug(basin: string | null | undefined): string {
  return slugify(basin);
}

export function stationSlug(station: string | null | undefined): string {
  return slugify(station);
}

export function stationPath(basin: string, station: string): string {
  return `/${basinSlug(basin)}/${stationSlug(station)}`;
}

export function basinPath(basin: string): string {
  return `/${basinSlug(basin)}`;
}

export type ResolvedStation = { basin: string; station: string };

// Find the canonical {basin, station} from URL slugs. Returns null if either
// slug doesn't match. Comparison happens against the trimmed source values
// (ArcGIS `hydrostations.basin` has trailing whitespace — see CLAUDE.md).
export function resolveStation(
  stations: Station[],
  riverSlug: string,
  stationSlugValue: string,
): ResolvedStation | null {
  const hit = stations.find(
    (s) =>
      basinSlug(s.basin) === riverSlug &&
      stationSlug(s.station) === stationSlugValue,
  );
  if (!hit) return null;
  return { basin: hit.basin, station: hit.station };
}

export function resolveBasin(
  stations: Station[],
  riverSlug: string,
): string | null {
  const hit = stations.find((s) => basinSlug(s.basin) === riverSlug);
  return hit?.basin ?? null;
}
