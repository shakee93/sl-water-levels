import type { Tier } from "@/lib/status";

// Help data for the flood help page and station-page help cards.
// Verified against official pages on 2026-10-22 unless noted. See sources.md.

export type Phase = "before" | "during" | "after";

export interface EmergencyContact {
  id: string; name: string; number: string; /** tel: href */ tel: string;
  forWhat: string; hours: string; source: string; verifiedOn: string;
  confidence: "high" | "medium";
  note?: string;
}

export const EMERGENCY_CONTACTS: EmergencyContact[] = [
  { id: "dmc", name: "Disaster Management Centre (DMC) hotline", number: "117", tel: "tel:117",
    forWhat: "Floods, landslides and other disasters: report danger, ask where to go", hours: "Listed as a call centre; 24h not stated on site",
    source: "https://www.dmc.gov.lk", verifiedOn: "2026-10-22", confidence: "high" },
  { id: "dmc-general", name: "DMC head office", number: "+94 112 136 136", tel: "tel:+94112136136",
    forWhat: "General enquiries", hours: "Not stated", source: "https://www.dmc.gov.lk", verifiedOn: "2026-10-22", confidence: "high" },
  { id: "dmc-eoc", name: "DMC Emergency Operations Centre", number: "+94 112 136 222", tel: "tel:+94112136222",
    forWhat: "Emergency operations (alt: +94 112 670 002)", hours: "Not stated", source: "https://www.dmc.gov.lk", verifiedOn: "2026-10-22", confidence: "high" },
  { id: "police", name: "Police emergency", number: "119", tel: "tel:119",
    forWhat: "Danger to life, rescue, crime", hours: "24h", source: "https://en.wikipedia.org/wiki/Telephone_numbers_in_Sri_Lanka", verifiedOn: "2026-10-22", confidence: "medium",
    note: "Widely published; police.lk not fetched. Re-check before launch." },
  { id: "ambulance", name: "Suwa Seriya ambulance", number: "1990", tel: "tel:1990",
    forWhat: "Free ambulance", hours: "24h", source: "https://en.wikipedia.org/wiki/Telephone_numbers_in_Sri_Lanka", verifiedOn: "2026-10-22", confidence: "medium",
    note: "1990.lk not fetched. Re-check before launch." },
  { id: "fire", name: "Fire and rescue", number: "110", tel: "tel:110",
    forWhat: "Fire, trapped people", hours: "24h", source: "https://en.wikipedia.org/wiki/Telephone_numbers_in_Sri_Lanka", verifiedOn: "2026-10-22", confidence: "medium",
    note: "Official page not fetched. Re-check before launch." },
  { id: "met", name: "Department of Meteorology", number: "+94 11 2686 686", tel: "tel:+94112686686",
    forWhat: "Weather enquiries (not an emergency line)", hours: "Office hours (not stated)", source: "https://www.meteo.gov.lk", verifiedOn: "2026-10-22", confidence: "high" },
];

// Deliberately omitted (unverified or conflicting): tri-forces lines, NBRO landslide hotline,
// Irrigation Dept flood hotline, Red Cross and Sarvodaya emergency numbers. 117 covers them.

export const DISTRICT_CONTACTS: Record<string, { office: string; mobile: string; email: string }> = {
  "Colombo": { office: "+94 112 434 028", mobile: "+94 773 957 870", email: "colombo@dmc.gov.lk" },
  "Gampaha": { office: "+94 332 234 671", mobile: "+94 773 957 871", email: "gampaha@dmc.gov.lk" },
  "Kalutara": { office: "+94 342 222 912", mobile: "+94 773 957 872", email: "kalutara@dmc.gov.lk" },
  "Ratnapura": { office: "+94 452 222 991", mobile: "+94 773 957 877", email: "ratnapura@dmc.gov.lk" },
  "Kegalle": { office: "+94 352 222 603", mobile: "+94 773 957 876", email: "kegalle@dmc.gov.lk" },
  "Galle": { office: "+94 912 227 315", mobile: "+94 773 957 873", email: "galle@dmc.gov.lk" },
  "Matara": { office: "+94 412 234 134", mobile: "+94 773 957 874", email: "matara@dmc.gov.lk" },
  "Hambantota": { office: "+94 472 256 463", mobile: "+94 773 957 875", email: "hambantota@dmc.gov.lk" },
  "Kurunegala": { office: "+94 372 221 709", mobile: "+94 773 957 887", email: "kurunegala@dmc.gov.lk" },
  "Puttalam": { office: "+94 322 265 756", mobile: "+94 773 957 888", email: "puttalam@dmc.gov.lk" },
  "Kandy": { office: "+94 812 202 697", mobile: "+94 773 957 878", email: "kandy@dmc.gov.lk" },
  "Nuwara Eliya": { office: "+94 522 222 113", mobile: "+94 773 957 879", email: "nuwaraeliya@dmc.gov.lk" },
  "Badulla": { office: "+94 552 224 751", mobile: "+94 773 957 880", email: "badulla@dmc.gov.lk" },
  "Monaragala": { office: "+94 552 276 867", mobile: "+94 773 957 889", email: "monaragala@dmc.gov.lk" },
  "Ampara": { office: "+94 632 222 218", mobile: "+94 773 957 883", email: "ampara@dmc.gov.lk" },
  "Batticaloa": { office: "+94 652 227 701", mobile: "+94 773 957 885", email: "batticaloa@dmc.gov.lk" },
  "Trincomalee": { office: "+94 262 224 711", mobile: "+94 773 957 884", email: "trincomalee@dmc.gov.lk" },
  "Polonnaruwa": { office: "+94 272 226 676", mobile: "+94 773 957 882", email: "polonnaruwa@dmc.gov.lk" },
  "Anuradhapura": { office: "+94 252 234 817", mobile: "+94 773 957 881", email: "anuradhapura@dmc.gov.lk" },
  "Matale": { office: "+94 662 230 926", mobile: "+94 773 957 890", email: "matale@dmc.gov.lk" },
};
export const DISTRICT_CONTACT_SOURCE = {
  url: "https://www.dmc.gov.lk/index.php?option=com_content&view=article&id=94&Itemid=271&lang=en",
  label: "DMC District Disaster Management Coordinating Units (page last update 15 Oct 2026)",
  verifiedOn: "2026-10-22",
  note: "Office-hours coordinating units, not confirmed 24h. Show as 'District DMC office'.",
};

export interface Channel { id: string; name: string; url?: string; how: string; status: "verified" | "unverified"; source: string; verifiedOn: string }
export const WARNING_CHANNELS: Channel[] = [
  { id: "dmc-site", name: "DMC early warnings and river water level reports", url: "https://www.dmc.gov.lk", how: "Open the site; look for Early Warning and River Water Level and Flood Warning reports.", status: "verified", source: "https://www.dmc.gov.lk", verifiedOn: "2026-10-22" },
  { id: "dmc-x", name: "DMC on X", url: "https://twitter.com/dmc_lk", how: "Follow for official updates.", status: "verified", source: "https://www.dmc.gov.lk", verifiedOn: "2026-10-22" },
  { id: "met", name: "Department of Meteorology", url: "https://www.meteo.gov.lk", how: "Weather warnings and forecasts. WhatsApp weather data line 0710688872 (messages only).", status: "verified", source: "https://www.meteo.gov.lk", verifiedOn: "2026-10-22" },
  { id: "irrigation", name: "Irrigation Department", url: "https://www.irrigation.gov.lk", how: "River water levels and flood alerts (Sinhala and Tamil versions).", status: "verified", source: "https://www.irrigation.gov.lk", verifiedOn: "2026-10-22" },
  { id: "gauges", name: "This site: live gauge levels", how: "Hourly river gauge readings, see station pages.", status: "verified", source: "app", verifiedOn: "2026-10-22" },
];
// NOT included: DMC mobile app, SMS self-subscription, Cell Broadcast, official Facebook/WhatsApp. Could not verify.

export interface GuidanceItem { id: string; text: string; detail?: string; source?: string }
export const GUIDANCE: Record<Phase, GuidanceItem[]> = {
  before: [
    { id: "b-docs", text: "Put ID, deeds, certificates and medicines in a waterproof bag.", detail: "Phone copies of key documents help too." },
    { id: "b-charge", text: "Charge phones and power banks; keep a torch and a battery radio." },
    { id: "b-valuables", text: "Move valuables, electronics and files upstairs or to higher shelves." },
    { id: "b-plan", text: "Agree a meeting place and a route to higher ground with your household." },
    { id: "b-gn", text: "Ask your Grama Niladhari which centre is nearest and the safest route.", detail: "Local officers coordinate evacuation and relief at village level." },
    { id: "b-animals", text: "Plan where livestock and pets will go; move them early, not at the last minute." },
    { id: "b-water", text: "Store drinking water and food that needs no cooking." },
  ],
  during: [
    { id: "d-call", text: "In danger, call 117 (DMC) or 119 (Police).", detail: "Say your village, nearest landmark and how many people." },
    { id: "d-leave", text: "If officials ask you to leave, go early, by day if you can." },
    { id: "d-water", text: "Avoid walking or driving through moving floodwater." },
    { id: "d-power", text: "Switch off power at the mains if water is near sockets." },
    { id: "d-centre", text: "Ask the Grama Niladhari or your district DMC office for the nearest safe centre." },
    { id: "d-families", text: "Tell family you are safe, with one short message." },
  ],
  after: [
    { id: "a-lepto", text: "Ask your Public Health Inspector or MOH office about rat fever (leptospirosis) prevention after wading in floodwater.", detail: "The Epidemiology Unit has advised preventive medicine for exposed people; it is not suitable for everyone, so ask a health worker. See a doctor early for fever or body aches." },
    { id: "a-water", text: "Drink only boiled water until supplies are confirmed safe." },
    { id: "a-wells", text: "Have floodwater-touched wells cleaned and chlorinated; ask your Public Health Inspector." },
    { id: "a-food", text: "Throw out food that touched floodwater; wash hands before eating and cooking." },
    { id: "a-power", text: "Have wiring checked before switching the power back on." },
    { id: "a-snakes", text: "Take care when clearing debris: wear boots and gloves; snakes shelter in it.", detail: "Snake bite: go to hospital straight away." },
    { id: "a-register", text: "Register damage with your Grama Niladhari as soon as you can.", detail: "Photograph damage before cleaning up." },
    { id: "a-dengue", text: "Empty standing water around the home to stop mosquitoes breeding." },
  ],
};

export interface ReliefStep { id: string; text: string; detail?: string }
export const RELIEF_STEPS: ReliefStep[] = [
  { id: "r1", text: "Photograph damage and keep receipts and documents.", detail: "Do this before cleaning where it is safe to." },
  { id: "r2", text: "Tell your Grama Niladhari (GN) about your losses.", detail: "Reported process: the GN, Economic Development Officer and Samurdhi Officer verify the application; the Divisional Secretariat committee reviews it, and the district committee releases funds (Sunday Times, 14 Jun 2026)." },
  { id: "r3", text: "Follow up at your Divisional Secretariat.", detail: "Some offices ask for extra papers such as title documents. Ask what yours needs." },
  { id: "r4", text: "If you have insurance, tell your insurer in writing quickly." },
  { id: "r5", text: "Farmers: report crop damage at your Agrarian Service Centre or the AAIB line 1918.", detail: "Unconfirmed from news reports; check amounts and deadlines locally." },
  { id: "r6", text: "Check amounts and deadlines with the DS office; they change from event to event." },
];
// No compensation amounts are included on purpose: unverified against primary sources and they change.

export const TIER_PRIORITY: Record<Exclude<Tier, "none" | "stale">, { phase: Phase; first: string[]; showCall: boolean; showDistrict: boolean; cardTitle: string | null }> = {
  normal: { phase: "before", first: ["b-docs", "b-plan"], showCall: false, showDistrict: false, cardTitle: null },
  watch:  { phase: "before", first: ["b-docs", "b-charge", "b-plan"], showCall: false, showDistrict: true, cardTitle: "Good time to get ready" },
  alert:  { phase: "before", first: ["b-docs", "b-valuables", "b-gn"], showCall: true, showDistrict: true, cardTitle: "Getting ready" },
  minor:  { phase: "during", first: ["d-call", "d-leave", "d-centre"], showCall: true, showDistrict: true, cardTitle: "If water reaches you" },
  major:  { phase: "during", first: ["d-call", "d-leave", "d-centre"], showCall: true, showDistrict: true, cardTitle: "Staying safe now" },
};
export const RECEDING_GUIDANCE_IDS = ["a-lepto", "a-water", "a-register"];

export const LABELS = {
  callDmc: { en: "Call 117", si: "117 අමතන්න", ta: "117 ஐ அழைக்கவும்", reviewed: false },
  help: { en: "Help", si: "උදව්", ta: "உதவி", reviewed: false },
  flood: { en: "Flood", si: "ගංවතුර", ta: "வெள்ளம்", reviewed: false },
};

export interface DistrictContact { office: string; mobile: string; email: string }

export function telHref(number: string): string {
  return "tel:" + number.replace(/[^\d+]/g, "");
}

export function contactsForDistrict(
  district: string | null | undefined,
): (DistrictContact & { district: string; tel: string; source: typeof DISTRICT_CONTACT_SOURCE }) | null {
  if (!district) return null;
  const key = Object.keys(DISTRICT_CONTACTS).find((k) => k.toLowerCase() === district.trim().toLowerCase());
  if (!key) return null;
  const c = DISTRICT_CONTACTS[key];
  return { ...c, district: key, tel: telHref(c.office), source: DISTRICT_CONTACT_SOURCE };
}

/** Guidance for a station tier. "none"/"stale" fall back to "normal". Items are the priority ones, in order. */
export function guidanceForTier(tier: Tier) {
  const t = TIER_PRIORITY[tier === "none" || tier === "stale" ? "normal" : tier];
  const pool = GUIDANCE[t.phase];
  const items = t.first
    .map((id) => pool.find((g) => g.id === id))
    .filter((g): g is GuidanceItem => !!g);
  return { ...t, items };
}

export function recedingGuidance(): GuidanceItem[] {
  return RECEDING_GUIDANCE_IDS.map((id) => GUIDANCE.after.find((g) => g.id === id)).filter(
    (g): g is GuidanceItem => !!g,
  );
}

export const FAMILY_ABROAD: string[] = [
  "From inside Sri Lanka, call 117 to report someone missing or in danger.",
  "From abroad, contact the nearest Sri Lankan embassy or consulate.",
  "Or ask your local Red Cross to pass a message through Sri Lanka Red Cross (Restoring Family Links, free).",
  "Share the person's full name, last known place and a phone number.",
];
export const DONATING_SAFELY: string[] = [
  "Give only to official accounts published by the Treasury or Central Bank (cbsl.gov.lk).",
  "Be wary of links and numbers in messages; fake donation sites were reported in 2025.",
];
export const HELP_CHECKED = "22 Oct 2026";
/** `key` is the suffix of the help.src.* dictionary entry that translates the label. */
export const HELP_SOURCES: { key: string; label: string; url: string }[] = [
  { key: "dmc", label: "Disaster Management Centre", url: "https://www.dmc.gov.lk" },
  { key: "district", label: "DMC district coordinating units (updated 15 Oct 2026)", url: DISTRICT_CONTACT_SOURCE.url },
  { key: "met", label: "Department of Meteorology", url: "https://www.meteo.gov.lk" },
  { key: "irrigation", label: "Irrigation Department", url: "https://www.irrigation.gov.lk" },
  { key: "redcross", label: "Sri Lanka Red Cross", url: "https://www.redcross.lk" },
  { key: "cbsl", label: "Central Bank of Sri Lanka", url: "https://www.cbsl.gov.lk" },
  { key: "numbers", label: "Police, ambulance and fire numbers: Telephone numbers in Sri Lanka", url: "https://en.wikipedia.org/wiki/Telephone_numbers_in_Sri_Lanka" },
];
