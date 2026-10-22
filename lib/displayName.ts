// Human-facing station names. The ArcGIS gauge names are kept as-is for data
// lookups and URL slugs (so existing links like /kalu-ganga/rathnapura keep
// working); only what users read changes.
//
// The feed uses the Irrigation Dept's spelling, which differs from how people
// write and search for the town ("Rathnapura" vs the common "Ratnapura").
const DISPLAY_NAMES: Record<string, string> = {
  Rathnapura: "Ratnapura",
};

export function stationDisplayName(station: string): string {
  return DISPLAY_NAMES[station.trim()] ?? station.trim();
}

// "Ratnapura Kalu Ganga water level". The river is in the heading because
// people search by town + river ("ratnapura kalu ganga water level"), and
// gauge names alone don't say which river they sit on.
export function stationHeading(station: string, basin: string | null | undefined): string {
  const name = stationDisplayName(station);
  const river = (basin ?? "").trim();
  return river ? `${name} ${river} water level` : `${name} water level`;
}
