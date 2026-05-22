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
    "Glencourse",
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

export function orderStations<T extends { station: string; longitude: number }>(
  basin: string,
  stations: T[],
): T[] {
  const order = BASIN_ORDER[normaliseBasin(basin)];
  if (order) {
    const rank = new Map(order.map((s, i) => [s, i]));
    return [...stations].sort((a, b) => {
      const ra = rank.get(a.station) ?? Number.MAX_SAFE_INTEGER;
      const rb = rank.get(b.station) ?? Number.MAX_SAFE_INTEGER;
      if (ra !== rb) return ra - rb;
      return b.longitude - a.longitude;
    });
  }
  return [...stations].sort((a, b) => b.longitude - a.longitude);
}
