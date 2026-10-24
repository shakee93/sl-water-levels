#!/usr/bin/env bash
# Export one month of the street-flood validation data from Cloudflare D1 to JSON for the monthly review.
# Usage: scripts/export-street-flood.sh YYYY-MM <outDir>      (month boundaries are Asia/Colombo, UTC+05:30)
# Needs wrangler to be logged in (npx wrangler login) or CLOUDFLARE_ACCOUNT_ID + CLOUDFLARE_API_TOKEN (D1 read).
# Writes rain_log.json, changes.json, shadow_changes.json, reports.json, reports_by_day.json, shadow_by_day.json. Keep the output PRIVATE: do not commit it
# to the public data branch (resident reports are not shown publicly yet).
set -euo pipefail
month="$1"; out="$2"; mkdir -p "$out"
start=$(node -e "console.log(Date.parse('$month-01T00:00:00+05:30'))")
end=$(node -e "const [y,m]='$month'.split('-').map(Number);const n=m===12?(y+1)+'-01':y+'-'+String(m+1).padStart(2,'0');console.log(Date.parse(n+'-01T00:00:00+05:30'))")
# The shadow test started on 24 Oct 2026 (Colombo): earlier runs have no shadow state and are not "unknown" runs.
SHADOW_FROM=$(node -e "console.log(Date.parse('2026-10-24T00:00:00+05:30'))")
q() { npx -y wrangler@4 d1 execute sl-water-levels --remote --json --command "$1" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const r=JSON.parse(s);process.stdout.write(JSON.stringify(r[0].results,null,1))})"; }

# What the rule said, every run (about every 30 min), with Colombo time. mm24h_clipped (each hour capped at 15 mm) is the
# number the rule uses; mm24h is the raw total; river_trigger 1 = Kelani at minor flood level (NULL on rows before 24 Oct 2026).
# SHADOW test columns (NULL before 24 Oct 2026): shadow_state = what the candidate rule would have said (NULL = unknown, never
# none), api_gauge_mm = the rain-gauge wetness index it used, gauge_source = ogimet | arcgis, api_ogimet_mm / api_arcgis_mm = the
# index from each network alone.
q "SELECT zone, datetime((data_end_ms + 19800000) / 1000, 'unixepoch') AS colombo_time, data_end_ms, rate_mm_h, mm1h, mm3h, mm6h, mm24h, mm24h_clipped, river_trigger, state,
          shadow_state, api_gauge_mm, gauge_source, api_ogimet_mm, api_arcgis_mm
   FROM street_rain_log WHERE data_end_ms >= $start AND data_end_ms < $end ORDER BY data_end_ms" > "$out/rain_log.json"

# Every change of state, and whether the owner was told.
q "SELECT zone, datetime((changed_ms + 19800000) / 1000, 'unixepoch') AS colombo_time, changed_ms, from_state, to_state, mm1h, mm6h, mm24h, mm24h_clipped, river_trigger, towns, notified
   FROM street_rain_changes WHERE changed_ms >= $start AND changed_ms < $end ORDER BY changed_ms" > "$out/changes.json"

# Every change of the SHADOW state (never announced anywhere).
q "SELECT zone, datetime((changed_ms + 19800000) / 1000, 'unixepoch') AS colombo_time, changed_ms, from_state, to_state, live_state, mm24h_clipped, api_gauge_mm, gauge_source
   FROM street_rain_shadow_changes WHERE changed_ms >= $start AND changed_ms < $end ORDER BY changed_ms" > "$out/shadow_changes.json"

# Resident answers (no names, no free text, no addresses).
q "SELECT day, datetime((created_ms + 19800000) / 1000, 'unixepoch') AS colombo_time, town, answer, when_hint, lang
   FROM street_flood_reports WHERE created_ms >= $start AND created_ms < $end ORDER BY created_ms" > "$out/reports.json"

# The comparison that matters: per town and day, the answers next to the day's highest LIVE state and the SHADOW rule's
# highest state, and 24 h rain. State codes: 0 none, 1 possible, 2 likely. shadow_unknown_runs = runs that day with no shadow
# state (gauge week missing while the rain was 45 to 60 mm): do not read those as "none". A day where max_shadow_state is
# higher than max_live_state is a day the candidate would have warned earlier; judge it against the answers.
q "SELECT r.day, r.town,
          SUM(r.answer = 'deep') AS deep, SUM(r.answer = 'little') AS little, SUM(r.answer = 'dry') AS dry,
          (SELECT MAX(l.mm24h_clipped) FROM street_rain_log l WHERE l.zone = 'colombo-east'
             AND date((l.data_end_ms + 19800000) / 1000, 'unixepoch') = r.day) AS max_mm24h_clipped,
          (SELECT MAX(CASE l.state WHEN 'likely' THEN 2 WHEN 'possible' THEN 1 ELSE 0 END) FROM street_rain_log l WHERE l.zone = 'colombo-east'
             AND date((l.data_end_ms + 19800000) / 1000, 'unixepoch') = r.day) AS max_state_0none_1possible_2likely,
          (SELECT MAX(CASE l.shadow_state WHEN 'likely' THEN 2 WHEN 'possible' THEN 1 WHEN 'none' THEN 0 END) FROM street_rain_log l WHERE l.zone = 'colombo-east'
             AND date((l.data_end_ms + 19800000) / 1000, 'unixepoch') = r.day) AS max_shadow_state_0none_1possible_2likely,
          (SELECT SUM(l.shadow_state IS NULL AND l.data_end_ms >= $SHADOW_FROM) FROM street_rain_log l WHERE l.zone = 'colombo-east'
             AND date((l.data_end_ms + 19800000) / 1000, 'unixepoch') = r.day) AS shadow_unknown_runs,
          (SELECT MAX(l.api_gauge_mm) FROM street_rain_log l WHERE l.zone = 'colombo-east'
             AND date((l.data_end_ms + 19800000) / 1000, 'unixepoch') = r.day) AS api_gauge_mm
   FROM street_flood_reports r WHERE r.created_ms >= $start AND r.created_ms < $end GROUP BY r.day, r.town ORDER BY r.day, r.town" > "$out/reports_by_day.json"

# Every day of the month with the live and shadow verdicts side by side, whether or not anyone answered (the days nobody
# reported on are where false alarms live). Residents' answers for the day (all towns) are added.
q "SELECT d.day, d.runs, d.max_mm24h_clipped, d.max_live, d.max_shadow, d.shadow_unknown_runs, d.api_gauge_mm, d.gauge_source,
          (SELECT SUM(r.answer = 'deep') FROM street_flood_reports r WHERE r.day = d.day) AS deep,
          (SELECT SUM(r.answer = 'little') FROM street_flood_reports r WHERE r.day = d.day) AS little,
          (SELECT SUM(r.answer = 'dry') FROM street_flood_reports r WHERE r.day = d.day) AS dry
   FROM (SELECT date((data_end_ms + 19800000) / 1000, 'unixepoch') AS day, COUNT(*) AS runs, MAX(mm24h_clipped) AS max_mm24h_clipped,
                MAX(CASE state WHEN 'likely' THEN 2 WHEN 'possible' THEN 1 WHEN 'none' THEN 0 END) AS max_live,
                MAX(CASE shadow_state WHEN 'likely' THEN 2 WHEN 'possible' THEN 1 WHEN 'none' THEN 0 END) AS max_shadow,
                SUM(shadow_state IS NULL AND data_end_ms >= $SHADOW_FROM) AS shadow_unknown_runs,
                MAX(api_gauge_mm) AS api_gauge_mm, MAX(gauge_source) AS gauge_source
         FROM street_rain_log WHERE zone = 'colombo-east' AND data_end_ms >= $start AND data_end_ms < $end GROUP BY 1) d ORDER BY d.day" > "$out/shadow_by_day.json"

echo "exported $month to $out"
