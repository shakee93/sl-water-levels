"""Fit the rough Hanwella (m) -> Nagalagam Street (ft) relation from the hourly archive (nuuuwan/lk_irrigation all.json, since 23 Nov 2025).
  python fit-hanwella.py ALL_JSON OUT_JSON
Nagalagam(t) is paired with Hanwella(t - LAG): at high flows Hanwella leads (corr 0.89-0.90 at 18-24 h vs 0.81 at 0 h for Hanwella > 5 m).
Binned medians, made monotone, only bins with 5+ hours. Shown on the map only as 'rough'; Nagalagam's own level is always preferred."""
import sys, json, numpy as np
d = json.load(open(sys.argv[1]))
def series(name):
    r = sorted((x["time_ut"], x["water_level_m"]) for x in d if x["station_name"].startswith(name) and x["water_level_m"] is not None)
    return np.array([a for a, b in r]), np.array([b for a, b in r])
tn, vn = series("Nagalagam"); th, vh = series("Hanwella")
grid = np.arange(int(max(tn[0], th[0]) // 3600) * 3600, int(min(tn[-1], th[-1]) // 3600) * 3600, 3600)
N = np.interp(grid, tn, vn) / 0.3048; H = np.interp(grid, th, vh)
LAG = 18
n, h = N[LAG:], H[:-LAG]
rows = []; prev = 0
for lo in np.arange(3.0, 11.01, 0.5):
    m = (h >= lo) & (h < lo + 0.5)
    if m.sum() < 5: continue
    v = float(np.median(n[m])); prev = max(prev, v); rows.append([round(lo + 0.25, 2), round(prev, 2), int(m.sum())])
hi = h > 5
res = dict(lag_hours=LAG, corr_high_flow=round(float(np.corrcoef(n[hi], h[hi])[0, 1]), 3), corr_same_time=round(float(np.corrcoef(N[H > 5], H[H > 5])[0, 1]), 3), hours=int(len(n)), table=[[a, b] for a, b, _ in rows], bin_hours=[c for _, _, c in rows],
           note="Hanwella (m) -> Nagalagam Street (ft) about lag_hours later; medians of the hourly archive, Nov 2025 - Oct 2026. Rough: one big flood, spread of 1-2 ft.")
json.dump(res, open(sys.argv[2], "w"), indent=1)
print(res)
