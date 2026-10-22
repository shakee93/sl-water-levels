#!/usr/bin/env bash
# Export one month of the D1 prediction log to JSON for review.
# Usage: scripts/export-predictions.sh YYYY-MM <outDir>
# Needs CLOUDFLARE_ACCOUNT_ID + CLOUDFLARE_API_TOKEN (D1 read). Month boundaries
# are Asia/Colombo (UTC+05:30, no DST).
set -euo pipefail
month="$1"; out="$2"; mkdir -p "$out"
start=$(node -e "console.log(Date.parse('$month-01T00:00:00+05:30'))")
end=$(node -e "const [y,m]='$month'.split('-').map(Number);const n=m===12?(y+1)+'-01':y+'-'+String(m+1).padStart(2,'0');console.log(Date.parse(n+'-01T00:00:00+05:30'))")
q() { npx -y wrangler@4 d1 execute sl-water-levels --remote --json --command "$1" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const r=JSON.parse(s);process.stdout.write(JSON.stringify(r[0].results))})"; }

# Every predicted level next to the closest actual reading.
q "SELECT * FROM forecast_verification WHERE issued_at >= $start AND issued_at < $end" > "$out/verification.json"

# Every stated threshold chance next to what happened in the following 24 h.
q "SELECT r.station, r.basin, r.issued_at, r.method, r.unit, r.current_level, r.tier, r.verdict,
          c.threshold, c.level AS threshold_level, c.probability, c.eta_ts, c.wording,
          (SELECT MAX(o.level) FROM observations o WHERE o.station = r.station
             AND o.ts > r.issued_at AND o.ts <= r.issued_at + 86400000) AS max_next24h,
          (SELECT MIN(o.ts) FROM observations o WHERE o.station = r.station
             AND o.ts > r.issued_at AND o.ts <= r.issued_at + 86400000 AND o.level >= c.level) AS crossed_at
   FROM forecast_crossings c JOIN forecast_runs r ON r.id = c.run_id
   WHERE r.issued_at >= $start AND r.issued_at < $end" > "$out/crossings.json"

# Run-level metadata (method, model version, rain inputs, verdicts shown).
q "SELECT * FROM forecast_runs WHERE issued_at >= $start AND issued_at < $end" > "$out/runs.json"
echo "exported $month to $out"
