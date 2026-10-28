"""Stage relations for the upstream Kelani cells (28 Oct 2026): each upstream cell is keyed to its nearest gauge and expressed in Nagalagam-equivalent ft, the one scalar the map is driven by.
  python fit-upstream.py ALL_JSON OUT_JSON
u_H(Hanwella m) = the existing Hanwella table (fit-hanwella.py, medians of Nagalagam 18 h later), made strictly increasing and extended up to the Ditwah crest
  (Hanwella 10.95 m on 29 Nov night -> Nagalagam 8.5 ft on 1 Dec) because the binned medians go flat above 9.25 m (Nagalagam spills into the floodplain).
u_G(Glencourse m) = medians of Nagalagam 48 h later (Glencourse leads Nagalagam by ~2 days, corr 0.81 at 48 h), same crest anchor (Glencourse 21.9 m on 28 Nov -> 8.5 ft).
Below the lowest flood bins both relations are flat (Nagalagam does not respond to moderate upstream rises); a 'normal' upstream reading is pinned at USUALLY_WET_FT so that cells wet at
normal river levels are marked usually-wet (never painted), and the next steps rise slowly. These are ONE-FLOOD relations: rough, honest about the spread (p10-p90 given)."""
import sys, json, numpy as np
d = json.load(open(sys.argv[1]))
def series(name):
    r = sorted((x["time_ut"], x["water_level_m"]) for x in d if x["station_name"].startswith(name) and x["water_level_m"] is not None)
    return np.array([a for a, b in r]), np.array([b for a, b in r])
S = {n: series(n) for n in ("Nagalagam", "Hanwella", "Glencourse")}
grid = np.arange(int(max(v[0][0] for v in S.values()) // 3600) * 3600, int(min(v[0][-1] for v in S.values()) // 3600) * 3600, 3600)
X = {n: np.interp(grid, *v) for n, v in S.items()}
N = X["Nagalagam"] / 0.3048
USUALLY_WET_FT = 2.2     # keep in step with WET_FT in prep.py
CREST = 8.5              # Nagalagam crest of Ditwah (hourly archive 8.5 ft, tide-smoothed 8.43)
def table(G, lag, lo, hi, step, crest_G):
    n, g = N[lag:], G[:len(G) - lag]; rows = []
    for a in np.arange(lo, hi, step):
        m = (g >= a) & (g < a + step)
        if m.sum() >= 5: rows.append((a + step / 2, float(np.median(n[m])), float(np.percentile(n[m], 10)), float(np.percentile(n[m], 90)), int(m.sum())))
    return rows
# Hanwella: reuse the committed table (pairs at 18 h)
hw = json.load(open("public/flood3d/hanwella-nag.json"))["table"]
uH = [[0.0, USUALLY_WET_FT - 0.1], [2.0, USUALLY_WET_FT]]
for g, v in hw:
    if g <= 2.0: continue
    uH.append([g, max(v, uH[-1][1] + 0.02)])           # strictly increasing
uH.append([10.95, CREST])
rowsG = table(X["Glencourse"], 48, 8.0, 23.0, 0.5, 21.9)
uG = [[8.4, USUALLY_WET_FT - 0.1], [10.5, USUALLY_WET_FT]]
for g, v, p10, p90, n in rowsG:
    if g <= 10.5 or n < 5: continue
    uG.append([round(g, 2), round(max(v, uG[-1][1] + 0.02), 2)])
# the archive has no Glencourse hours between 16 and 16.5 m with enough support: the relation jumps from ~2.6 to ~6.7 ft there (one flood); join the two with a straight ramp
uG = [p for p in uG if p[0] < 16.1]
uG += [[17.25, 6.87], [18.25, 7.33], [18.75, 7.63], [19.25, 7.96], [19.75, 8.12], [20.25, 8.12 + 0.03], [20.75, 8.35], [21.9, CREST]]
uG = [[round(a, 2), round(b, 2)] for a, b in uG]
mono = [uG[0]]
for a, b in uG[1:]:
    mono.append([a, round(max(b, mono[-1][1] + 0.02), 2)])
res = dict(note="Gauge (m) -> Nagalagam-equivalent ft for the upstream cells of /lab/flood-3d. One flood (Ditwah) fixes the top; the low end is pinned so that normal river levels are 'usually wet'. Rough.",
           hanwella=dict(lag_hours=18, base_m=0.3, table=[[round(a, 2), round(b, 2)] for a, b in uH]),
           glencourse=dict(lag_hours=48, base_m=8.4, table=mono, bins=[[round(a, 2), round(b, 2), round(c, 2), round(e, 2), n] for a, b, c, e, n in rowsG]),
           usually_wet_ft=USUALLY_WET_FT, crest_ft=CREST, split_lon=80.139)
json.dump(res, open(sys.argv[2], "w"), indent=1)
print(json.dumps(res["hanwella"]["table"])); print(json.dumps(res["glencourse"]["table"]))
