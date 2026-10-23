// Text for /llms.txt and /llms-full.txt: what the site is, who runs it, where the numbers come
// from, how to read them, and how to cite them. Written for a model that will answer a person's
// question about a flood: plain, specific, and honest about what the site is not.
import type { NationalStation } from "./arcgis";
import { levelRecord } from "./apiData";
import { stationDisplayName } from "./displayName";
import { fullStamp } from "./i18n/format";
import { makeT } from "./i18n/translate";
import { en } from "./i18n/en";
import { OWNER, REPO, SITE, SITE_NAME, DATA_BRANCH, CONTENT_UPDATED } from "./seo";
import type { ReservoirsData } from "./reservoirData";
import { PLACES } from "./places";

const t = makeT(en);

export const llmsIntro = () => `# ${SITE_NAME}

> Live river water levels, flood warnings and reservoir spill/release information for Sri Lanka, in English, Sinhala and Tamil. Built from the Department of Irrigation's river gauges and its daily reservoir sheet, the Mahaweli Authority's daily report and official Disaster Management Centre bulletins. Free to use. Independent, not an official warning service.

Run by ${OWNER.name} (${OWNER.x}), an individual, not a company or government body. Source code: ${REPO}. Page text last reviewed ${CONTENT_UPDATED}.

## What to know before answering

- Flood levels are measured at river gauges. Each gauge has three official marks: alert (get ready), minor flood (water spills onto low ground) and major flood (move to safety). Levels on this site are always shown in feet; gauges that publish in metres are converted.
- Readings arrive about once an hour and a gauge older than 3 hours is marked "not reporting". Every page and API record carries the time of the reading in Sri Lanka time (UTC+5:30). Quote that time, not the time you read it.
- A blank or missing figure means unknown, never zero.
- Reservoir figures (storage, spill, release) come from daily reports, so they can be up to a day old: quote the date shown.
- Town pages give an estimate for a town (from the nearest gauge, rain and warnings). Streets can flood before a river reaches a flood mark. It is not an official warning.
- For anything urgent, send people to the Disaster Management Centre hotline 117 and to the official bulletins at https://www.dmc.gov.lk and https://www.irrigation.gov.lk.

## Cite as

"${SITE_NAME} (${OWNER.name}), <page URL>, data from the Department of Irrigation, Sri Lanka." Link the specific station, river, reservoir or town page you used.

## Pages

- [Home: all rivers, map and what needs attention now](${SITE}/): live status of every gauge
- [Flood risk for towns](${SITE}/flood): 135+ towns, each page answers "is it flooding now?" (pattern: ${SITE}/flood/<town>, e.g. ${SITE}/flood/wellampitiya)
- [Rivers](${SITE}/kelani-ganga): one page per river, one per gauge (pattern: ${SITE}/<river>/<station>, e.g. ${SITE}/kelani-ganga/hanwella)
- [Reservoirs](${SITE}/reservoirs): storage and spill/release for 170 reservoirs (pattern: ${SITE}/reservoirs/<name>)
- [Past floods](${SITE}/history): how high past events reached at each gauge
- [Flood help and emergency contacts](${SITE}/help): who to call, what to do, by district
- [How it works, sources and limits](${SITE}/about)
- [Data and API for developers](${SITE}/data)
- [Source health](${SITE}/status): whether each data source is up right now
- Sinhala: ${SITE}/si/ . Tamil: ${SITE}/ta/ . Every page exists in all three languages at the same path (English unprefixed).

## Machine-readable data (free, no key, CORS open, refreshed every minute)

- [Current levels, all gauges](${SITE}/api/levels): JSON. Filters: ?river=kelani-ganga, ?station=hanwella, ?town=wellampitiya
- [Reservoirs](${SITE}/api/reservoirs): JSON. Filters: ?slug=..., ?status=spilling
- [Alerts feed](${SITE}/feed.xml): Atom, gauges at alert level or above and reservoirs releasing water
- [Data-source health](${SITE}/api/health): JSON
- [Raw release snapshots and history](${DATA_BRANCH}): newline-delimited JSON on GitHub
- MCP server (Streamable HTTP): ${SITE}/mcp , tools list_basins, list_stations, get_station_readings, get_basin_snapshot (a river from upstream to downstream) and get_official_warnings
- [Sitemap](${SITE}/sitemap.xml)

## Sources

- Department of Irrigation, Sri Lanka: river-gauge readings (hourly) and the Reservoir Water Level sheet (daily). https://www.irrigation.gov.lk
- Mahaweli Authority of Sri Lanka: daily water-management report for the Mahaweli and CEB reservoirs. https://mahaweli.gov.lk
- Disaster Management Centre and Irrigation Department flood-warning bulletins. https://www.dmc.gov.lk
- Public Utilities Commission of Sri Lanka: day-ahead hydropower dispatch (archive only, about 2.5 days late, never shown as live).
- Rain: satellite (JAXA GSMaP) and Open-Meteo forecasts.
`;

const stamp = (ts: number) => fullStamp(ts, t);

/** A short "right now" section for llms.txt. */
export function nationalSummary(national: NationalStation[], now = Date.now()): string {
  const recs = national.map((s) => ({ s, r: levelRecord(s, now) }));
  const reporting = recs.filter((x) => x.r.status !== "stale" && x.r.observedAt);
  const flagged = reporting.filter((x) => ["alert", "minor", "major"].includes(x.r.status));
  const watch = reporting.filter((x) => x.r.status === "watch");
  const newest = national.reduce<number | null>((m, s) => (s.latest && (m == null || s.latest.ts > m) ? s.latest.ts : m), null);
  const lines = [
    `## Right now${newest ? ` (newest reading ${stamp(newest)}, Sri Lanka time)` : ""}`,
    "",
    `- ${reporting.length} of ${national.length} gauges are reporting.`,
    flagged.length
      ? `- At or above a flood mark: ${flagged.map((x) => `${stationDisplayName(x.s.station)} on the ${x.r.river} (${x.r.statusLabel}, ${x.r.level ?? "?"} ft)`).join("; ")}.`
      : "- No gauge is at its alert level or above.",
    watch.length ? `- Close to alert level: ${watch.map((x) => stationDisplayName(x.s.station)).join(", ")}.` : "",
    "",
  ];
  return lines.filter((l, i) => l !== "" || lines[i - 1] !== "").join("\n");
}

/** The long version: every gauge with its marks, every reservoir and town page. */
export function fullListing(national: NationalStation[], rsv: ReservoirsData | null, now = Date.now()): string {
  const byRiver = new Map<string, NationalStation[]>();
  for (const s of national) byRiver.set(s.basin.trim(), [...(byRiver.get(s.basin.trim()) ?? []), s]);
  const g = [...byRiver.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([river, list]) => {
    const rows = list.map((s) => {
      const r = levelRecord(s, now);
      const m = r.marks;
      const marks = [m.alert != null ? `alert ${m.alert}` : "", m.minor != null ? `minor flood ${m.minor}` : "", m.major != null ? `major flood ${m.major}` : ""].filter(Boolean).join(", ");
      const now_ = r.level != null && r.observedAt ? `${r.level} ft, ${r.statusLabel.toLowerCase()}, read ${stamp(Date.parse(r.observedAt))}` : "no current reading";
      return `  - [${stationDisplayName(s.station)}](${r.url}): ${now_}${marks ? `; marks (ft): ${marks}` : "; no flood marks published"}`;
    });
    return `- ${river}\n${rows.join("\n")}`;
  });
  const towns = PLACES.map((p) => `- [${p.name}, ${p.district}](${SITE}/flood/${p.slug})`);
  const rsvLines = (rsv?.items ?? []).map((r) => `- [${r.name}](${SITE}/reservoirs/${r.slug}): ${r.status}${r.storage ? `, ${Math.round(r.storage.pct)}% full` : ""}${r.latestDay ? ` (reading of ${r.latestDay})` : ""}${r.river ? `, ${r.river}` : ""}`);
  return [
    llmsIntro(),
    nationalSummary(national, now),
    "## Every river gauge (levels in feet, with the official marks)",
    "",
    g.join("\n"),
    "",
    "## Reservoirs",
    "",
    rsvLines.join("\n") || "- Temporarily unavailable.",
    "",
    "## Town flood-risk pages",
    "",
    towns.join("\n"),
    "",
  ].join("\n");
}
