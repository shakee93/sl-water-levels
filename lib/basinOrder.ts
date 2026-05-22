// Canonical upstream → downstream ordering for known SL river basins.
// Stations not listed here are appended at the end, sorted by longitude desc
// (east = mountains = upstream for most SL rivers).

export const BASIN_ORDER: Record<string, string[]> = {
  "Kelani Ganga": [
    "Norwood",
    "Kithulgala",
    "Holombuwa",
    "Deraniyagala",
    "Glencourse",
    "Hanwella",
    "Nagalagam Street",
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
