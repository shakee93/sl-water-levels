"""Cyclone Ditwah replay (25 Nov - 8 Dec 2025): hourly river series for the map, and the tests behind the "fills first -> fills last" claim.
  WORK=... GAUGES=all.json python replay.py OUT_DITWAH_JSON OUT_RESULTS_JSON [gsmap-catchment-hourly.json.gz]
Needs replay_base.py to have run first (replay_cache.npz). Prints a readable summary; writes the small public file (ditwah.json: hourly Nagalagam
level with the tide smoothed out, Hanwella, catchment rain, the two satellite capture hours) and a results JSON for the private findings note.
What is tested (all against Copernicus EMSR851 maps; see research/ditwah-replay.md):
  1. nesting: is what was wet on a later date a subset of what was wet earlier (same low spots, shrinking into them)?
  2. persistence order: do cells that stay wet longest have the lowest HAND?  3. connectivity: is observed water connected to the channel network?
  4. leave-one-moment-out and leave-one-area-out scores for plain HAND, the fitted level, and the fitted level + bounds from the other moments."""
import sys, gzip, json
import numpy as np
from scipy import ndimage as ndi
from scipy.stats import spearmanr
from replay_lib import *
OUT_PUB, OUT_RES = sys.argv[1], sys.argv[2]
GSM = sys.argv[3] if len(sys.argv) > 3 else None
by = load_series()
nag = hourly(by, "Nagalagam Street", 0.3048); han = hourly(by, "Hanwella")
def cen(x, k=13):
    h = k // 2; return np.array([x[max(0, i - h):i + h + 1].mean() for i in range(len(x))])
stage = cen(nag)            # tide smoothed river level at Nagalagam (centred 13 h mean): what the floodplain answers to
i0 = int(round(hidx("2025-11-24T18:30"))); n = 14 * 24     # 25 Nov 00:00 Sri Lanka time, 14 days
res = {}
# ---- 0. public series
rain = [0] * n
if GSM and os.path.exists(GSM):
    g = json.load(gzip.open(GSM)); a = g["products"]["nrt"]["Kelani Ganga/Nagalagam Street#near"]
    t_end0 = g["t0End"] / 1000
    for k in range(n):
        j = int(round((UT0 + 3600 * (i0 + k + 1) - t_end0) / 3600))      # value j = hour ending t0End + j h
        v = a[j] if 0 <= j < len(a) and a[j] is not None else 0
        rain[k] = int(round(min(15.0, v * 0.92) * 10))                    # wet-zone bias 0.92, 15 mm/h cap (as lib/rainCorrection / river-rain-response)
pub = dict(start=int(UT0 + 3600 * i0), hours=n, nag=[int(round(float(stage[i0 + k]) * 100)) for k in range(n)],
           han=[int(round(float(han[i0 + k]) * 10)) for k in range(n)], rain=rain,
           shots=[dict(h=int(round(hidx(CAP[k]) - i0)), ev=ev) for k, ev in (("E1", "EMS 30 Nov 2025"), ("E3", "EMS 3 Dec 2025"))],
           note="Nagalagam Street ft x100 (13 h centred mean, tide removed), Hanwella m x10, satellite rain mm/h x10 over the Nagalagam-side grid cell (bias 0.92, cap 15), hourly from `start` (UTC seconds)")
json.dump(pub, open(OUT_PUB, "w"), separators=(",", ":"))
print("ditwah.json bytes", os.path.getsize(OUT_PUB), "| peak", max(pub["nag"]) / 100, "ft at", lk(i0 + int(np.argmax(pub["nag"]))))

def auc(score, pos, neg):
    a = score[pos]; b = score[neg]
    if len(a) == 0 or len(b) == 0: return float("nan")
    rng = np.random.default_rng(0); a = rng.choice(a, min(len(a), 20000), replace=False); b = rng.choice(b, min(len(b), 20000), replace=False)
    r = np.concatenate([a, b]).argsort().argsort() + 1
    return float(1 - (r[:len(a)].sum() - len(a) * (len(a) + 1) / 2) / (len(a) * len(b)))
keys = ["E1", "E2", "E3", "A4", "A5", "A6"]
# ---- 1. nesting
nest = []
for ai, a_ in enumerate(keys):
    for b_ in keys[ai + 1:]:
        for an in ("corridor", "Kolonnawa/Wellampitiya", "Kelaniya"):
            ok = EV[a_]["foot"] & EV[b_]["foot"] & AREAS[an] & ~DRAIN & ~sea
            wa = EV[a_]["wet"] & ok; wb = EV[b_]["wet"] & ok
            if ok.sum() < 500 or wb.sum() < 30: continue
            nest.append(dict(earlier=a_, later=b_, area=an, later_wet_cells=int(wb.sum()), later_wet_already_wet_before=round(float((wa & wb).sum() / wb.sum()), 3)))
res["nesting"] = nest
print("NESTING (share of the LATER date's wet cells that were already wet on the earlier date)")
for r in nest: print("  ", r["earlier"], "->", r["later"], r["area"][:12].ljust(12), r["later_wet_already_wet_before"], "n", r["later_wet_cells"])
# ---- 2. persistence and ordering power of HAND
ok = EV["E1"]["foot"] & EV["E3"]["foot"] & okall
cls = np.where(EV["E3"]["wet"], 2, np.where(EV["E1"]["wet"], 1, 0)); pers = {}
for an, am in AREAS.items():
    m = ok & am
    if m.sum() < 500: continue
    med = [float(np.median(HAND[m & (cls == c)])) if (m & (cls == c)).any() else None for c in (2, 1, 0)]
    pers[an] = dict(median_hand_m=[round(x, 2) if x is not None else None for x in med], spearman=round(float(spearmanr(HAND[m], cls[m]).correlation), 3), n=int(m.sum()))
res["persistence"] = pers; print("PERSISTENCE (median HAND m: wet on both dates / wet 30 Nov only / dry both; spearman HAND vs persistence)"); print(json.dumps(pers))
res["auc_hand"] = {k: {an: round(auc(HAND, EV[k]["wet"] & EV[k]["foot"] & okall & am, ~EV[k]["wet"] & EV[k]["foot"] & okall & am), 3) for an, am in AREAS.items() if (EV[k]["wet"] & EV[k]["foot"] & okall & am).sum() > 100} for k in ("E1", "E3", "A4", "A5", "A6")}
print("AUC of HAND (low => wet)", json.dumps(res["auc_hand"]))
# ---- 3. connectivity of observed water with the channel network
seeds = ndi.binary_dilation(DRAIN, iterations=2)
def conn(pred):
    lab, _ = ndi.label(pred | DRAIN, structure=np.ones((3, 3))); return pred & np.isin(lab, np.unique(lab[seeds & (lab > 0)]))
res["connected_share"] = {k: round(float(conn(EV[k]["wet"] & EV[k]["foot"] & ~DRAIN).sum() / max(1, (EV[k]["wet"] & EV[k]["foot"] & ~DRAIN).sum())), 3) for k in ("E1", "E3", "A4", "A5", "A6")}
print("share of observed wet cells in water bodies that touch the channel network", json.dumps(res["connected_share"]))
# ---- 4. leave-one-moment-out and leave-one-area-out
def bounds(moments):
    hi = np.full((H, W), np.inf); lo = np.full((H, W), -np.inf)
    for k in moments:
        ev = EV[k]; s = ev["nag_ft"] * FT; f = ev["foot"] & okall
        hi = np.where(f & ev["wet"], np.minimum(hi, s), hi); lo = np.where(f & ~ev["wet"], np.maximum(lo, s), lo)
    return lo, hi
def bounded(prior_ft, moments):
    lo, hi = bounds(moments); P = prior_ft * FT
    return np.minimum(np.maximum(P, lo + 0.02), np.where(hi < np.inf, np.maximum(hi, lo + 0.03), np.inf)) / FT
thr = lambda s: 1 if s < 5 else 2 if s < 7 else 3
STAGE = {"E1": 7.4, "E2": 7.2, "E3": 4.6, "A4": 3.0, "A5": 2.5, "A6": 2.4}
for k in STAGE: EV[k]["nag_ft"] = STAGE[k]       # tide-smoothed stages for the low moments (see prep.py EXTRA)
EV["E1"]["nag_ft"] = 7.4; EV["E3"]["nag_ft"] = 4.6
rows = []
for test in ("E1", "E3", "A4", "A5", "A6"):
    fit_ev = [m for m in ("E1", "E3") if m != test] or ["E1", "E3"]
    cz, cg = fit(fit_ev); prior = level_ft(cz, cg)
    Lb2 = bounded(prior, [m for m in ("E1", "E3") if m != test]); Lb = bounded(prior, [m for m in ("E1", "E3", "A4", "A5", "A6") if m != test])
    ev = EV[test]; s = ev["nag_ft"]
    for an, am in AREAS.items():
        ok = ev["foot"] & okall & am
        if ev["wet"][ok].sum() < 100: continue
        for name, pred in (("plain HAND bathtub", HAND <= thr(s)), ("fitted level", prior <= s), ("fitted + bounds from the other flood date (the map before)", Lb2 <= s), ("fitted + bounds from all other dates (the map now)", Lb <= s)):
            r = skill(pred, ev["wet"], ok); rows.append(dict(test=test, area=an, model=name, **{k: round(float(v), 3) for k, v in r.items()}))
res["leave_one_moment_out"] = rows
print("LEAVE-ONE-MOMENT-OUT (csi/hit/false-alarm share)")
for r in rows: print("  ", r["test"], r["area"][:11].ljust(11), r["model"][:44].ljust(44), r["csi"], r["hit"], r["far"], "n", r["n_wet"])
hold = []
for an in ("Kolonnawa/Wellampitiya", "Kelaniya", "Biyagama/Kaduwela", "Colombo north"):
    am = AREAS[an]; czo, cgo = fit(["E1", "E3"], sel_extra=~am); Lo = level_ft(czo, cgo); czi, cgi = fit(["E1", "E3"], sel_extra=am); Li = level_ft(czi, cgi)
    for k in ("E1", "E3"):
        ev = EV[k]; s = ev["nag_ft"]; a_ = skill(Lo <= s, ev["wet"], ev["foot"] & okall & am); b_ = skill(HAND <= thr(s), ev["wet"], ev["foot"] & okall & am)
        c_ = skill(Li <= s, ev["wet"], ev["foot"] & okall & ~am); d_ = skill(HAND <= thr(s), ev["wet"], ev["foot"] & okall & ~am)
        hold.append(dict(area=an, moment=k, n_wet_in_area=a_["n_wet"], fit_without_area_scored_in_area=round(float(a_["csi"]), 3), plain_in_area=round(float(b_["csi"]), 3), fit_only_in_area_scored_outside=round(float(c_["csi"]), 3), plain_outside=round(float(d_["csi"]), 3)))
res["leave_one_area_out"] = hold; print("LEAVE-ONE-AREA-OUT (csi)"); [print("  ", json.dumps(h)) for h in hold]
# ---- 5. the replay itself, from the shipped level (arrays.npz Lft): wet area per hour, first and last wet hour per cell
L = A["Lft"]; painted = okall & np.isfinite(L) & (L < 25) & (L > 2.2)
first = np.full((H, W), -1, np.int16); last = np.full((H, W), -1, np.int16); peak = np.zeros((H, W), np.float32)
for k in range(n):
    s = stage[i0 + k]; w = painted & (L <= s)
    first = np.where(w & (first < 0), k, first); last = np.where(w, k, last); peak = np.maximum(peak, np.where(w, s - L, 0))
hrs = np.where(first >= 0, last - first + 1, 0)
ha = [round(float(((painted & (L <= stage[i0 + k])).sum()) * 0.09), 0) for k in range(n)]
res["replay"] = dict(wet_ha_by_hour=ha[::6], first_wet_by_area={}, painted_cells=int(painted.sum()), ever_wet=int((first >= 0).sum()))
for an, am in AREAS.items():
    f = first[am & (first >= 0)]
    if len(f) < 50: continue
    q = np.percentile(f, [5, 25, 50, 75]); res["replay"]["first_wet_by_area"][an] = dict(cells=int(len(f)), p5=lk(i0 + q[0]), p25=lk(i0 + q[1]), median=lk(i0 + q[2]), p75=lk(i0 + q[3]), median_hours_wet=int(np.median(hrs[am & (first >= 0)])))
print("REPLAY first-wet time by area (5th/25th/50th/75th percentile of cells)"); [print("  ", an, json.dumps(v)) for an, v in res["replay"]["first_wet_by_area"].items()]
print("peak wet area ha", max(ha), "at", lk(i0 + int(np.argmax(ha))))
# order independence of the spreading: of cells that become wet in an hour, share next to (within 2 cells of) cells already wet or the channel network
near_prev = []
for k in range(1, n):
    new = painted & (first == k)
    if new.sum() < 40: continue
    prevwet = (painted & (first >= 0) & (first < k)) | DRAIN
    near_prev.append(float((new & ndi.binary_dilation(prevwet, iterations=2)).sum() / new.sum()))
res["replay"]["new_cells_next_to_earlier_water_median"] = round(float(np.median(near_prev)), 3) if near_prev else None
print("share of newly wet cells within 60 m of earlier water or a channel (median over hours)", res["replay"]["new_cells_next_to_earlier_water_median"])
# ---- 6. the held-out 2 Dec 2025 map (Pleiades, Colombo/Kolonnawa side, river 7.2 ft): never used for the fit or the bounds. Level stacked at the bracket edge (before) vs spread by HAND (now)
cz, cg = fit(["E1", "E3"]); prior = level_ft(cz, cg); lo_, hi_ = bounds(["E1", "E3"]); P = prior * FT
pile = np.minimum(np.maximum(P, lo_ + 0.02), np.where(hi_ < np.inf, np.maximum(hi_, lo_ + 0.03), np.inf)) / FT
e2 = []
for an, am in AREAS.items():
    ev = EV["E2"]; ok = ev["foot"] & okall & am
    if ev["wet"][ok].sum() < 100: continue
    for nm, Lx in (("stacked at the bracket edge (before)", pile), ("spread by HAND inside the bracket + low-stage bounds (now)", A["Lft"])):
        r = skill(Lx <= 7.2, ev["wet"], ok); e2.append(dict(area=an, model=nm, **{k: round(float(v), 3) for k, v in r.items()}))
res["held_out_2_dec"] = e2; print("HELD-OUT 2 DEC 2025 (7.2 ft)"); [print("  ", json.dumps(x)) for x in e2]
json.dump(res, open(OUT_RES, "w"), indent=1, default=float)
