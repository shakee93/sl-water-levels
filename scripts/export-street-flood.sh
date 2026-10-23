#!/usr/bin/env bash
# Export one month of the street-flood validation data from Cloudflare D1 to JSON for the monthly review.
# Usage: scripts/export-street-flood.sh YYYY-MM <outDir>      (month boundaries are Asia/Colombo, UTC+05:30)
# Needs wrangler to be logged in (npx wrangler login) or CLOUDFLARE_ACCOUNT_ID + CLOUDFLARE_API_TOKEN (D1 read).
# Writes rain_log.json, changes.json, reports.json, reports_by_day.json. Keep the output PRIVATE: do not commit it
# to the public data branch (resident reports are not shown publicly yet).
set -euo pipefail
month="$1"; out="$2"; mkdir -p "$out"
start=$(node -e "console.log(Date.parse('$month-01T00:00:00+05:30'))")
end=$(node -e "const [y,m]='$month'.split('-').map(Number);const n=m===12?(y+1)+'-01':y+'-'+String(m+1).padStart(2,'0');console.log(Date.parse(n+'-01T00:00:00+05:30'))")
q() { npx -y wrangler@4 d1 execute sl-water-levels --remote --json --command "$1" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const r=JSON.parse(s);process.stdout.write(JSON.stringify(r[0].results,null,1))})"; }

# What the satellite-rain rule said, every run (about every 30 min), with Colombo time.
q "SELECT zone, datetime((data_end_ms + 19800000) / 1000, 'unixepoch') AS colombo_time, data_end_ms, rate_mm_h, mm1h, mm3h, mm6h, mm24h, state
   FROM street_rain_log WHERE data_end_ms >= $start AND data_end_ms < $end ORDER BY data_end_ms" > "$out/rain_log.json"

# Every change of state, and whether the owner was told.
q "SELECT zone, datetime((changed_ms + 19800000) / 1000, 'unixepoch') AS colombo_time, changed_ms, from_state, to_state, mm1h, mm6h, mm24h, towns, notified
   FROM street_rain_changes WHERE changed_ms >= $start AND changed_ms < $end ORDER BY changed_ms" > "$out/changes.json"

# Resident answers (no names, no free text, no addresses).
q "SELECT day, datetime((created_ms + 19800000) / 1000, 'unixepoch') AS colombo_time, town, answer, when_hint, lang
   FROM street_flood_reports WHERE created_ms >= $start AND created_ms < $end ORDER BY created_ms" > "$out/reports.json"

# The comparison that matters: per town and day, the answers next to the day's highest rain state and 24 h rain.
q "SELECT r.day, r.town,
          SUM(r.answer = 'deep') AS deep, SUM(r.answer = 'little') AS little, SUM(r.answer = 'dry') AS dry,
          (SELECT MAX(l.mm24h) FROM street_rain_log l WHERE l.zone = 'colombo-east'
             AND date((l.data_end_ms + 19800000) / 1000, 'unixepoch') = r.day) AS max_mm24h,
          (SELECT MAX(CASE l.state WHEN 'likely' THEN 2 WHEN 'possible' THEN 1 ELSE 0 END) FROM street_rain_log l WHERE l.zone = 'colombo-east'
             AND date((l.data_end_ms + 19800000) / 1000, 'unixepoch') = r.day) AS max_state_0none_1possible_2likely
   FROM street_flood_reports r WHERE r.created_ms >= $start AND r.created_ms < $end GROUP BY r.day, r.town ORDER BY r.day, r.town" > "$out/reports_by_day.json"

echo "exported $month to $out"
