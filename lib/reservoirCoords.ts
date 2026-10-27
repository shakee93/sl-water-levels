// Where each reservoir is, for the river maps. The Irrigation Department layers carry no coordinates
// (see reservoirMeta), so these come from public references, looked up on 2026-10-23:
//  - OSM: OpenStreetMap (Nominatim and Overpass queries, 1 request a second, with a User-Agent),
//    a named reservoir or dam mapped there; "OSM way/123" is the feature.
//  - WD: Wikidata P625 (Q-number), WP: English Wikipedia coordinates.
// `check` says how well a second source agreed:
//  - "agreed": two sources within 2 km of each other.
//  - "near": two sources on the same reservoir 2-5 km apart (a long lake: one is the dam, the other
//    the middle of the water); the first one listed is the point used.
//  - "single": one named map feature, no second source.
// A point is the dam wall where the source gave the dam, otherwise the middle of the water.
// Left out because no source could be checked: Lunugamvehera (only unnamed dam ways nearby),
// Maduru Oya (OSM and Wikipedia are 10 km apart), Ulhitiya, Huruluwewa (OSM has only a hamlet),
// Kekanadura, Giants Tank, Manankattiya, Wemedilla, Ekgal Oya and Kimbulwana Oya (a canal).
// Keys are reservoir page slugs (lib/reservoirData.ts).

export type Coord = {
  lat: number;
  lon: number;
  source: string;
  check: "agreed" | "near" | "single";
};

export const RESERVOIR_COORDS: Record<string, Coord> = {
  // Mahaweli
  kotmale: { lat: 7.0608, lon: 80.5969, source: "OSM way/487550136 (Kotmale Dam); WD Q6434138 7.0608, 80.5972", check: "agreed" },
  "upper-kotmale": { lat: 6.9467, lon: 80.6579, source: "OSM Upper Kotmale Dam; WD Q7898727 6.9467, 80.6581", check: "agreed" },
  polgolla: { lat: 7.3219, lon: 80.6453, source: "OSM Polgolla Barrage; WD Q17022195 7.3217, 80.6450", check: "agreed" },
  victoria: { lat: 7.2414, lon: 80.7847, source: "WD Q3440914 (Victoria Dam); OSM Victoria Reservoir seaplane base on the lake 3.7 km north", check: "single" },
  randenigala: { lat: 7.1891, lon: 80.8533, source: "OSM Randenigala Reservoir (middle of the lake); WD Q34918293 7.1822, 80.8856", check: "near" },
  rantambe: { lat: 7.2006, lon: 80.9495, source: "OSM way/419417819 (Rantembe Dam); WP 7.2, 80.95", check: "agreed" },
  bowatenna: { lat: 7.6656, lon: 80.6638, source: "OSM Bowatenna Reservoir; WD Q34878597 7.6644, 80.6581", check: "agreed" },
  moragahakanda: { lat: 7.7047, lon: 80.7831, source: "WD Q17014270 (Moragahakanda Dam); OSM reservoir middle 7.6702, 80.7569", check: "near" },
  nalanda: { lat: 7.6685, lon: 80.6204, source: "OSM Nalanda Reservoir", check: "single" },
  minneriya: { lat: 8.0333, lon: 80.8833, source: "WP Minneriya Tank (to the minute)", check: "single" },
  kaudulla: { lat: 8.15, lon: 80.9167, source: "WD Q34894219 (Kaudulla Wewa, to the minute)", check: "single" },
  "parakrama-samudraya": { lat: 7.9148, lon: 80.9855, source: "OSM Parakrama Samudraya; WP 7.9, 80.9667", check: "near" },
  morana: { lat: 7.2678, lon: 81.1665, source: "OSM Morana Reservoir", check: "single" },
  kandalama: { lat: 7.8751, lon: 80.7023, source: "OSM Kandalama Tank; WD Q16893092 7.8772, 80.7000", check: "agreed" },
  giritale: { lat: 7.991, lon: 80.914, source: "WD Q25105275 and WP Giritale Tank", check: "agreed" },
  // Kelani
  castlereagh: { lat: 6.8733, lon: 80.5663, source: "OSM way/419436096 (Castlereigh Dam); WP 6.8733, 80.5664", check: "agreed" },
  laxapana: { lat: 6.9191, lon: 80.4895, source: "OSM way/314668003 (Laxapana Dam); WD Q15830476 6.9189, 80.4894", check: "agreed" },
  canyon: { lat: 6.8719, lon: 80.5263, source: "OSM way/419400374 (Canyon Dam; the reservoir way is 0.4 km away)", check: "single" },
  norton: { lat: 6.914, lon: 80.5216, source: "OSM way/315451932 (Norton Dam; the reservoir way is 0.5 km away)", check: "single" },
  maussakele: { lat: 6.8436, lon: 80.5488, source: "OSM way/419427446 (Maskeliya Dam, the Maussakelle reservoir); OSM hamlet Maussakele State 1.3 km north", check: "single" },
  // Deduru, Kala Oya, Walawe, Gal Oya, Ma Oya, Malwathu
  "deduru-oya": { lat: 7.6764, lon: 80.2837, source: "OSM Deduru Oya Reservoir; WP 7.7183, 80.2744", check: "near" },
  batalagoda: { lat: 7.5322, lon: 80.4539, source: "WD Q34877405 (Batalagoda Tank)", check: "single" },
  rajanganaya: { lat: 8.1292, lon: 80.2395, source: "OSM Rajanganaya Reservoir", check: "single" },
  tabbowa: { lat: 8.0747, lon: 79.9514, source: "WD Q34929492 (Tabbowa Wewa, 8.0747 N 79.9514 E)", check: "single" },
  "kala-wewa": { lat: 8.0107, lon: 80.5606, source: "OSM Kala Wewa; WD Q7354820 8.0135, 80.5563", check: "agreed" },
  angamuwa: { lat: 8.1753, lon: 80.2264, source: "WD Q34876529 (Angamuwa Tank)", check: "single" },
  dewahuwa: { lat: 7.7998, lon: 80.5454, source: "OSM Dewahuwa tank; WD Q34883228 7.8, 80.55", check: "agreed" },
  "senanayake-samudraya": { lat: 7.1859, lon: 81.4882, source: "OSM Senanayake Samudraya (middle of the lake); WD Q105038056 dam 7.2138, 81.5432", check: "near" },
  udawalawe: { lat: 6.4772, lon: 80.8289, source: "OSM Udawalawe Reservoir; WD Q34931869 6.4444, 80.8353", check: "near" },
  samanalawewa: { lat: 6.6636, lon: 80.7958, source: "OSM Samanalawewa Reservoir; WD Q2216749 dam 6.6792, 80.7989", check: "agreed" },
  padaviya: { lat: 8.799, lon: 80.7725, source: "OSM Padaviya Tank", check: "single" },
  nachchaduwa: { lat: 8.2513, lon: 80.4854, source: "OSM Nachchaduwa Tank; WD Q25105468 8.25, 80.4833", check: "agreed" },
  "nuwara-wewa": { lat: 8.3325, lon: 80.4299, source: "OSM Nuwara Wewa; WD Q31073302 8.3419, 80.4267", check: "agreed" },
  "thissa-wewa": { lat: 8.3353, lon: 80.3794, source: "OSM Tissa Wewa, Anuradhapura", check: "single" },
};
