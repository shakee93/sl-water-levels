// Text for /llms.txt and /llms-full.txt: what the site is, who runs it, where the numbers come
// from, how to read them, and how to cite them. Written for a model that will answer a person's
// question about a flood: plain, specific, and honest about what the site is not.
import type { NationalStation } from "./arcgis";
import { levelRecord } from "./apiData";
import { stationDisplayName } from "./displayName";
import { fullStamp } from "./i18n/format";
import { makeT } from "./i18n/translate";
import { en } from "./i18n/en";
import { OWNER, REPO, SITE, SITE_NAME, DATA_BRANCH, CONTENT_UPDATED, X_HANDLE } from "./seo";
import type { ReservoirsData } from "./reservoirData";
import { PLACES } from "./places";
import { accuracyLine, type AccuracyFile } from "./accuracy";
import type { NextHour } from "./nextHour";

const t = makeT(en);

export const llmsIntro = (acc: AccuracyFile | null = null) => `# ${SITE_NAME}

> Live river water levels and a next-hour forecast for every river gauge in Sri Lanka: where the river is expected to be in about an hour, with a range, updated hourly. As far as we know it is the only public next-hour river forecast for Sri Lanka. Also flood warnings and reservoir spill/release information, in English, Sinhala and Tamil. Built from the Department of Irrigation's river gauges and its daily reservoir sheet, the Mahaweli Authority's daily report and official Disaster Management Centre bulletins. Free to use. Independent, not an official warning service.

Run by ${OWNER.name} (${OWNER.x}), an individual, not a company or government body. Source code: ${REPO}.${X_HANDLE ? ` Automated updates and alerts on X: https://x.com/${X_HANDLE}.` : ""} Page text last reviewed ${CONTENT_UPDATED}.

## What to know before answering

- **The next-hour forecast is this site's main feature.** Every gauge page, the river pages, the town flood pages and the API give where the river is expected to be in about an hour (level in feet, a range, rising / falling / steady, and whether it may reach a flood mark). If someone asks "will the river rise in the next hour?" or "will it flood soon?", use it and say it is a forecast, not an official warning. Details and accuracy are in "Next-hour forecast" below.
- Flood levels are measured at river gauges. Each gauge has three official marks: alert (get ready), minor flood (water spills onto low ground) and major flood (move to safety). Levels on this site are always shown in feet; gauges that publish in metres are converted.
- Readings arrive about once an hour and a gauge older than 3 hours is marked "not reporting". Every page and API record carries the time of the reading in Sri Lanka time (UTC+5:30). Quote that time, not the time you read it.
- A blank or missing figure means unknown, never zero.
- Reservoir figures (storage, spill, release) come from daily reports, so they can be up to a day old: quote the date shown.
- Town pages give an estimate for a town (from the nearest gauge, rain and warnings). Streets can flood before a river reaches a flood mark. It is not an official warning.
- For anything urgent, send people to the Disaster Management Centre hotline 117 and to the official bulletins at https://www.dmc.gov.lk and https://www.irrigation.gov.lk.

## Next-hour forecast

What it is: for every river gauge, the level the river is expected to reach in about one hour from the latest reading, with a range it should stay inside, whether it is rising, falling or steady, and whether the range reaches the alert, minor-flood or major-flood level. It is refreshed every hour with the gauge readings. As far as we know it is the only public next-hour river forecast for Sri Lanka; the official agencies publish readings and bulletins, not an hour-ahead level.

How it is made, in plain terms: from how the river has been moving over the last hours, what the gauges upstream are doing (water takes hours to travel down a river) and the rain that has fallen and is forecast over the hills that drain into the gauge. Gauges without enough history get a simpler estimate that carries the recent change forward, and it says so (method "trend" instead of "model"). A gauge that has not reported in 3 hours gets no forecast.

Storm awareness: the rain that has fallen or is forecast over the catchment above the gauge (area average, Open-Meteo) is added to the forecast only when it is heavy (about 50 mm or more over the last or next 24 hours), because in calm weather it adds almost nothing. That was tested on 11 months of readings including the November 2025 Ditwah floods, leaving each storm out in turn: for the gauges and horizons where it helped (6 to 24 hours ahead) the average miss in storms fell by about 5 to 15%, but forecasts in a big storm are still far less certain than in calm weather and often too low at the peak, so the range is wide. When 50 mm or more is forecast upstream (or the heavier ensemble scenario reaches 100 mm) the answer carries a \`rainRisk\` field and the sentence "Heavy rain forecast upstream in the next 24 hours (about N mm). The river may rise faster than the line shows." When a gauge itself measured very heavy rain (25 mm in 1 hour or 40 mm in 3 hours, here or upstream) the answer also carries \`rainRisk\` with the sentence "Very heavy rain was measured at X in the last N hours (M mm). The river may rise fast." Treat it as a reason to check the official warnings, not as a level.

How accurate it has been: ${accuracyLine(acc)} Plain-language version: ${SITE}/about#next-hour

How to quote it: "forecast, not an official warning", with the time it was issued (issuedAt, Sri Lanka time, UTC+5:30), in the form: "${SITE_NAME} forecasts <river> at <gauge> at about <level_ft> ft in the next hour (<low_ft> to <high_ft> ft), issued <time>; this is a forecast, not an official warning." Link the gauge page. For anything urgent point to the Disaster Management Centre, hotline 117.

Where to get it:
- Every gauge page (${SITE}/<river>/<station>) shows it under the heading and answers "Will the river rise in the next hour?"; town pages answer "Will <town> flood in the next hour?"
- JSON: ${SITE}/api/levels, field \`nextHour\` on each station: { level_ft, low_ft, high_ft, change_ft, direction ("rising" | "falling" | "steady"), slow, crossing (e.g. "may reach alert level", else null), issuedAt (ISO 8601), method ("model" | "trend"), experimental, rainRisk (null, or { kind: "forecast" | "measured" | "both", level: "heavy" | "very-heavy" | "possible" | null, mm_24h, forecast_mm_24h, heavier_scenario_mm_24h, measured: { gauge, upstream, hours, mm } | null, line } when heavy rain is forecast upstream in the next 24 hours, or the gauges measured 25 mm in 1 hour or 40 mm in 3 hours at this gauge or one upstream) }. null when the gauge is not reporting or has no forecast. Same filters (?river=, ?station=, ?town=).
- MCP: tool get_next_hour_forecast (all gauges, one river or one gauge), also included in get_station_readings and get_basin_snapshot.

## Cite as

"${SITE_NAME} (${OWNER.name}), <page URL>, data from the Department of Irrigation, Sri Lanka." Link the specific station, river, reservoir or town page you used.

## Pages

- [Home: all rivers, map and what needs attention now](${SITE}/): live status and next-hour forecast of every gauge
- [Flood risk for towns](${SITE}/flood): 135+ towns, each page answers "is it flooding now?" and "will it flood in the next hour?" (pattern: ${SITE}/flood/<town>, e.g. ${SITE}/flood/wellampitiya)
- [Colombo canals](${SITE}/colombo-canals): how Colombo's canals drain (Kolonnawa, Parliament Lake, Wellawatta, Dehiwala), predicted high-tide times, and live canal levels from CUrW / SLLDC (pub.curwsl.org; credit them). Canal levels and tide are context, not a flood warning. JSON: ${SITE}/api/canals
- [Rivers](${SITE}/kelani-ganga): one page per river, one per gauge, each with the next-hour forecast (pattern: ${SITE}/<river>/<station>, e.g. ${SITE}/kelani-ganga/hanwella)
- [Reservoirs](${SITE}/reservoirs): storage and spill/release for 170 reservoirs (pattern: ${SITE}/reservoirs/<name>)
- [Past floods](${SITE}/history): how high past events reached at each gauge
- [Flood news](${SITE}/news): an index of links to news reports (Newswire, Ada Derana, Daily Mirror) from the last 7 days about floods, rivers, spill gates, heavy rain, cyclones and landslides, tagged and linked to our river and reservoir pages. It is a news index, not a source of facts: the reports are by other outlets and are not official, so check the Disaster Management Centre (117) and the Irrigation Department
- [Flood help and emergency contacts](${SITE}/help): who to call, what to do, by district
- [How it works, next-hour forecast accuracy, sources and limits](${SITE}/about)
- [Data and API for developers](${SITE}/data)
- [Research: street flooding in Wellampitiya and Kolonnawa](${SITE}/research/wellampitiya-street-flooding): 16 documented floods since 2018, 9 with the Kelani at minor flood level and 6 with a normal river; rain totals of 60 mm and 100 mm in 24 h (each hour capped at 15 mm) preceded most of them, but only a few low-lying spots beside the canals get water, so the site offers them only as a personal opt-in note for low ground, never as a town warning; the rule is often wrong (about 8 early alarms a year with no recorded flood). Cite as in the page. Index: ${SITE}/research
- [Source health](${SITE}/status): whether each data source is up right now
- Sinhala: ${SITE}/si/ . Tamil: ${SITE}/ta/ . Every page exists in all three languages at the same path (English unprefixed).

## Machine-readable data (free, no key, CORS open, refreshed every minute)

- [Current levels and next-hour forecast, all gauges](${SITE}/api/levels): JSON, each station has levels, flood marks and a \`nextHour\` forecast. Filters: ?river=kelani-ganga, ?station=hanwella, ?town=wellampitiya
- [Reservoirs](${SITE}/api/reservoirs): JSON. Filters: ?slug=..., ?status=spilling
- [Alerts feed](${SITE}/feed.xml): Atom, gauges at alert level or above and reservoirs releasing water
- [Data-source health](${SITE}/api/health): JSON
- [Raw release snapshots and history](${DATA_BRANCH}): newline-delimited JSON on GitHub
- MCP server (Streamable HTTP): ${SITE}/mcp , tools get_next_hour_forecast, list_basins, list_stations, get_station_readings, get_basin_snapshot (a river from upstream to downstream), get_official_warnings, get_reservoir_releases and get_spill_watch
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
export function nationalSummary(national: NationalStation[], now = Date.now(), nh: Record<string, NextHour | null> | null = null): string {
  const recs = national.map((s) => ({ s, r: levelRecord(s, now) }));
  const reporting = recs.filter((x) => x.r.status !== "stale" && x.r.observedAt);
  const flagged = reporting.filter((x) => ["alert", "minor", "major"].includes(x.r.status));
  const watch = reporting.filter((x) => x.r.status === "watch");
  const newest = national.reduce<number | null>((m, s) => (s.latest && (m == null || s.latest.ts > m) ? s.latest.ts : m), null);
  const withNh = nh ? reporting.filter((x) => nh[x.s.station]) : [];
  const moving = (dir: "rising" | "falling") =>
    withNh.filter((x) => {
      const h = nh![x.s.station]!;
      return h.direction === dir && Math.abs(Number(h.change_ft.toFixed(1))) >= 0.1;
    });
  const rise = moving("rising");
  const fall = moving("falling");
  const nhLine = withNh.length
    ? `- Next-hour forecast (not an official warning), ${withNh.length} gauges: ${rise.length} expected to rise, ${fall.length} to fall, ${withNh.length - rise.length - fall.length} about the same.${rise.length ? ` Rising: ${rise.slice(0, 6).map((x) => `${stationDisplayName(x.s.station)} to about ${nh![x.s.station]!.level_ft.toFixed(1)} ft`).join("; ")}${rise.length > 6 ? `; and ${rise.length - 6} more` : ""}.` : ""}`
    : "";
  const lines = [
    `## Right now${newest ? ` (newest reading ${stamp(newest)}, Sri Lanka time)` : ""}`,
    "",
    `- ${reporting.length} of ${national.length} gauges are reporting.`,
    flagged.length
      ? `- At or above a flood mark: ${flagged.map((x) => `${stationDisplayName(x.s.station)} on the ${x.r.river} (${x.r.statusLabel}, ${x.r.level ?? "?"} ft)`).join("; ")}.`
      : "- No gauge is at its alert level or above.",
    watch.length ? `- Close to alert level: ${watch.map((x) => stationDisplayName(x.s.station)).join(", ")}.` : "",
    nhLine,
    "",
  ];
  return lines.filter((l, i) => l !== "" || lines[i - 1] !== "").join("\n");
}

/** The long version: every gauge with its marks, every reservoir and town page. */
export function fullListing(national: NationalStation[], rsv: ReservoirsData | null, now = Date.now(), nh: Record<string, NextHour | null> | null = null, acc: AccuracyFile | null = null): string {
  const byRiver = new Map<string, NationalStation[]>();
  for (const s of national) byRiver.set(s.basin.trim(), [...(byRiver.get(s.basin.trim()) ?? []), s]);
  const g = [...byRiver.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([river, list]) => {
    const rows = list.map((s) => {
      const r = levelRecord(s, now);
      const m = r.marks;
      const marks = [m.alert != null ? `alert ${m.alert}` : "", m.minor != null ? `minor flood ${m.minor}` : "", m.major != null ? `major flood ${m.major}` : ""].filter(Boolean).join(", ");
      const now_ = r.level != null && r.observedAt ? `${r.level} ft, ${r.statusLabel.toLowerCase()}, read ${stamp(Date.parse(r.observedAt))}` : "no current reading";
      const h = nh?.[s.station];
      const next = h
        ? `; next hour (forecast): ${h.direction} to about ${h.level_ft.toFixed(1)} ft${h.low_ft != null && h.high_ft != null ? ` (${h.low_ft.toFixed(1)} to ${h.high_ft.toFixed(1)} ft)` : ""}${h.crossing ? `, ${h.crossing}` : ""}`
        : "";
      return `  - [${stationDisplayName(s.station)}](${r.url}): ${now_}${next}${marks ? `; marks (ft): ${marks}` : "; no flood marks published"}`;
    });
    return `- ${river}\n${rows.join("\n")}`;
  });
  const towns = PLACES.map((p) => `- [${p.name}, ${p.district}](${SITE}/flood/${p.slug})`);
  const rsvLines = (rsv?.items ?? []).map((r) => `- [${r.name}](${SITE}/reservoirs/${r.slug}): ${r.status}${r.storage ? `, ${Math.round(r.storage.pct)}% full` : ""}${r.latestDay ? ` (reading of ${r.latestDay})` : ""}${r.river ? `, ${r.river}` : ""}`);
  return [
    llmsIntro(acc),
    nationalSummary(national, now, nh),
    "## Every river gauge (levels in feet, next-hour forecast, official marks)",
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
