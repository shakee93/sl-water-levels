// How a river's gauges and dams connect, for the river map (app/RiverMap.tsx). Schematic only: the
// line joins the points in flow order, it is not the surveyed river course.
//
// `main` runs from the source to the sea. An entry is a gauge (exact station name in the feed) or
// "@slug" for a dam the river passes through (a reservoir page slug, only used to bend the line
// through the dam; it is skipped when we have no coordinates for it).
// `tribs` are side branches: their entries run upstream to downstream and the branch meets the
// main line at the closest point of the segment between `joins[0]` and `joins[1]` (null = above
// the first main point).
// `sea` is where the river meets the sea, only given where the mouth is well known. BASIN_ORDER
// (lib/basinOrder.ts) stays the list order used elsewhere; this file only decides how to draw.

export type RiverShape = {
  main: string[];
  tribs?: { path: string[]; joins: [string | null, string] }[];
  sea?: { lat: number; lon: number };
};

export const RIVER_SHAPE: Record<string, RiverShape> = {
  "Kelani Ganga": {
    main: ["Norwood", "Kithulgala", "Karawanella Bridge", "Glencourse", "Hanwella", "Nagalagam Street"],
    tribs: [
      { path: ["Deraniyagala"], joins: ["Kithulgala", "Glencourse"] }, // Maguru Ganga
      { path: ["Holombuwa"], joins: ["Kithulgala", "Glencourse"] }, // Gurugoda Oya
    ],
    sea: { lat: 6.972, lon: 79.846 }, // Colombo
  },
  "Mahaweli Ganga": {
    main: ["Nawalapitiya", "Peradeniya", "@polgolla", "@victoria", "@randenigala", "@rantambe", "Weraganthota", "Mahiyangana Bridge", "Manampitiya"],
    tribs: [
      // Kotmale Oya: Calidonia is above Upper Kotmale; it joins the Mahaweli at Gampola.
      { path: ["Calidonia", "@upper-kotmale", "@kotmale"], joins: ["Nawalapitiya", "Peradeniya"] },
      { path: ["Thaldena"], joins: ["@rantambe", "Weraganthota"] },
    ],
    sea: { lat: 8.4, lon: 81.25 }, // Koddiyar Bay
  },
  "Kalu Ganga": {
    main: ["Rathnapura", "Ellagawa", "Magura", "Putupaula"],
    tribs: [{ path: ["Kalawellawa (Millakanda)"], joins: ["Magura", "Putupaula"] }], // Kuda Ganga
    sea: { lat: 6.575, lon: 79.955 }, // Kalutara
  },
  "Nilwala Ganga": {
    main: ["Pitabeddara", "Panadugama", "Thalgahagoda"],
    tribs: [{ path: ["Urawa"], joins: ["Pitabeddara", "Panadugama"] }],
    sea: { lat: 5.945, lon: 80.545 }, // Matara
  },
  "Kirindi Oya": {
    main: ["Wellawaya", "Kuda Oya", "Thanamalwila"],
    sea: { lat: 6.27, lon: 81.31 }, // Kirinda
  },
  "Gin Ganga": {
    main: ["Thawalama", "Baddegama"],
    sea: { lat: 6.043, lon: 80.153 }, // Gintota
  },
  "Maha Oya": { main: ["Giriulla", "Badalgama"] },
  "Deduru Oya": {
    main: ["@deduru-oya", "Moragaswewa"],
    sea: { lat: 7.58, lon: 79.79 }, // Chilaw
  },
  "Walawe Ganga": {
    main: ["@samanalawewa", "@udawalawe", "Moraketiya"],
    sea: { lat: 6.1, lon: 81.02 }, // Ambalantota
  },
  "Gal Oya": { main: ["@senanayake-samudraya", "Ampara"] },
  "Malwathu Oya": { main: ["@nachchaduwa", "Thanthirimale"] },
};

/** Shape for a basin; a river we have no table for is its gauges in the given order. */
export function shapeFor(basin: string, orderedStations: string[]): RiverShape {
  return RIVER_SHAPE[basin.trim()] ?? { main: orderedStations };
}
