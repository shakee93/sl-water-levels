"""Step 2 of the flood-3d prep: HAND, learned per-cell flood level, accuracy, roads. Run with the venv python.
  python prep.py WORKDIR EMSDIR OUTDIR [ground-truth.geojson]
Inputs (step 1 + Copernicus EMSR851 products, GeoJSON): see fetch.py. Outputs (small, committed): OUTDIR/*.
Method in one paragraph: HAND = DSM height above the nearest Kelani Ganga cell (river surface = local minimum). A cell
floods when Nagalagam Street stage >= HAND + c(zone); c is fitted per 3 km reach of the river on the observed EMS maps
(wet at stage s -> flood level <= s; dry inside the analysed footprint -> > s), shrunk to the global value where a
reach has little evidence. Bounds from observations clip the estimate. Level = ft at the Nagalagam Street gauge."""
import sys, os, json, math, numpy as np
import rasterio
from rasterio.warp import reproject, Resampling
from rasterio.transform import Affine
from pyproj import Transformer
from PIL import Image, ImageDraw
from scipy import ndimage as ndi
from shapely.geometry import shape, mapping, LineString
from shapely.ops import transform as shp_transform
from rasterio import features as rfeat

WORK, EMS, OUT = sys.argv[1:4]
GT = sys.argv[4] if len(sys.argv) > 4 else None
os.makedirs(OUT, exist_ok=True)
FT = 0.3048
RES = 30.0
T = Transformer.from_crs(4326, 32644, always_xy=True)
Ti = Transformer.from_crs(32644, 4326, always_xy=True)
S, Wl, N, E_ = 6.86, 79.84, 7.00, 80.10
xs, ys = zip(*[T.transform(lo, la) for lo in (Wl, E_) for la in (S, N)])
X0 = math.floor(min(xs) / RES) * RES; X1 = math.ceil(max(xs) / RES) * RES
Y1 = math.ceil(max(ys) / RES) * RES; Y0 = math.floor(min(ys) / RES) * RES
W = int((X1 - X0) / RES); H = int((Y1 - Y0) / RES)
TR = Affine(RES, 0, X0, 0, -RES, Y1)
print("grid", H, W)
def px(lon, lat):
    x, y = T.transform(lon, lat); return (x - X0) / RES, (Y1 - y) / RES

# ---- terrain
z = np.full((H, W), np.nan, np.float32)
for t in ["N06_00_E079_00", "N06_00_E080_00"]:
    with rasterio.open(f"{WORK}/dem_{t}.tif") as ds:
        tmp = np.full((H, W), np.nan, np.float32)
        reproject(rasterio.band(ds, 1), tmp, dst_transform=TR, dst_crs="EPSG:32644", resampling=Resampling.bilinear, dst_nodata=np.nan)
        z = np.where(np.isfinite(z), z, tmp)
print("dem", np.nanmin(z), np.nanmedian(z), np.nanmax(z))
sea = ~np.isfinite(z) | (z <= 0.05)

# ---- drainage from OSM
ww = json.load(open(f"{WORK}/osm_waterways.json"))["elements"]
def lines_mask(els, width):
    img = Image.new("L", (W, H), 0); dr = ImageDraw.Draw(img)
    for e in els:
        pts = [px(g["lon"], g["lat"]) for g in e["geometry"]]
        if len(pts) > 1: dr.line(pts, fill=255, width=width)
    return np.array(img) > 0
kel_els = [e for e in ww if e["tags"].get("waterway") == "river" and "Kelani" in (e["tags"].get("name", "") + e["tags"].get("name:en", ""))]
if not kel_els: kel_els = [e for e in ww if e["tags"].get("waterway") == "river"]
kel = lines_mask(kel_els, 3)
allw = lines_mask([e for e in ww if e["tags"].get("waterway") in ("river", "canal", "drain")], 2)
print("river ways", len(kel_els), "river px", kel.sum(), "all px", allw.sum())
def hand(zz, drain, smooth=3):
    zm = ndi.minimum_filter(np.where(np.isfinite(zz), zz, 99), size=smooth)
    zd = np.where(drain, zm, np.nan)
    d, (iy, ix) = ndi.distance_transform_edt(~drain, return_distances=True, return_indices=True)
    return np.maximum(zz - zd[iy, ix], 0), d * RES, ix

# ---- EMS evidence rasters
def rast(path, sel=None, ss=3):
    d = json.load(open(path)); img = Image.new("L", (W * ss, H * ss), 0); dr = ImageDraw.Draw(img)
    for f in d["features"]:
        if sel and not sel(f["properties"]): continue
        g = f["geometry"]; polys = g["coordinates"] if g["type"] == "MultiPolygon" else [g["coordinates"]]
        for p in polys:
            for k, ring in enumerate(p):
                pts = [((a - X0) / RES * ss, (Y1 - b) / RES * ss) for a, b in (T.transform(lo, la) for lo, la in ring)]
                if len(pts) > 2: dr.polygon(pts, fill=255 if k == 0 else 0)
    return np.array(img).reshape(H, ss, W, ss).mean(axis=(1, 3)) > 0.5
def fp(pfp, pna, srcs=None):
    a = rast(pfp, lambda p: p.get("obj_type") == "Image Footprint" and (srcs is None or p.get("or_src_id") in srcs))
    n = rast(pfp, lambda p: str(p.get("obj_type", "")).startswith("Not Analysed")); n2 = rast(pna)
    return a & ~n & ~n2
e = EMS + "/"
EV = {
 "E1": dict(label="30 Nov 2025", nag_ft=7.4, wet=rast(e+"aoi02/EMSR851_AOI02_DEL_PRODUCT_observedEventA_v1.json") | rast(e+"aoi01/EMSR851_AOI01_GRA_PRODUCT_observedEventA_v1.json"),
            foot=fp(e+"aoi02/EMSR851_AOI02_DEL_PRODUCT_imageFootprintA_v1.json", e+"aoi02/EMSR851_AOI02_DEL_PRODUCT_notAnalysedA_v1.json") | fp(e+"aoi01/EMSR851_AOI01_GRA_PRODUCT_imageFootprintA_v1.json", e+"aoi01/EMSR851_AOI01_GRA_PRODUCT_notAnalysedA_v1.json")),
 "E3": dict(label="3 Dec 2025 (falling)", nag_ft=4.6, wet=rast(e+"aoi02m/EMSR851_AOI02_DEL_MONIT01_observedEventA_v1.json"),
            foot=fp(e+"aoi02m/EMSR851_AOI02_DEL_MONIT01_imageFootprintA_v1.json", e+"aoi02m/EMSR851_AOI02_DEL_MONIT01_notAnalysedA_v1.json", srcs=[1])),
}
# secondary truth: news/agency points (research/kelaniya-ground-truth.geojson). Scored with a buffer, never used to fit.
PTS = []
STAGE_BY_DATE = {"2016-05": 7.64, "2017-05": 6.0, "2025-11-28": 7.4, "2025-11-29": 7.4, "2025-11-30": 7.4, "2025-12-01": 8.4, "2025-12-02": 8.4}
if GT and os.path.exists(GT):
    for f in json.load(open(GT))["features"]:
        p = f["properties"]
        if p.get("wet") is not True or "gauge" in (p.get("place") or "").lower() or f["geometry"]["type"] != "Point": continue
        d = p.get("date") or ""
        st = STAGE_BY_DATE.get(d) or STAGE_BY_DATE.get(d[:7]) or (8.4 if d.startswith("2025-1") else None)
        if st is None: continue
        big = any(k in ((p.get("place") or "") + (p.get("located_by") or "")).lower() for k in (" gn", "gn ", "village", "pradeshiya", "area"))
        cx, cy = px(*f["geometry"]["coordinates"][:2])
        if 0 <= cx < W and 0 <= cy < H: PTS.append((int(cy), int(cx), st, 1000.0 if big else 300.0, d[:4]))
    print("ground-truth wet points scored", len(PTS))

# ---- area masks
def box(lat0, lat1, lon0, lon1):
    x0, y0 = px(lon0, lat1); x1, y1 = px(lon1, lat0)
    m = np.zeros((H, W), bool); m[max(0, int(y0)):int(y1), max(0, int(x0)):int(x1)] = True; return m
KELANIYA = box(6.925, 6.995, 79.87, 79.975)   # Kelaniya, Peliyagoda, Wanawasala, Dalugama, Kiribathgoda, Waragoda, Pattiwila
WELL = box(6.915, 6.96, 79.84, 79.915)        # Wellampitiya / Kolonnawa / Orugodawatta / Kotikawatta
def skill(pred, obs, ok):
    p = pred & ok; o = obs & ok; tp = (p & o).sum(); fp_ = (p & ~o).sum(); fn = (~p & o).sum()
    return dict(csi=tp / max(1, tp + fp_ + fn), hit=tp / max(1, tp + fn), far=fp_ / max(1, tp + fp_), n_wet=int(o.sum()), n_pred=int(p.sum()))
def rnd(d): return {k: (round(float(v), 3) if isinstance(v, (float, np.floating)) else v) for k, v in d.items()}

# ---- pick drainage variant by CSI on E1 (tuning only the variant and smoothing, not thresholds per band)
best = None; variants = {}
for lab, dr in [("Kelani only", kel), ("Kelani + canals/drains", kel | allw)]:
    for sm in (3, 7):
        h, dist, ix = hand(z, dr, sm)
        ok = EV["E1"]["foot"] & np.isfinite(h) & ~dr & ~sea
        c = max((skill(h <= t, EV["E1"]["wet"], ok)["csi"], t) for t in np.arange(0.5, 4, 0.25))
        variants[f"{lab} / min-filter {sm}"] = round(float(c[0]), 3)
        if best is None or c[0] > best[0]: best = (c[0], lab, sm, dr)
print("variants", variants); _, VLAB, VSM, DRAIN = best
HAND, DIST, IX = hand(z, DRAIN, VSM)
okall = np.isfinite(HAND) & ~DRAIN & ~sea

# ---- plain HAND bands vs both events
BANDS = [(0, 1), (1, 2), (2, 3), (3, 5)]
acc_bands = []
for ev in ("E1", "E3"):
    for area, am in (("corridor", np.ones((H, W), bool)), ("Kelaniya", KELANIYA), ("Wellampitiya", WELL)):
        ok = EV[ev]["foot"] & okall & am
        for hi in (1, 2, 3, 5):
            acc_bands.append(dict(event=ev, area=area, cumulative_to_m=hi, **rnd(skill(HAND <= hi, EV[ev]["wet"], ok))))

# ---- learned per-cell flood level
ZW = 3000.0
ZONE = ((X0 + IX * RES) - X0 // 1 - X0 + 0).astype(float)  # x of nearest river cell, metres from X0
ZONE = (ZONE // ZW).astype(int)
def fit(events, pts=()):
    """Return c (m) per zone and global c. L_m = HAND + c."""
    grid = np.arange(-3.0, 3.01, 0.1)
    def score(sel, cs):
        tp = fpp = fnn = np.zeros(len(cs))
        tp = np.zeros(len(cs)); fpp = np.zeros(len(cs)); fnn = np.zeros(len(cs))
        for ev in events:
            ok = sel & EV[ev]["foot"] & okall
            h = HAND[ok]; w = EV[ev]["wet"][ok]; s = EV[ev]["nag_ft"] * FT
            for i, c in enumerate(cs):
                p = (h + c) <= s
                tp[i] += (p & w).sum(); fpp[i] += (p & ~w).sum(); fnn[i] += (~p & w).sum()
        csi = tp / np.maximum(1, tp + fpp + fnn)
        ratio = (tp + fpp) / np.maximum(1, tp + fnn)           # predicted area / observed area
        csi = np.where(ratio <= 1.25, csi, -1 + 0 * csi)        # never buy CSI by over-predicting: a map that floods 3x too much is a false alarm machine
        return csi, tp + fnn
    csi, n = score(np.ones((H, W), bool), grid); cg = float(grid[int(np.argmax(csi))])
    cz = {}
    for zid in np.unique(ZONE[okall]):
        csi, n = score(ZONE == zid, grid)
        k = n[0]  # wet cells in this reach over the events
        w = min(1.0, k / 150.0)
        cz[int(zid)] = w * float(grid[int(np.argmax(csi))]) + (1 - w) * cg
    return cz, cg
def level_m(cz, cg):
    c = np.vectorize(lambda zid: cz.get(int(zid), cg))(ZONE) if len(cz) else np.full((H, W), cg)
    return HAND + c
def loeo():
    out = []
    for tr, te in (("E1", "E3"), ("E3", "E1")):
        cz, cg = fit([tr]); L = level_m(cz, cg); s = EV[te]["nag_ft"] * FT
        for area, am in (("corridor", np.ones((H, W), bool)), ("Kelaniya", KELANIYA), ("Wellampitiya", WELL)):
            ok = EV[te]["foot"] & okall & am
            out.append(dict(fit_on=tr, test_on=te, area=area, method="learned", **rnd(skill(L <= s, EV[te]["wet"], ok))))
            # plain HAND at the owner's step mapping for the tested stage
            thr = 3 if te == "E1" else 1.0
            out.append(dict(fit_on=tr, test_on=te, area=area, method=f"plain HAND<={thr}m", **rnd(skill(HAND <= thr, EV[te]["wet"], ok))))
            # plain HAND with its own best threshold (the old bathtub; upper bound for the plain method)
            bt = max((skill(HAND <= t, EV[te]["wet"], ok)["csi"], t) for t in np.arange(0.25, 4, 0.25))
            out.append(dict(fit_on=tr, test_on=te, area=area, method=f"plain HAND best threshold {bt[1]}m (cheating)", **rnd(skill(HAND <= bt[1], EV[te]["wet"], ok))))
    return out
LOEO = loeo()
for r in LOEO: print(r)

# final fit on all events
CZ, CG = fit(["E1", "E3"])
Lm = level_m(CZ, CG)
# bounds from observations (wet at s -> L <= s ; dry in footprint at s -> L > s)
hi_b = np.full((H, W), np.inf); lo_b = np.full((H, W), -np.inf)
for ev in EV.values():
    s = ev["nag_ft"] * FT
    hi_b = np.where(ev["foot"] & ev["wet"], np.minimum(hi_b, s), hi_b)
    lo_b = np.where(ev["foot"] & ~ev["wet"], np.maximum(lo_b, s), lo_b)
Lf = np.minimum(np.maximum(Lm, lo_b + 0.02), np.where(hi_b < np.inf, np.maximum(hi_b, lo_b + 0.03), np.inf))
Lft = Lf / FT
# uncertainty class and half-width (ft). Widths from the leave-one-event-out spread (set below), observed bounds tighten.
LO_EV, HI_EV = 4.6, 8.5
bracket = np.isfinite(hi_b) & np.isfinite(lo_b)
cls = np.zeros((H, W), np.uint8)                       # 0 extrapolated, 1 interpolated, 2 observed-bounded
inrange = (Lft >= LO_EV - 0.01) & (Lft <= HI_EV)
cls[inrange] = 1
cls[np.isfinite(hi_b) | np.isfinite(lo_b)] = 2
cls[(~np.isfinite(hi_b)) & (Lft > HI_EV)] = np.where(np.isfinite(lo_b) & (lo_b / FT >= LO_EV), 2, 0)[(~np.isfinite(hi_b)) & (Lft > HI_EV)]
cls[(Lft < LO_EV - 0.01) & ~np.isfinite(hi_b)] = 0
# empirical half-width: |error| of the learned level in the held-out event, as ft, 80th percentile
errs = []
for tr, te in (("E1", "E3"), ("E3", "E1")):
    cz, cg = fit([tr]); L = level_m(cz, cg) / FT
    ok = EV[te]["foot"] & okall
    wet = EV[te]["wet"][ok]; l = L[ok]; s = EV[te]["nag_ft"]
    errs += list(np.abs(np.where(wet, np.minimum(l - s, 0) * 0 + (l - s), 0))[wet])  # only cells known wet: their level is <= s
HW = {"observed": 0.6, "interpolated": float(np.clip(np.percentile(np.abs(errs), 60) if errs else 1.5, 1.0, 3.0)), "extrapolated": 3.0}
print("half-widths ft", HW)
half = np.select([cls == 2, cls == 1], [HW["observed"], HW["interpolated"]], HW["extrapolated"]).astype(np.float32)

# ---- reliability of the cell-level part (gauge known exactly): fit on one event, P(wet at the other event's stage), binned
from math import erf, sqrt
def Phi(x): return 0.5 * (1 + np.vectorize(erf)(x / sqrt(2)))
rel = []
for tr, te in (("E1", "E3"), ("E3", "E1")):
    cz, cg = fit([tr]); L = level_m(cz, cg) / FT; ok = EV[te]["foot"] & okall
    sd = np.sqrt(HW["interpolated"] ** 2 / 3 + 0.0)
    p = Phi((EV[te]["nag_ft"] - L[ok]) / sd); w = EV[te]["wet"][ok]
    for lo, hi in ((0, .05), (.05, .2), (.2, .4), (.4, .6), (.6, .8), (.8, 1.01)):
        m = (p >= lo) & (p < hi)
        rel.append(dict(fit_on=tr, test_on=te, p_from=lo, p_to=min(hi, 1.0), n=int(m.sum()), mean_p=round(float(p[m].mean()), 3) if m.any() else None, observed_wet=round(float(w[m].mean()), 3) if m.any() else None))
for r in rel: print(r)
# pooled recalibration p' = a + b p (least squares on the binned points, weighted by n) so Low/Medium/High mean what they say
xs_ = np.array([r['mean_p'] for r in rel if r['n'] > 500 and r['mean_p'] is not None]); ys_ = np.array([r['observed_wet'] for r in rel if r['n'] > 500 and r['mean_p'] is not None]); ws_ = np.array([r['n'] for r in rel if r['n'] > 500 and r['mean_p'] is not None], float)
A = np.vstack([np.ones_like(xs_), xs_]).T * np.sqrt(ws_)[:, None]; CAL = np.linalg.lstsq(A, ys_ * np.sqrt(ws_), rcond=None)[0]; CAL = [round(float(CAL[0]), 3), round(float(CAL[1]), 3)]; print('calibration', CAL)

# ---- secondary truth: wet points, hit if any non-river cell within the buffer is predicted wet at that event's stage
def point_hits(Lfield_ft, rule):
    out = {}
    for (r, c, st, rad, yr) in PTS:
        k = int(rad // RES) + 1
        r0, r1, c0, c1 = max(0, r - k), min(H, r + k + 1), max(0, c - k), min(W, c + k + 1)
        yy, xx = np.mgrid[r0:r1, c0:c1]; m = ((yy - r) ** 2 + (xx - c) ** 2) * RES * RES <= rad * rad
        ok_ = (okall[r0:r1, c0:c1] & m)
        hit = bool((rule(r0, r1, c0, c1, st) & ok_).any())
        e = out.setdefault(yr, [0, 0]); e[0] += hit; e[1] += 1
    return {y: dict(hit=v[0], n=v[1], rate=round(v[0] / v[1], 2)) for y, v in out.items()}
def plain_rule(r0, r1, c0, c1, st):
    thr = 1 if st < 5 else 2 if st < 7 else 3
    return HAND[r0:r1, c0:c1] <= thr
pts_learned = point_hits(None, lambda r0, r1, c0, c1, st: Lft[r0:r1, c0:c1] <= st)
pts_plain = point_hits(None, plain_rule)
# chance baseline: how often a random Kelaniya cell has a predicted-wet cell within 300 m / 1 km at 7.4 ft (a method that floods everything scores 1.0 on points)
rng = np.random.default_rng(1); cand = np.argwhere(KELANIYA & okall); pick = cand[rng.choice(len(cand), 600, replace=False)]
def baseline(rule, rad):
    save = list(PTS); PTS[:] = [(int(r), int(c), 7.4, rad, "base") for r, c in pick]
    out = point_hits(None, rule); PTS[:] = save; return out["base"]["rate"]
base = {f"{int(rad)} m": dict(learned=baseline(lambda r0, r1, c0, c1, st: Lft[r0:r1, c0:c1] <= st, rad), plain=baseline(plain_rule, rad)) for rad in (300.0, 1000.0)}
print("points learned", pts_learned, "plain", pts_plain, "random-place baseline", base)

# ---- encode a WGS84 PNG: R=level (ft, 0.1 steps from 2), G=half-width*10, B=class + 4*handband
DEG = 0.00028
LW, LE = Wl, E_; LS, LN = S, N
gw = int(round((LE - LW) / DEG)); gh = int(round((LN - LS) / DEG))
GTR = Affine(DEG, 0, LW, 0, -DEG, LN)
def to_wgs(a, fill, dtype=np.float32):
    out = np.full((gh, gw), fill, dtype)
    reproject(a.astype(dtype), out, src_transform=TR, src_crs="EPSG:32644", dst_transform=GTR, dst_crs="EPSG:4326", resampling=Resampling.nearest, dst_nodata=fill)
    return out
BAND = np.select([HAND <= 1, HAND <= 2, HAND <= 3, HAND <= 5], [0, 1, 2, 3], 4)
valid = okall & np.isfinite(Lft)
R = np.where(valid & (Lft < 25), np.clip(np.round((Lft - 2) * 10) + 1, 1, 250), 0)
R = np.where(DRAIN | sea, 255, R)
Rw = to_wgs(R, 0); Gw = to_wgs(np.clip(np.round(half * 10), 0, 250), 0); Bw = to_wgs(cls + 4 * BAND, 0)
img = np.stack([Rw, Gw, Bw], -1).astype(np.uint8)
Image.fromarray(img).save(f"{OUT}/level.png", optimize=True)
print("png", img.shape, os.path.getsize(f"{OUT}/level.png"))

# ---- accuracy of the final map in-sample (what the owner sees at the two observed levels)
insample = []
for ev in ("E1", "E3"):
    for area, am in (("corridor", np.ones((H, W), bool)), ("Kelaniya", KELANIYA), ("Wellampitiya", WELL)):
        ok = EV[ev]["foot"] & okall & am
        insample.append(dict(event=ev, area=area, **rnd(skill(Lft <= EV[ev]["nag_ft"], EV[ev]["wet"], ok))))

# ---- band polygons (HAND); big (2+ MB), so only with HAND_POLYS=1. The page draws the bands from the HAND code in level.png instead.
bands = []
for i, (a, b) in enumerate(BANDS if os.environ.get('HAND_POLYS') else []):
    m = (HAND >= a) & (HAND < b) & okall
    m = ndi.binary_opening(m, iterations=1) | (ndi.binary_closing(m, iterations=1) & m)
    polys = []
    for g, v in rfeat.shapes(m.astype(np.uint8), mask=m, transform=TR):
        s = shape(g).simplify(18, preserve_topology=True)
        if s.area < 3 * RES * RES or s.is_empty: continue
        polys.append(shp_transform(lambda x, y, zz=None: Ti.transform(x, y), s))
    for p in polys:
        bands.append({"type": "Feature", "properties": {"band": i, "range": f"{a}-{b} m"}, "geometry": json.loads(json.dumps(mapping(p), default=float))})
def rcoords(o):
    return [rcoords(c) for c in o] if isinstance(o, (list, tuple)) and o and isinstance(o[0], (list, tuple)) else [round(o[0], 5), round(o[1], 5)]
for f in bands: f["geometry"]["coordinates"] = rcoords(f["geometry"]["coordinates"])
if bands: json.dump({"type": "FeatureCollection", "features": bands}, open(f"{OUT}/hand-bands.json", "w"), separators=(",", ":"))

# ---- EMS observed polygons, simplified (E1 and E3), for the "real past flood" toggle
past = []
for ev, nm in (("E1", "EMS 30 Nov 2025"), ("E3", "EMS 3 Dec 2025")):
    m = ndi.binary_opening(EV[ev]["wet"] & ~DRAIN)
    for g, v in rfeat.shapes(m.astype(np.uint8), mask=m, transform=TR):
        s = shape(g).simplify(30)
        if s.area < 4 * RES * RES: continue
        p = shp_transform(lambda x, y, zz=None: Ti.transform(x, y), s)
        past.append({"type": "Feature", "properties": {"event": nm, "nag_ft": EV[ev]["nag_ft"]}, "geometry": {"type": p.geom_type, "coordinates": rcoords(mapping(p)["coordinates"])}})
json.dump({"type": "FeatureCollection", "features": past}, open(f"{OUT}/ems-2025.json", "w"), separators=(",", ":"))

# ---- roads tagged with estimated flood level + min HAND band
rd = json.load(open(f"{WORK}/osm_roads.json"))["elements"]
CLASS = {"motorway": 0, "motorway_link": 0, "trunk": 0, "trunk_link": 0, "primary": 1, "primary_link": 1, "secondary": 2, "secondary_link": 2, "tertiary": 3, "tertiary_link": 3, "unclassified": 4, "residential": 4}
BINS = [5, 6, 7, 8, 9, 10, 12]
def lbin(l):
    for i, t in enumerate(BINS):
        if l <= t: return i
    return 7
def cell(x, y):
    c = int((x - X0) // RES); r = int((Y1 - y) // RES)
    return (r, c) if 0 <= r < H and 0 <= c < W else None
main, local = [], []
for w in rd:
    tg = w["tags"]; geom = w.get("geometry") or []
    if len(geom) < 2: continue
    pts = [T.transform(g["lon"], g["lat"]) for g in geom]
    dense = [pts[0]]
    for a, b in zip(pts, pts[1:]):
        n = int(math.hypot(b[0] - a[0], b[1] - a[1]) // 25)
        for k in range(1, n + 1): dense.append((a[0] + (b[0] - a[0]) * k / (n + 1), a[1] + (b[1] - a[1]) * k / (n + 1)))
        dense.append(b)
    ls, hs = [], []
    for x, y in dense:
        c = cell(x, y)
        if c and valid[c] and not DRAIN[c]: ls.append(Lft[c]); hs.append(HAND[c])
        else: ls.append(99.0); hs.append(99.0)
    br = 1 if tg.get("bridge") not in (None, "no") or tg.get("tunnel") not in (None, "no") else 0
    runs = []; cur = [0]; cb = lbin(ls[0])
    for i in range(1, len(dense)):
        b_ = lbin(ls[i])
        if b_ == cb: cur.append(i)
        else:
            cur.append(i); runs.append((cb, cur)); cur = [i]; cb = b_
    runs.append((cb, cur))
    for b_, idx in runs:
        if b_ > 6 or len(idx) < 2 or (CLASS[tg['highway']] == 4 and b_ > 4): continue   # local streets only up to the 9 ft bin: keeps the file small
        lm = min(ls[i] for i in idx); hm = min(hs[i] for i in idx)
        band = 0 if hm <= 1 else 1 if hm <= 2 else 2 if hm <= 3 else 3
        coords = [[round(v, 5) for v in Ti.transform(*dense[i])] for i in idx]
        f = {"type": "Feature", "properties": {"n": tg.get("name") or tg.get("ref") or "", "c": CLASS[tg["highway"]], "l": round(float(lm), 1), "b": band, **({"br": 1} if br else {})}, "geometry": {"type": "LineString", "coordinates": coords}}
        (main if CLASS[tg["highway"]] <= 3 else local).append(f)
for nm, fs in (("roads-main", main), ("roads-local", local)):
    json.dump({"type": "FeatureCollection", "features": fs}, open(f"{OUT}/{nm}.json", "w"), separators=(",", ":"))
    print(nm, len(fs), os.path.getsize(f"{OUT}/{nm}.json"))

json.dump(dict(
    generated="2026-10-27", grid=dict(rows=H, cols=W, res_m=RES), png=dict(w=gw, h=gh, west=LW, east=LE, south=LS, north=LN, deg=DEG, level="R: 0 none, 255 river/sea, else ft=(R-1)/10+2; G half-width ft*10; B: class(0 extrapolated,1 interpolated,2 observed-bounded)+4*HANDband(0..4)"),
    drainage=VLAB, minfilter=VSM, variants=variants, events={k: dict(label=v["label"], nag_ft=v["nag_ft"]) for k, v in EV.items()},
    zone_offset_m={str(k): round(v, 2) for k, v in CZ.items()}, global_offset_m=round(CG, 2), half_width_ft=HW,
    plain_bands=acc_bands, loeo=LOEO, insample_note='reproduces the two observed maps by construction (bounds clip); not an accuracy figure', insample=insample, reliability_cell_part=rel, chance_calibration=dict(a=CAL[0], b=CAL[1], sd_ft=round(float(np.sqrt(HW['interpolated'] ** 2 / 3)), 2)), ground_truth_points=len(PTS), points_learned=pts_learned, points_plain_bands=pts_plain, points_random_baseline=base),
    open(f"{OUT}/accuracy.json", "w"), indent=1)
np.savez_compressed(f"{WORK}/arrays.npz", Lft=Lft.astype(np.float32), HAND=HAND.astype(np.float32), half=half, cls=cls)
