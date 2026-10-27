"""Shared helpers for replay.py: the grids cached by replay_base.py, the six dated satellite flood maps, areas, skill scores, the per-zone fit
(same as prep.py) and the hourly gauge series. Paths come from the environment: WORK (prep work dir, with replay_cache.npz and arrays.npz) and
GAUGES (the hourly all.json of the lk_irrigation feed, see scripts/gauge-series.mjs)."""
import os, json, datetime as dt, collections, numpy as np
WORK = os.environ["WORK"]; GAUGES = os.environ["GAUGES"]
C = np.load(f"{WORK}/replay_cache.npz")
A = np.load(f"{WORK}/arrays.npz")
H, W = C["HAND"].shape
EVMETA = json.load(open(f"{WORK}/replay_events.json"))
HAND = C["HAND"]; DRAIN = C["DRAIN"]; KNET = C["KNET"]; COVER = C["COVER"]; okall = C["okall"]; sea = C["sea"]; LAND = C["LAND"]; IX = C["IX"]
EV = {k: dict(wet=C[k + "_wet"], foot=C[k + "_foot"], **EVMETA[k]) for k in EVMETA}
RES = 30.0; FT = 0.3048
# exact capture times (UTC) of each image
CAP = {"E1": "2025-11-30T05:39", "E2": "2025-12-02T05:25", "E3": "2025-12-03T07:06", "A4": "2025-12-04T05:14", "A5": "2025-12-05T05:32", "A6": "2025-12-06T05:03"}
# areas (lat0, lat1, lon0, lon1) -> boxes on the grid; same projection as prep.py
from pyproj import Transformer
T = Transformer.from_crs(4326, 32644, always_xy=True)
S, Wl, N, E_ = 6.86, 79.84, 7.00, 80.10
RESm = 30.0
xs, ys = zip(*[T.transform(lo, la) for lo in (Wl, E_) for la in (S, N)])
X0 = np.floor(min(xs) / RESm) * RESm; Y1 = np.ceil(max(ys) / RESm) * RESm
def px(lon, lat):
    x, y = T.transform(lon, lat); return (x - X0) / RESm, (Y1 - y) / RESm
def box(lat0, lat1, lon0, lon1):
    x0, y0 = px(lon0, lat1); x1, y1 = px(lon1, lat0)
    m = np.zeros((H, W), bool); m[max(0, int(y0)):int(y1), max(0, int(x0)):int(x1)] = True; return m
AREAS = {
 "corridor": np.ones((H, W), bool),
 "Kolonnawa/Wellampitiya": box(6.915, 6.96, 79.84, 79.915),
 "Kelaniya": box(6.925, 6.995, 79.87, 79.975),
 "Biyagama/Kaduwela": box(6.90, 7.0, 79.96, 80.10),
 "Colombo north": box(6.925, 6.99, 79.84, 79.885),
}
def skill(pred, obs, ok):
    p = pred & ok; o = obs & ok; tp = (p & o).sum(); fp = (p & ~o).sum(); fn = (~p & o).sum()
    return dict(csi=tp / max(1, tp + fp + fn), hit=tp / max(1, tp + fn), far=fp / max(1, tp + fp), n_wet=int(o.sum()), n_pred=int(p.sum()))
def load_series():
    a = json.load(open(GAUGES)); by = collections.defaultdict(list)
    for r in a:
        if r["water_level_m"] is not None: by[r["station_name"].strip()].append((r["time_ut"], r["water_level_m"]))
    for g in by: by[g].sort()
    return by
UT0 = int(dt.datetime(2025, 11, 23, tzinfo=dt.timezone.utc).timestamp())
NH = 16 * 24 + 6 * 24     # to 8 Dec + margin
def hourly(by, g, unit=1.0, nh=NH):
    v = by[g]; ts = np.array([x[0] for x in v], float); ys = np.array([x[1] for x in v], float)
    return np.interp(UT0 + 3600 * np.arange(nh), ts, ys) / unit
def hidx(iso):   # hour index (float) of an ISO UTC time
    return (dt.datetime.fromisoformat(iso).replace(tzinfo=dt.timezone.utc).timestamp() - UT0) / 3600
def lk(i):       # label of hour index in Sri Lanka time
    return (dt.datetime.utcfromtimestamp(UT0 + 3600 * i) + dt.timedelta(hours=5.5)).strftime("%d %b %H:%M")
ZW = 3000.0
ZONE = ((IX * RES) // ZW).astype(int)
def fit(events, sel_extra=None, stages=None, ratio_cap=1.25, grid=np.arange(-3.0, 3.01, 0.1)):
    """c per 3 km zone + global c, exactly as prep.py, optional extra cell mask (area hold-out) and per-event stage override (ft)."""
    ex = np.ones((H, W), bool) if sel_extra is None else sel_extra
    def score(sel, cs):
        tp = np.zeros(len(cs)); fpp = np.zeros(len(cs)); fnn = np.zeros(len(cs))
        for ev in events:
            ok = sel & ex & EV[ev]["foot"] & okall
            h = HAND[ok]; w = EV[ev]["wet"][ok]; s = (stages[ev] if stages else EV[ev]["nag_ft"]) * FT
            for i, c in enumerate(cs):
                p = (h + c) <= s
                tp[i] += (p & w).sum(); fpp[i] += (p & ~w).sum(); fnn[i] += (~p & w).sum()
        csi = tp / np.maximum(1, tp + fpp + fnn); ratio = (tp + fpp) / np.maximum(1, tp + fnn)
        csi = np.where(ratio <= ratio_cap, csi, -1 + 0 * csi)
        return csi, tp + fnn
    csi, n = score(np.ones((H, W), bool), grid); cg = float(grid[int(np.argmax(csi))])
    cz = {}
    for zid in np.unique(ZONE[okall]):
        csi, n = score(ZONE == zid, grid); k = n[0]; w = min(1.0, k / 150.0)
        cz[int(zid)] = w * float(grid[int(np.argmax(csi))]) + (1 - w) * cg
    return cz, cg
def level_ft(cz, cg):
    lut = np.full(ZONE.max() + 1 - min(0, ZONE.min()) if ZONE.min() < 0 else ZONE.max() + 1, cg)
    off = -min(0, ZONE.min()); lut = np.full(ZONE.max() + off + 1, cg)
    for k, v in cz.items():
        if k + off >= 0: lut[k + off] = v
    return (HAND + lut[ZONE + off]) / FT
