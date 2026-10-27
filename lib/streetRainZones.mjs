// Named boxes of 0.1 degree GSMaP pixels (centres lat, lon) for the street-rain zones. Shared by scripts/gsmap-snapshot.mjs and
// scripts/rain-correct.mjs so both read the same pixels. Plain JavaScript (run with plain node).
export const STREET_RAIN_ZONES = {
  "colombo-east": {
    name: "Greater Colombo east (Wellampitiya, Kolonnawa, Kotikawatta, Mulleriyawa ...)",
    centres: [[6.85, 79.85], [6.85, 79.95], [6.95, 79.85], [6.95, 79.95]],
  },
  // Low coastal towns that flood from heavy rain, beyond the Colombo canals (lib/places.ts RAIN_ZONE_OF, 26 Oct 2026, after
  // water stood on roads and in homes at Katuneriya with 139 mm of satellite rain while the Maha Oya gauge was below alert).
  // Each is the pixel(s) the town sits in (centres are x.x5; pixel 7.35 N covers 7.30-7.40): a few more cell sums on the grid already downloaded.
  "ja-ela": { name: "Ja-Ela", centres: [[7.05, 79.85]] },
  negombo: { name: "Negombo, Kochchikade, Dankotuwa", centres: [[7.25, 79.85]] },
  wennappuwa: { name: "Wennappuwa, Katuneriya", centres: [[7.35, 79.85]] },
  marawila: { name: "Marawila (7.41 N sits near the pixel edge, so two pixels)", centres: [[7.35, 79.85], [7.45, 79.85]] },
  chilaw: { name: "Chilaw (79.795 E sits on the pixel edge, so two pixels)", centres: [[7.55, 79.75], [7.55, 79.85]] },
};
