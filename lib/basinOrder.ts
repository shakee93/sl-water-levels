// Canonical upstream → downstream ordering for known SL river basins.
// Stations not listed here are appended at the end, sorted by longitude desc
// (east = mountains = upstream for most SL rivers).

export const BASIN_ORDER: Record<string, string[]> = {
  // Upstream → downstream order, hand-curated from JICA 2009 longitudinal
  // profiles and Perera 2023 where available, basin geography otherwise.
  "Kelani Ganga": [
    "Norwood",
    "Kithulgala",
    "Holombuwa",     // on Gurugoda Oya tributary
    "Deraniyagala",  // on Maguru Ganga tributary
    "Karawanella Bridge", // HMIS/ACCIMT gauge between Kithulgala and Glencourse
    "Mapitigama", // RiverNet gauge, 4 km above Glencourse
    "Glencourse",
    "Pugoda", // RiverNet gauge between Glencourse and Hanwella
    "Hanwella",
    "Nagalagam Street",
  ],
  "Mahaweli Ganga": [
    // South-west highlands → north-east through the dry zone to the sea
    // near Trincomalee. Longitude alone is misleading here.
    "Nawalapitiya",
    "Peradeniya",
    "Calidonia",
    "Thaldena",
    "Weraganthota",
    "Mahiyangana Bridge", // HMIS/ACCIMT gauge, 2 km below Weraganthota
    "Manampitiya",
  ],
  "Kalu Ganga": [
    // East-to-west to the sea at Kalutara. Kalawellawa is on the Kuda
    // Ganga tributary; it joins the main stem between Magura and Putupaula.
    "Rathnapura",
    "Ellagawa",
    "Magura",
    "Kalawellawa (Millakanda)",
    "Putupaula",
  ],
  "Nilwala Ganga": [
    // South-flowing to the sea at Matara; longitude misleads, use known
    // sub-watershed relationships from SLJOL 2023.
    "Pitabeddara",
    "Urawa",
    "Panadugama",
    "Thalgahagoda",
  ],
  "Kirindi Oya": [
    // South-flowing; latitude is the right axis here.
    "Wellawaya",
    "Kuda Oya",
    "Thanamalwila",
  ],
  "Gin Ganga": [
    "Thawalama",
    "Baddegama",
  ],
  "Maha Oya": [
    "Giriulla",
    "Badalgama",
  ],
};

export function normaliseBasin(b: string | null | undefined): string {
  return (b ?? "").trim();
}

/**
 * Main-stem order first (BASIN_ORDER, else longitude desc), then tributary gauges (`tributary: true`, RiverNet) after the main stem,
 * longitude desc: a tributary is never "downstream" of the main stem, so lists group them apart (see splitTributaries).
 */
export function orderStations<T extends { station: string; longitude: number; tributary?: boolean }>(
  basin: string,
  stations: T[],
): T[] {
  const order = BASIN_ORDER[normaliseBasin(basin)];
  const rank = new Map((order ?? []).map((s, i) => [s, i]));
  return [...stations].sort((a, b) => {
    const ta = a.tributary ? 1 : 0, tb = b.tributary ? 1 : 0;
    if (ta !== tb) return ta - tb;
    if (order) {
      const ra = rank.get(a.station) ?? Number.MAX_SAFE_INTEGER;
      const rb = rank.get(b.station) ?? Number.MAX_SAFE_INTEGER;
      if (ra !== rb) return ra - rb;
    }
    return b.longitude - a.longitude;
  });
}

/** An ordered list split into the main stem and its tributary gauges. */
export function splitTributaries<T extends { tributary?: boolean }>(ordered: T[]): { main: T[]; tributaries: T[] } {
  return { main: ordered.filter((s) => !s.tributary), tributaries: ordered.filter((s) => s.tributary) };
}

/** True when `name` is a RiverNet gauge in `snapshot`: it has no known gauge upstream of it (no travel time measured), so forecasts and the anomaly detector treat it alone. */
export function isRn(snapshot: { station: string; source?: string }[], name: string): boolean {
  return snapshot.find((x) => x.station === name)?.source === "rivernet";
}
