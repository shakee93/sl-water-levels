// lib/places.ts — gazetteer for the "find your place" search.
// `stations` holds EXACT `hydrostations.station` strings, most relevant gauge first
// (the gauge on the river that floods the place, not merely the nearest one).
// Coordinates are town centres, good to ~2 km. Sinhala/Tamil aliases only where confident.
/**
 * How the town drains, which decides how local rain and the river combine (lib/townRisk.ts).
 *  - "canal-backwater": low-lying, drained by canals/marsh that empty into the river near its mouth.
 *    When the river is high the canal cannot empty, so heavy local rain floods streets before the
 *    gauge reaches any official level (Wellampitiya, Kolonnawa, Kelaniya ...).
 *  - "riverbank": sits on the banks of a gauged river; the gauge is a direct measure.
 *  - "upland": hills or ridge towns where the river is not what floods the streets.
 */
export type Drainage = "canal-backwater" | "riverbank" | "upland";
export type Place = {
  name: string;
  /** URL slug of the town page (/flood/<slug>). */
  slug: string;
  drainage: Drainage;
  aliases: string[];
  lat: number;
  lon: number;
  district: string;
  stations: string[];
  /**
   * Set only for towns the satellite street-rain rule was backtested for (lib/townRisk.ts, STREET_RAIN_ZONES in
   * scripts/gsmap-snapshot.mjs): the id of the rain zone whose 24 h total drives "water on the streets".
   */
  rainZone?: string;
};
export type RiverAlias = { basin: string; aliases: string[] };

type Row = [name: string, district: string, lat: number, lon: number, stations: string[], aliases?: string[]];

const NG = "Nagalagam Street", HW = "Hanwella", GC = "Glencourse", KG = "Kithulgala", HO = "Holombuwa", DE = "Deraniyagala", NW = "Norwood";
const RP = "Rathnapura", EL = "Ellagawa", MG = "Magura", KW = "Kalawellawa (Millakanda)", PP = "Putupaula";
const BD = "Baddegama", TW = "Thawalama";
const PI = "Pitabeddara", UR = "Urawa", PA = "Panadugama", TH = "Thalgahagoda";
const DU = "Dunamale", BG = "Badalgama", GI = "Giriulla", MO = "Moragaswewa", GA = "Galgamuwa";
const NA = "Nawalapitiya", PE = "Peradeniya", CA = "Calidonia", TL = "Thaldena", WE = "Weraganthota", MA = "Manampitiya";

const ROWS: Row[] = [
  // ── Kelani Ganga: lower basin, Colombo / Gampaha ──
  ["Colombo", "Colombo", 6.9271, 79.8612, [NG], ["Kolamba", "Kolomba", "කොළඹ", "கொழும்பு"]],
  ["Kolonnawa", "Colombo", 6.9336, 79.8850, [NG], ["Kolonnava", "Kolonnawa", "කොළොන්නාව"]],
  ["Wellampitiya", "Colombo", 6.9370, 79.8910, [NG], ["Welampitiya", "Wellampitiye", "වෙල්ලම්පිටිය"]],
  ["Orugodawatta", "Colombo", 6.9391, 79.8840, [NG], ["Orugodawatte", "ඔරුගොඩවත්ත"]],
  ["Dematagoda", "Colombo", 6.9427, 79.8780, [NG], ["දෙමටගොඩ"]],
  ["Grandpass", "Colombo", 6.9486, 79.8680, [NG], ["Grandpass", "ග්‍රෑන්ඩ්පාස්"]],
  ["Kotahena", "Colombo", 6.9490, 79.8590, [NG], ["කොටහේන"]],
  ["Mattakkuliya", "Colombo", 6.9697, 79.8650, [NG], ["Mattakuliya", "Mattakkuliye", "මට්ටක්කුලිය"]],
  ["Modara", "Colombo", 6.9730, 79.8570, [NG], ["Mutwal", "Mutuwal", "මෝදර", "මුතුවල"]],
  ["Peliyagoda", "Gampaha", 6.9667, 79.8833, [NG], ["Peliyagode", "පෑලියගොඩ"]],
  ["Kelaniya", "Gampaha", 6.9553, 79.9220, [NG, HW], ["Kelaniye", "කැලණිය", "கெலனியா"]],
  ["Kiribathgoda", "Gampaha", 6.9780, 79.9270, [NG], ["Kiribatgoda", "කිරිබත්ගොඩ"]],
  ["Wattala", "Gampaha", 6.9894, 79.8917, [NG], ["Wathala", "වත්තල"]],
  ["Hendala", "Gampaha", 7.0000, 79.8700, [NG], ["හේන්දල"]],
  ["Ragama", "Gampaha", 7.0280, 79.9200, [NG], ["රාගම"]],
  ["Kandana", "Gampaha", 7.0500, 79.8970, [NG, DU], ["කඳාන"]],
  ["Kadawatha", "Gampaha", 7.0010, 79.9510, [NG], ["Kadawata", "කඩවත"]],
  ["Biyagama", "Gampaha", 6.9500, 79.9930, [HW, NG], ["Biyagame", "බියගම"]],
  ["Kaduwela", "Colombo", 6.9361, 79.9858, [HW, NG], ["Kaduvela", "Kaduwella", "කඩුවෙල", "கடுவெல"]],
  ["Kotikawatta", "Colombo", 6.9333, 79.9040, [NG], ["Kotikawatte", "කොටිකාවත්ත"]],
  ["Angoda", "Colombo", 6.9340, 79.9230, [NG], ["අංගොඩ"]],
  ["Mulleriyawa", "Colombo", 6.9300, 79.9330, [NG], ["Mulleriyava", "මුල්ලේරියාව"]],
  ["Meethotamulla", "Colombo", 6.9420, 79.8950, [NG], ["Meetotamulla", "Meetotamulle", "Methotamulla", "මීතොටමුල්ල"]],
  ["Gothatuwa", "Colombo", 6.9340, 79.9110, [NG], ["Gothatuwa New Town", "Gothatuva", "ගොතටුව"]],
  ["Malabe", "Colombo", 6.9061, 79.9570, [NG, HW], ["Malambe", "මාලඹේ"]],
  ["Thalangama", "Colombo", 6.9000, 79.9390, [NG], ["Talangama", "තලංගම"]],
  ["Battaramulla", "Colombo", 6.9010, 79.9190, [NG], ["Battaramulle", "බත්තරමුල්ල"]],
  ["Kotte", "Colombo", 6.8900, 79.9180, [NG], ["Sri Jayawardenepura Kotte", "Jayawardenepura", "කෝට්ටේ"]],
  ["Rajagiriya", "Colombo", 6.9100, 79.8940, [NG], ["රාජගිරිය"]],
  ["Hokandara", "Colombo", 6.8800, 79.9650, [NG, HW], ["හොකන්දර"]],
  ["Athurugiriya", "Colombo", 6.8730, 79.9970, [HW, NG], ["Athurugiriye", "අතුරුගිරිය"]],
  ["Homagama", "Colombo", 6.8441, 80.0021, [HW, NG], ["Homagame", "හෝමාගම"]],
  ["Hanwella", "Colombo", 6.9097, 80.0831, [HW, NG], ["Hanvella", "Hanwalla", "Hanwelle", "හංවැල්ල", "ஹன்வெல்ல"]],
  ["Padukka", "Colombo", 6.8420, 80.0870, [HW], ["Padukke", "පදුක්ක"]],
  ["Ranala", "Colombo", 6.9250, 80.0300, [HW, NG], ["රණාල"]],
  ["Kosgama", "Colombo", 6.9300, 80.1300, [HW, GC], ["කොස්ගම"]],
  ["Salawa", "Colombo", 6.9350, 80.1150, [HW, GC], ["සාලාව"]],
  ["Avissawella", "Colombo", 6.9519, 80.2100, [GC, HW], ["Awissawella", "Avissavella", "Seethawaka", "Sitawaka", "අවිස්සාවේල්ල", "අවිස්සාවෙල්ල", "அவிசாவளை"]],
  ["Ruwanwella", "Kegalle", 7.0560, 80.2530, [GC, KG], ["Ruwanwelle", "රුවන්වැල්ල"]],
  ["Yatiyantota", "Kegalle", 6.9990, 80.2950, [KG, GC], ["Yatiyanthota", "Yatiyantota", "යටියන්තොට"]],
  ["Kitulgala", "Kegalle", 6.9890, 80.4140, [KG], ["Kithulgala", "Kitulgale", "කිතුල්ගල"]],
  ["Deraniyagala", "Kegalle", 6.9250, 80.3380, [DE], ["Deraniyagale", "දෙරණියගල"]],
  ["Warakapola", "Kegalle", 7.2253, 80.1983, [HO], ["Warakapole", "වරකාපොල"]],
  ["Kegalle", "Kegalle", 7.2513, 80.3464, [HO, KG], ["Kegalla", "Kegalle", "කෑගල්ල", "கேகாலை"]],
  ["Maskeliya", "Nuwara Eliya", 6.8330, 80.5700, [NW], ["Maskeliye", "මස්කෙළිය"]],
  ["Hatton", "Nuwara Eliya", 6.8907, 80.5958, [NW, CA], ["Hattan", "හැටන්", "ஹட்டன்"]],
  // ── Attanagalu Oya / Maha Oya (Gampaha, Negombo) ──
  ["Gampaha", "Gampaha", 7.0873, 79.9925, [DU], ["Gampaha", "ගම්පහ", "கம்பஹா"]],
  ["Yakkala", "Gampaha", 7.0900, 80.0300, [DU], ["Yakkala", "යක්කල"]],
  ["Ganemulla", "Gampaha", 7.0670, 80.0150, [DU], ["Ganemulle", "ගනේමුල්ල"]],
  ["Ja-Ela", "Gampaha", 7.0744, 79.8919, [DU, BG], ["Jaela", "Ja Ela", "Jaella", "ජා-ඇල", "ජාඇල", "ஜா-எல"]],
  ["Ekala", "Gampaha", 7.1030, 79.9000, [DU], ["Ekala", "ඒකල"]],
  ["Seeduwa", "Gampaha", 7.1200, 79.8800, [DU, BG], ["Sheduwa", "Seeduva", "සීදුව"]],
  ["Katunayake", "Gampaha", 7.1700, 79.8800, [BG, DU], ["Katunayaka", "Katunayake", "Airport", "කටුනායක"]],
  ["Negombo", "Gampaha", 7.2086, 79.8358, [BG, DU], ["Meegamuwa", "Migamuwa", "මීගමුව", "நீர்கொழும்பு"]],
  ["Minuwangoda", "Gampaha", 7.1730, 79.9540, [DU, BG], ["Minuwangoda", "මිනුවන්ගොඩ"]],
  ["Veyangoda", "Gampaha", 7.1530, 80.0600, [DU], ["Weyangoda", "Veyangoda", "වේයන්ගොඩ"]],
  ["Attanagalla", "Gampaha", 7.1130, 80.0830, [DU], ["Attanagalle", "Aththanagalla", "Attanagala", "අත්තනගල්ල"]],
  ["Nittambuwa", "Gampaha", 7.1431, 80.0967, [DU], ["Nittambuva", "Nittambuwa", "නිට්ටඹුව"]],
  ["Pugoda", "Gampaha", 6.9724, 80.0975, [DU, HW], ["Pugoda", "පූගොඩ"]],
  ["Divulapitiya", "Gampaha", 7.2200, 80.0140, [DU, BG], ["Divulapitiye", "Diulapitiya", "දිවුලපිටිය"]],
  ["Mirigama", "Gampaha", 7.2430, 80.1270, [DU, GI], ["Mirigama", "මීරිගම"]],
  ["Pannala", "Kurunegala", 7.3290, 80.0200, [BG, GI], ["Pannala", "පන්නල"]],
  ["Giriulla", "Kurunegala", 7.3300, 80.1250, [GI], ["Giriulle", "Giriulla", "ගිරිඋල්ල"]],
  ["Marawila", "Puttalam", 7.4100, 79.8300, [BG], ["Marawila", "මාරවිල"]],
  ["Kuliyapitiya", "Kurunegala", 7.4700, 80.0400, [GI, MO], ["Kuliyapitiye", "කුලියාපිටිය"]],
  ["Narammala", "Kurunegala", 7.4250, 80.2108, [GI, MO], ["Narammala", "නාරම්මල"]],
  ["Polgahawela", "Kurunegala", 7.3330, 80.3000, [GI], ["Polgahawela", "පොල්ගහවෙල"]],
  // ── Deduru Oya / Mee Oya / Kurunegala ──
  ["Kurunegala", "Kurunegala", 7.4863, 80.3623, [MO, GI], ["Kurunagala", "Kurunegale", "Kurunegala", "කුරුණෑගල", "குருநாகல்"]],
  ["Wariyapola", "Kurunegala", 7.6290, 80.2310, [MO], ["Wariyapola", "වාරියපොළ"]],
  ["Chilaw", "Puttalam", 7.5758, 79.7953, [MO, BG], ["Halawatha", "Halawata", "හලාවත", "சிலாபம்"]],
  ["Nikaweratiya", "Kurunegala", 7.7500, 80.1200, [MO, GA], ["Nikaweratiya", "නිකවැරටිය"]],
  ["Anamaduwa", "Puttalam", 7.8700, 80.0100, [MO], ["Anamaduwa", "ආනමඩුව"]],
  ["Galgamuwa", "Kurunegala", 8.0010, 80.2670, [GA], ["Galgamuwa", "ගල්ගමුව"]],
  ["Maho", "Kurunegala", 7.8200, 80.2760, [GA], ["Maho", "මහව"]],
  // ── Kalu Ganga ──
  ["Ratnapura", "Ratnapura", 6.6828, 80.3992, [RP], ["Rathnapura", "Ratnapuraya", "Rathnapuraya", "Ratnepura", "රත්නපුර", "රත්නපුරය", "இரத்தினபுரி"]],
  ["Kuruwita", "Ratnapura", 6.7800, 80.3600, [RP, EL], ["Kuruvita", "Kuruwitta", "කුරුවිට"]],
  ["Eheliyagoda", "Ratnapura", 6.8500, 80.2670, [EL, RP], ["Eheliyagoda", "එහෙලියගොඩ"]],
  ["Ellagawa", "Ratnapura", 6.7300, 80.2200, [EL], ["Elligawa", "Ellagava", "එල්ලගව"]],
  ["Pelmadulla", "Ratnapura", 6.6200, 80.5400, [RP], ["Pelmadulle", "පැල්මඩුල්ල"]],
  ["Balangoda", "Ratnapura", 6.6500, 80.6990, [RP, "Moraketiya"], ["Balangoda", "බලංගොඩ"]],
  ["Horana", "Kalutara", 6.7159, 80.0626, [KW, PP], ["Horana", "හොරණ"]],
  ["Ingiriya", "Kalutara", 6.7500, 80.1500, [KW], ["Ingiriya", "ඉංගිරිය"]],
  ["Millakanda", "Kalutara", 6.6310, 80.1610, [KW], ["Millakanda", "මිල්ලකන්ද"]],
  ["Bandaragama", "Kalutara", 6.7140, 79.9830, [PP, KW], ["Bandaragama", "බණ්ඩාරගම"]],
  ["Mathugama", "Kalutara", 6.5220, 80.1150, [MG, KW], ["Matugama", "Mathugama", "මතුගම"]],
  ["Agalawatta", "Kalutara", 6.5400, 80.1700, [MG], ["Agalawatte", "Agalawatha", "අගලවත්ත"]],
  ["Kalutara", "Kalutara", 6.5854, 79.9607, [PP, MG], ["Kalutare", "Kaluthara", "කළුතර", "களுத்துறை"]],
  ["Wadduwa", "Kalutara", 6.6650, 79.9290, [PP], ["Waduwa", "Wadduva", "වාද්දුව"]],
  ["Panadura", "Kalutara", 6.7132, 79.9042, [PP], ["Panadure", "පානදුර"]],
  ["Beruwala", "Kalutara", 6.4789, 79.9828, [MG, PP], ["Beruwela", "Beruwala", "බේරුවල"]],
  // ── Gin Ganga ──
  ["Galle", "Galle", 6.0535, 80.2210, [BD], ["Gale", "Galla", "ගාල්ල", "காலி"]],
  ["Gintota", "Galle", 6.0830, 80.1790, [BD], ["Ginthota", "Gintota", "ගිංතොට"]],
  ["Baddegama", "Galle", 6.1738, 80.1754, [BD], ["Badegama", "Baddegama", "බද්දේගම"]],
  ["Elpitiya", "Galle", 6.2930, 80.1640, [BD, TW], ["Elpitiye", "Elpitiya", "ඇල්පිටිය"]],
  ["Thawalama", "Galle", 6.3418, 80.3306, [TW], ["Tawalama", "Thawalama", "තවලම"]],
  // ── Nilwala Ganga ──
  ["Matara", "Matara", 5.9485, 80.5353, [TH, PA], ["Mathara", "Matara", "මාතර", "மாத்தறை"]],
  ["Thihagoda", "Matara", 6.0370, 80.5580, [TH, PA], ["Tihagoda", "Thihagoda", "තිහගොඩ"]],
  ["Kamburupitiya", "Matara", 6.0750, 80.5630, [TH, PA], ["Kamburupitiya", "කඹුරුපිටිය"]],
  ["Akuressa", "Matara", 6.0950, 80.4690, [PA, TH], ["Akuressa", "Akurassa", "Akuresse", "අකුරැස්ස"]],
  ["Morawaka", "Matara", 6.2610, 80.4370, [PI, PA], ["Morawaka", "Morawake", "මොරවක"]],
  ["Pitabeddara", "Matara", 6.2100, 80.4800, [PI], ["Pitabeddara", "පිටබැද්දර"]],
  ["Deniyaya", "Matara", 6.3410, 80.5590, [UR, PI], ["Deniyaya", "Deniyaye", "දෙණියාය"]],
  // ── Mahaweli Ganga ──
  ["Kandy", "Kandy", 7.2906, 80.6337, [PE], ["Mahanuwara", "Mahanuwara", "Kandi", "මහනුවර", "கண்டி"]],
  ["Peradeniya", "Kandy", 7.2590, 80.5970, [PE], ["Peradeniye", "Peradeniya", "පේරාදෙණිය"]],
  ["Katugastota", "Kandy", 7.3200, 80.6200, [PE], ["Katugastota", "කටුගස්තොට"]],
  ["Kadugannawa", "Kandy", 7.2540, 80.5190, [PE, NA], ["Kadugannawa", "කඩුගන්නාව"]],
  ["Gampola", "Kandy", 7.1640, 80.5700, [NA, PE], ["Gampola", "ගම්පොළ", "கம்பளை"]],
  ["Nawalapitiya", "Kandy", 7.0500, 80.5330, [NA], ["Nawalapitiye", "Nawalapitiya", "නාවලපිටිය"]],
  ["Akurana", "Kandy", 7.3660, 80.6130, [PE], ["Akurana", "අකුරණ"]],
  ["Teldeniya", "Kandy", 7.2970, 80.7600, [PE, WE], ["Teldeniya", "තෙල්දෙණිය"]],
  ["Digana", "Kandy", 7.2870, 80.7340, [PE, WE], ["Digana", "දිගන"]],
  ["Talawakele", "Nuwara Eliya", 6.9370, 80.6580, [CA], ["Talawakelle", "Talawakele", "තලවාකැලේ"]],
  ["Nuwara Eliya", "Nuwara Eliya", 6.9497, 80.7891, [CA], ["Nuwaraeliya", "Nuwara-Eliya", "නුවරඑළිය", "நுவரெலியா"]],
  ["Mahiyangana", "Badulla", 7.3330, 80.9890, [WE, TL], ["Mahiyanganaya", "Mahiyangane", "මහියංගනය"]],
  ["Polonnaruwa", "Polonnaruwa", 7.9403, 81.0188, [MA], ["Polonnaruva", "Polonnaruwe", "පොළොන්නරුව", "பொலன்னறுவை"]],
  ["Manampitiya", "Polonnaruwa", 7.9130, 81.0900, [MA], ["Manampitiye", "මනම්පිටිය"]],
  // ── North Central: Kala Oya / Malwathu Oya / Yan Oya ──
  ["Anuradhapura", "Anuradhapura", 8.3114, 80.4037, ["Thanthirimale", "Thambuththegama"], ["Anuradhapuraya", "Anuradapura", "අනුරාධපුරය", "அநுராதபுரம்"]],
  ["Thambuttegama", "Anuradhapura", 8.1500, 80.3000, ["Thambuththegama"], ["Thambuththegama", "Tambuttegama", "Thambuttegama", "තඹුත්තේගම"]],
  ["Kekirawa", "Anuradhapura", 8.0370, 80.5970, ["Thambuththegama"], ["Kekirawa", "කැකිරාව"]],
  ["Medawachchiya", "Anuradhapura", 8.5330, 80.4930, ["Thanthirimale"], ["Medawachchiya", "Medavachchiya", "මැදවච්චිය"]],
  // ── Walawe / Kirindi / Menik / Kumbukkan ──
  ["Embilipitiya", "Ratnapura", 6.3330, 80.8500, ["Moraketiya"], ["Embilipitiye", "Embilipitiya", "ඇඹිලිපිටිය"]],
  ["Ambalantota", "Hambantota", 6.1240, 81.0170, ["Moraketiya"], ["Ambalantota", "අම්බලන්තොට"]],
  ["Wellawaya", "Monaragala", 6.7340, 81.1000, ["Wellawaya"], ["Wellawaya", "Welawaya", "වැල්ලවාය"]],
  ["Buttala", "Monaragala", 6.7500, 81.2400, ["Wellawaya", "Nakkala"], ["Buttala", "බුත්තල"]],
  ["Thanamalwila", "Monaragala", 6.4400, 81.1300, ["Thanamalwila"], ["Tanamalwila", "Thanamalwila", "තනමල්විල"]],
  ["Tissamaharama", "Hambantota", 6.2780, 81.2870, ["Thanamalwila", "Kuda Oya"], ["Tissamaharama", "Tissa", "Tissamaharamaya", "තිස්සමහාරාමය"]],
  ["Kirinda", "Hambantota", 6.2330, 81.3180, ["Thanamalwila", "Kuda Oya"], ["Kirinda", "කිරින්ද"]],
  ["Kataragama", "Monaragala", 6.4130, 81.3330, ["Katharagama"], ["Katharagama", "Kathirgamam", "Kataragame", "කතරගම", "கதிர்காமம்"]],
  ["Monaragala", "Monaragala", 6.8730, 81.3510, ["Nakkala", "Wellawaya"], ["Moneragala", "Monaragala", "මොණරාගල"]],
  // ── East: Gal Oya / Heda Oya / Maduru Oya ──
  ["Ampara", "Ampara", 7.2910, 81.6720, ["Ampara"], ["Amparai", "Ampare", "අම්පාර", "அம்பாறை"]],
  ["Inginiyagala", "Ampara", 7.2230, 81.5270, ["Ampara"], ["Inginiyagala", "ඉඟිනියාගල"]],
  ["Akkaraipattu", "Ampara", 7.2170, 81.8500, ["Ampara"], ["Akkaraipattu", "அக்கரைப்பற்று"]],
  ["Sammanthurai", "Ampara", 7.3630, 81.8190, ["Ampara"], ["Sammanthurai", "Sammanturai", "சம்மாந்துறை"]],
  ["Siyambalanduwa", "Monaragala", 6.9050, 81.5500, ["Siyambalanduwa"], ["Siyambalanduwa", "සියඹලාණ්ඩුව"]],
  ["Pottuvil", "Ampara", 6.8700, 81.8300, ["Siyambalanduwa"], ["Pottuvil", "පොතුවිල්", "பொத்துவில்"]],
  ["Padiyatalawa", "Ampara", 7.3820, 81.1960, ["Padiyathalawa"], ["Padiyathalawa", "Padiyatalawa", "පදියතලාව"]],
  ["Dehiattakandiya", "Ampara", 7.6870, 81.0450, ["Padiyathalawa"], ["Dehiattakandiya", "Dehiaththakandiya", "දෙහිඅත්තකණ්ඩිය"]],
];

const CANAL_BACKWATER = new Set([
  "Colombo", "Kolonnawa", "Wellampitiya", "Orugodawatta", "Dematagoda", "Grandpass", "Kotahena", "Mattakkuliya", "Modara",
  "Meethotamulla", "Gothatuwa", "Peliyagoda", "Kelaniya", "Kiribathgoda", "Wattala", "Hendala", "Ragama", "Kandana", "Kotikawatta", "Angoda", "Mulleriyawa",
  "Thalangama", "Rajagiriya", "Battaramulla", "Kotte", "Ja-Ela", "Ekala", "Seeduwa", "Katunayake", "Negombo",
]);
// A town with a river gauge inside it (under 1.5 km) is ON that river, whatever the terrain: never "upland".
// (scripts/town-risk.test.mts checks this against the live station list.)
const UPLAND = new Set([
  "Malabe", "Hokandara", "Athurugiriya", "Homagama", "Kadawatha", "Maskeliya", "Nuwara Eliya", "Talawakele", "Hatton", "Kegalle",
  "Warakapola", "Gampaha", "Yakkala", "Nittambuwa", "Pugoda", "Veyangoda", "Divulapitiya", "Mirigama", "Kurunegala", "Wariyapola",
  "Kuliyapitiya", "Narammala", "Polgahawela", "Nikaweratiya", "Anamaduwa", "Maho", "Marawila", "Kandy", "Digana", "Kadugannawa",
  "Teldeniya", "Akurana", "Pelmadulla", "Balangoda", "Morawaka", "Deniyaya", "Ingiriya", "Horana", "Bandaragama",
  "Monaragala", "Buttala", "Thanamalwila", "Dehiattakandiya", "Ranala",
  "Thambuttegama", "Kekirawa", "Anuradhapura", "Medawachchiya", "Ganemulla", "Elpitiya",
]);
// Towns the street-rain rule (60 / 100 mm of satellite rain in 24 h) was backtested for. The evidence is the
// DMC "Kolonnawa" Divisional Secretariat flood record plus news (research/wellampitiya-flood-rule-backtest.md),
// calibrated on one 4-pixel GSMaP box (6.85/6.95 N x 79.85/79.95 E, i.e. 6.8-7.0 N, 79.8-80.0 E). It applies only to
// canal-backwater towns inside that box and inside or beside Kolonnawa DS: the six the owner named, plus Angoda
// (named in the 9 Sep 2020 flood), Meethotamulla and Gothatuwa. Other canal-backwater towns (Colombo city,
// Kelaniya, Wattala, Ja-Ela, Negombo ...) have no record behind the thresholds, so they keep the river-only
// estimate until someone backtests them.
const STREET_RAIN_TOWNS = new Set([
  "Wellampitiya", "Kolonnawa", "Kotikawatta", "Mulleriyawa", "Orugodawatta", "Dematagoda", "Angoda", "Meethotamulla", "Gothatuwa",
]);
const slugOf = (s: string) => s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

export const PLACES: Place[] = ROWS.map(([name, district, lat, lon, stations, aliases = []]) => ({
  name, district, lat, lon, stations, aliases: aliases.filter((a) => a !== name),
  slug: slugOf(name),
  drainage: CANAL_BACKWATER.has(name) ? "canal-backwater" : UPLAND.has(name) ? "upland" : "riverbank",
  ...(STREET_RAIN_TOWNS.has(name) ? { rainZone: "colombo-east" } : {}),
}));

export const placeBySlug = (slug: string): Place | undefined => PLACES.find((p) => p.slug === slug);
/** Town page path for a place name as the gazetteer spells it. */
export const townPath = (name: string): string => `/flood/${slugOf(name)}`;

// Basin keys are the TRIMMED `hydrostations.basin` values.
export const RIVERS: RiverAlias[] = [
  { basin: "Aththanagalu Oya", aliases: ["Attanagalu Oya", "Attanagalla Oya", "Attanagalu", "Aththanagalu", "අත්තනගලු ඔය"] },
  { basin: "Deduru Oya", aliases: ["Deduru", "Deduru Oya", "දෙදුරු ඔය", "தெதுரு ஓயா"] },
  { basin: "Gal Oya", aliases: ["Gal Oya", "Galoya", "ගල් ඔය", "கல் ஓயா"] },
  { basin: "Gin Ganga", aliases: ["Gin River", "Gin", "Ging Ganga", "Gin Ganga", "ගිං ගඟ"] },
  { basin: "Heda Oya", aliases: ["Heda Oya", "Heda"] },
  { basin: "Kala Oya", aliases: ["Kala Oya", "Kalaoya", "කලා ඔය", "கலா ஓயா"] },
  { basin: "Kalu Ganga", aliases: ["Kalu River", "Kalu", "Kaluganga", "Kalu Gaga", "කළු ගඟ", "களு கங்கை"] },
  { basin: "Kelani Ganga", aliases: ["Kelani", "Kelani River", "Kelaniya River", "Kelani Gaga", "Kelanigana", "කැලණි", "කැලණි ගඟ", "களனி", "களனி கங்கை"] },
  { basin: "Kirindi Oya", aliases: ["Kirindi", "Kirindi Oya", "කිරිඳි ඔය"] },
  { basin: "Kumbukkan Oya", aliases: ["Kumbukkan", "Kumbukkan Oya", "Kumbukkana", "කුඹුක්කන් ඔය"] },
  { basin: "Ma Oya", aliases: ["Ma Oya", "Maa Oya"] },
  { basin: "Maduru Oya", aliases: ["Maduru", "Maduru Oya", "මඩුරු ඔය"] },
  { basin: "Maha Oya", aliases: ["Maha Oya", "Mahaoya", "මහ ඔය"] },
  { basin: "Mahaweli Ganga", aliases: ["Mahaweli", "Mahaveli", "Mahawali", "Mahaweli River", "Mahaweli Gaga", "මහවැලි", "මහවැලි ගඟ", "மகாவலி", "மகாவலி கங்கை"] },
  { basin: "Malwathu Oya", aliases: ["Malwathu", "Malwatu Oya", "Malvathu Oya", "Aruvi Aru", "මල්වතු ඔය", "மல்வத்து ஓயா"] },
  { basin: "Mee Oya", aliases: ["Mee Oya", "Mi Oya", "Meeoya", "මී ඔය"] },
  { basin: "Menik Ganga", aliases: ["Menik", "Menik Ganga", "Manik Ganga", "මැණික් ගඟ"] },
  { basin: "Nilwala Ganga", aliases: ["Nilwala", "Nilwala River", "Nilwala Gaga", "Nilwalaganga", "නිල්වලා ගඟ", "නිල්වලා"] },
  { basin: "Walawe Ganga", aliases: ["Walawe", "Walawa", "Walawe River", "Walave", "වලවේ ගඟ", "වලවේ"] },
  { basin: "Yan Oya", aliases: ["Yan Oya", "Yaan Oya", "යාන් ඔය"] },
];
