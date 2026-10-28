"""Step 3 of the flood-3d prep: extend the map to the REST OF THE KELANI (Hanwella -> Kosgama -> Puwakpitiya -> Avissawella -> Ruwanwella) and to the uncovered edge cells
of the first picture (28 Oct 2026). Run with the venv python, after fetch.py, fetch_upstream.py and fit-upstream.py.
  python extend.py WORKDIR EMS_DOWNLOAD_DIR OLD_PUBLIC_DIR OUTDIR
Env: ALL_JSON (hourly gauge archive), UPSTREAM_STAGE (fit-upstream.py output), FLOOR_2016 (Irrigation Flood_Map layer 37 GeoJSON), IRR_2025 (optional: Irrigation Nov 2025
Kelani polygon, only used as a lower-bound check).

WHAT IS KEPT: every pixel the first picture had as 'covered' (the old level.webp, decoded from OLD_PUBLIC_DIR) is copied byte for byte into the new picture at the same ground
position; so the Kolonnawa pool, the 2016 floor and the settled bit are untouched. Only (a) cells outside the old box and (b) cells inside it that the old picture left
'not covered' (the Hanwella town side south of 6.915 N, the north bank beyond 7.0 N) are computed here.

HOW THE NEW CELLS ARE LEVELLED (all in ft of Nagalagam Street, the map's one scalar)
 * Cells west of 80.10 E (inside the old box, and the north / south strips beside it): old convention, level = HAND + c(zone) with the OLD per-zone offsets (accuracy.json zone_offset_m),
   clipped by the same dated satellite brackets (E1 7.4 ft, E3 4.6 ft, A4-A6), same spreading rule. No new fit: the old numbers extended to the cells they could not reach.
 * Cells east of 80.10 E (Hanwella -> Ruwanwella): level = 2.3 ft + k(zone) * HAND_main, HAND_main = height above the Kelani MAIN STEM, k (ft of Nagalagam per m of height) fitted per
   3 km reach on the two dated Copernicus EMSR851 Kelani maps (30 Nov 11:09 = 7.4 ft, 3 Dec 12:36 = 4.6 ft), shrunk to the area-wide k where a reach has little evidence. Observed wet / dry
   cells then clip the level to their bracket (as before). East of 80.2 E (no EMS evidence) and wherever the footprints do not reach the cell is 'extrapolated' (class 0, hatched).
   A gauge-keyed rating per cell (Hanwella / Glencourse -> Nagalagam-equivalent ft, fit-upstream.py) was tried first and dropped: see accuracy.json 'upstream'.gauge_keyed_attempt.
 * Then the Irrigation Department's May 2016 polygon is a floor under the new cells (floor2016.py), as in the old area, and the Kolonnawa pool taper is applied to the few new cells inside it.
"""
import sys, os, json, math, heapq, glob, numpy as np
import rasterio
from rasterio.warp import reproject, Resampling
from rasterio.transform import Affine
from pyproj import Transformer
from PIL import Image, ImageDraw
from scipy import ndimage as ndi
from scipy.stats import rankdata
from shapely.geometry import shape, mapping, LineString
from shapely.ops import transform as shp_transform
from rasterio import features as rfeat
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import floor2016

WORK, EMS, OLD, OUT = sys.argv[1:5]
os.makedirs(OUT, exist_ok=True)
FT = 0.3048; RES = 30.0; WET_FT = 2.2; ZW = 3000.0
T = Transformer.from_crs(4326, 32644, always_xy=True); Ti = Transformer.from_crs(32644, 4326, always_xy=True)
# old and new boxes (S, W, N, E). The old picture's grid origin is kept so cells line up exactly.
S0, W0, N0, E0 = 6.86, 79.84, 7.00, 80.10
S, Wl, N, E_ = 6.84, 79.84, 7.10, 80.31
DEG = 0.00028
def grid_of(s, w, n, e):
    xs, ys = zip(*[T.transform(lo, la) for lo in (w, e) for la in (s, n)])
    return math.floor(min(xs) / RES) * RES, math.ceil(max(xs) / RES) * RES, math.ceil(max(ys) / RES) * RES, math.floor(min(ys) / RES) * RES
X0, X1o, Y1o, Y0o = grid_of(S0, W0, N0, E0)
_, X1, Y1, Y0 = grid_of(S, Wl, N, E_)
W = int((X1 - X0) / RES); H = int((Y1 - Y0) / RES)
Wo = int((X1o - X0) / RES); Ho = int((Y1o - Y0o) / RES)
DR = int(round((Y1 - Y1o) / RES))            # old grid row 0 is new row DR; columns align
TR = Affine(RES, 0, X0, 0, -RES, Y1)
print("grid", H, W, "old", Ho, Wo, "row offset", DR)
def px(lon, lat):
    x, y = T.transform(lon, lat); return (x - X0) / RES, (Y1 - y) / RES

# ---- terrain (four GLO-30 tiles)
z = np.full((H, W), np.nan, np.float32)
for t in ["N06_00_E079_00", "N06_00_E080_00", "N07_00_E079_00", "N07_00_E080_00"]:
    with rasterio.open(f"{WORK}/dem_{t}.tif") as ds:
        tmp = np.full((H, W), np.nan, np.float32)
        reproject(rasterio.band(ds, 1), tmp, dst_transform=TR, dst_crs="EPSG:32644", resampling=Resampling.bilinear, dst_nodata=np.nan)
        z = np.where(np.isfinite(z), z, tmp)
sea = ~np.isfinite(z) | (z <= 0.05)
LAND = np.isfinite(z) & ~sea

# ---- drainage (same choice as the first picture: Kelani + connected canals, min-filter 3)
ww = json.load(open(f"{WORK}/osm_waterways.json"))["elements"] + json.load(open(f"{WORK}/up_osm_waterways.json"))["elements"]
seen = set(); ww2 = []
for e in ww:
    if e["id"] in seen: continue
    seen.add(e["id"]); ww2.append(e)
ww = ww2
def lines_mask(els, width):
    img = Image.new("L", (W, H), 0); dr = ImageDraw.Draw(img)
    for e in els:
        pts = [px(g["lon"], g["lat"]) for g in e.get("geometry") or []]
        if len(pts) > 1: dr.line(pts, fill=255, width=width)
    return np.array(img) > 0
kel_els = [e for e in ww if e["tags"].get("waterway") == "river" and "Kelani" in (e["tags"].get("name", "") + e["tags"].get("name:en", ""))]
kel = lines_mask(kel_els, 3)
allw = lines_mask([e for e in ww if e["tags"].get("waterway") in ("river", "canal", "drain")], 2)
_lab, _n = ndi.label(ndi.binary_dilation(allw | kel, iterations=1), structure=np.ones((3, 3)))
_ids = np.unique(_lab[kel & (_lab > 0)])
KNET = np.isin(_lab, _ids) & (allw | kel)
DRAIN = KNET
def hand(zz, drain, smooth=3):
    zm = ndi.minimum_filter(np.where(np.isfinite(zz), zz, 99), size=smooth)
    zd = np.where(drain, zm, np.nan)
    d, (iy, ix) = ndi.distance_transform_edt(~drain, return_distances=True, return_indices=True)
    return np.maximum(zz - zd[iy, ix], 0), d * RES, ix
HAND, DIST, IX = hand(z, DRAIN, 3)
# East of the old east edge (80.10 E) the Kelani-side network reaches into hill country: HAND to the nearest stream there is the height above a small hill stream, not above the
# flood water (it put 100 m high hill tops in the flood band). So the gauge-keyed part is levelled on the height above the Kelani MAIN STEM only (floods reach side valleys up to the main
# stem's own water level). West of 80.10 E everything stays as the first picture (network HAND).
HAND_NET = HAND.copy()
_MAIN_HAND, _, _ = hand(z, kel, 3)
HAND = np.where(np.arange(W)[None, :] >= Wo, _MAIN_HAND, HAND_NET)
print("Kelani-side network px", int(KNET.sum()), "kelani ways", len(kel_els))

# ---- old picture: decode, locate, coverage
oldimg = np.array(Image.open(f"{OLD}/level.webp").convert("RGB"))
oldR, oldG, oldB = oldimg[..., 0], oldimg[..., 1], oldimg[..., 2]
oldmeta = json.load(open(f"{OLD}/accuracy.json"))
HW = oldmeta["half_width_ft"]; CZ_OLD = {int(k): v for k, v in oldmeta["zone_offset_m"].items()}; CG_OLD = oldmeta["global_offset_m"]
_lat_row = Y1 - (np.arange(H) + 0.5) * RES
_lon_col = X0 + (np.arange(W) + 0.5) * RES
LON, LAT = Ti.transform(*np.meshgrid(_lon_col, _lat_row))
rc = np.load(f"{WORK}/replay_cache.npz")
COVER_OLD = np.zeros((H, W), bool); COVER_OLD[DR:DR + Ho, :Wo] = rc["COVER"]
# the old UTM grid is a little larger than the old WGS picture (rotation of the grid): cells outside the picture's own box were never in it, so they are new cells
COVER_OLD &= (LON >= W0) & (LON < E0) & (LAT >= S0) & (LAT < N0)
OLDBOX = np.zeros((H, W), bool); OLDBOX[DR:DR + Ho, :Wo] = True
# cross-check the cached old cover against the old picture's 'not covered' bit (land, non-river cells)
_unc_old = ((oldB & 32) > 0) & (oldR != 255)
_cov_old_png = ~((oldB & 32) > 0)
print("old picture: covered share", float(_cov_old_png.mean()))

# ---- new coverage: new cells only (never the old covered ones)
P16 = rfeat.rasterize([(shp_transform(lambda x, y, zz=None: T.transform(x, y), shape(f_["geometry"])), 1) for f_ in json.load(open(os.environ["FLOOR_2016"]))["features"]], out_shape=(H, W), transform=TR, fill=0, dtype="uint8").astype(bool)
dK = ndi.distance_transform_edt(~KNET) * RES
dKm = ndi.distance_transform_edt(~kel) * RES      # distance to the Kelani main stem
south_ok = (LAT >= 6.915) | (LON >= 79.985)               # Colombo south of 6.915 N (Wellawatte / Dehiwala basins) stays out; the Kelani corridor east of Kaduwela is in
north_ok = (LAT <= 7.03) | (LON >= 80.0)                  # west of 80.0 E the north bank is only added up to 7.03 N (the Kelani mouth side); upstream the valley is the corridor
# the corridor = within 3 km of the Kelani MAIN STEM (the first picture used 3 km of the whole connected network, which here would take in Beira Lake / Slave Island and the hill streams east
# of Hanwella: no calibration says anything about them), plus the arms of the Irrigation Department's 2016 polygon (within 3 km of the network) where the river's own backwater is known to have reached
COVER_NEW = ((dKm <= 3000) | ((dK <= 3000) & ndi.binary_dilation(P16, iterations=10))) & south_ok & north_ok & ~COVER_OLD & LAND & np.isfinite(HAND)
COVER_ALL = COVER_OLD | COVER_NEW
okall = np.isfinite(HAND) & ~DRAIN & ~sea & COVER_ALL
OKN = okall & ~COVER_OLD                                  # the cells this script levels
_COLS = np.broadcast_to(np.arange(W)[None, :], (H, W))
OLDCONV = OKN & (_COLS < Wo)                              # west of the old east edge (80.10 E): old convention, Nagalagam keyed (inside the old box, and the north / south strips beside it)
NEWCONV = OKN & (_COLS >= Wo)                             # east of it: gauge-keyed convention
print("new covered cells", int(OKN.sum()), "west of 80.10 (old method)", int(OLDCONV.sum()), "east of 80.10 (new method)", int(NEWCONV.sum()))

# ---- gauges at the satellite times (hourly archive, Sri Lanka time)
import datetime, bisect
ALLJ = json.load(open(os.environ["ALL_JSON"]))
def gseries(name):
    r = sorted((x["time_ut"], x["water_level_m"]) for x in ALLJ if x["station_name"].startswith(name) and x["water_level_m"] is not None)
    return [a for a, b in r], [b for a, b in r]
GS = {n: gseries(n) for n in ("Hanwella", "Glencourse")}
def gauge_at(name, y, mo, d, h, mi):
    t = datetime.datetime(y, mo, d, h, mi, tzinfo=datetime.timezone(datetime.timedelta(hours=5.5))).timestamp()
    return float(np.interp(t, *GS[name]))
ST = json.load(open(os.environ["UPSTREAM_STAGE"]))
def u_of(tab):
    xs = [a for a, b in tab]; ys = [b for a, b in tab]
    top_slope = 0.5 if tab is ST["hanwella"]["table"] else 0.3
    def f(g):
        g = np.asarray(g, float)
        r = np.interp(g, xs, ys)
        return np.where(g > xs[-1], ys[-1] + top_slope * (g - xs[-1]), r)
    def finv(s):
        s = np.asarray(s, float)
        return np.interp(s, ys, xs)
    return f, finv
uH, uH_inv = u_of(ST["hanwella"]["table"]); uG, uG_inv = u_of(ST["glencourse"]["table"])
BASE = {"H": ST["hanwella"]["base_m"], "G": ST["glencourse"]["base_m"]}
SPLIT_LON = ST["split_lon"]

# ---- EMS evidence (full extents, not clipped to the old box)
def P(d, kind): return glob.glob(f"{EMS}/{d}/*_{kind}_v1.json")[0]
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
def ev(prod, srcs=None):
    return rast(P(prod, "observedEventA")), fp(P(prod, "imageFootprintA"), P(prod, "notAnalysedA"), srcs=srcs)
EV = {}
w, f = ev("AOI02_DEL_PRODUCT"); a, b = ev("AOI01_GRA_PRODUCT"); EV["E1"] = dict(wet=w | a, foot=f | b, nag=7.4, when=(2025, 11, 30, 11, 9))
w, f = ev("AOI02_DEL_MONIT01", srcs=[1]); EV["E3"] = dict(wet=w, foot=f, nag=4.6, when=(2025, 12, 3, 12, 36))
w, f = ev("AOI06_GRA_PRODUCT", srcs=[2]); EV["A4"] = dict(wet=w, foot=f, nag=3.0, when=None)
w, f = ev("AOI06_GRA_MONIT01", srcs=[3]); EV["A5"] = dict(wet=w, foot=f, nag=2.5, when=None)
w, f = ev("AOI06_GRA_MONIT02", srcs=[4]); EV["A6"] = dict(wet=w, foot=f, nag=2.4, when=None)
for k, v in EV.items(): print(k, "wet", int(v["wet"].sum()), "foot", int(v["foot"].sum()), "foot cells in new area", int((v["foot"] & OKN).sum()))
for k in ("E1", "E3"):
    y, mo, d, h, mi = EV[k]["when"]
    EV[k]["gauge"] = {"H": gauge_at("Hanwella", y, mo, d, h, mi), "G": gauge_at("Glencourse", y, mo, d, h, mi)}
    print(k, "gauges at capture: Hanwella %.2f m, Glencourse %.2f m" % (EV[k]["gauge"]["H"], EV[k]["gauge"]["G"]), "-> Nag-eq ft H %.2f G %.2f" % (float(uH(EV[k]["gauge"]["H"])), float(uG(EV[k]["gauge"]["G"]))))

# ---- zones (3 km reaches by the x of the nearest channel cell, same definition as the first picture) and their gauge
ZONE = (((X0 + IX * RES) - X0 // 1 - X0 + 0) // ZW).astype(int)
# zone centre: nearest-channel column index c satisfies zid = floor((c*RES - floor(X0)) / ZW)  ->  c in [(zid*ZW + floor(X0))/RES, +ZW/RES)
def zone_lon(zid):
    c = (zid * ZW + math.floor(X0) + ZW / 2) / RES
    return Ti.transform(X0 + c * RES, Y1 - (H * 0.5) * RES)[0]
ZIDS_NEW = np.unique(ZONE[NEWCONV])
GOF = {int(zid): ("H" if zone_lon(zid) < SPLIT_LON else "G") for zid in np.unique(ZONE[okall | NEWCONV])}
print("new-convention zones", [(int(z_), GOF[int(z_)], round(zone_lon(z_), 3)) for z_ in ZIDS_NEW])

# ---- fit per zone (east of 80.10 E): the SAME method as the first picture. A cell floods when Nagalagam >= HAND + c(zone); c per 3 km reach on the two dated Copernicus maps,
# with the Nagalagam stage AT the satellite time (7.4 ft on 30 Nov, 4.6 ft on 3 Dec), shrunk to the area-wide c where a reach has little evidence (w = min(1, wet cells / 150)).
# Why not a gauge-keyed rating per cell (tried first, see the note in accuracy.json 'upstream'): both dated maps are not in equilibrium with the upstream gauges (30 Nov is 2 days after the
# Glencourse crest, 3 Dec is a falling limb with water still lying on the plain), and Nagalagam does not respond to Glencourse below ~16 m (fit-upstream.py), so a gauge -> Nagalagam-equivalent
# relation cannot resolve the middle of the range; it also put 4.6% of the new plain 'usually wet' (false floods at normal river levels). The time-aligned Nagalagam keeps one convention across the seam.
def skill(pred, obs, ok):
    p = pred & ok; o = obs & ok; tp = (p & o).sum(); fp_ = (p & ~o).sum(); fn = (~p & o).sum()
    return dict(csi=float(tp / max(1, tp + fp_ + fn)), hit=float(tp / max(1, tp + fn)), far=float(fp_ / max(1, tp + fp_)), n_wet=int(o.sum()), n_pred=int(p.sum()))
# Level of a cell = L0 + k(zone) * HAND (ft; HAND in m): the river's own banks flood at L0 (just above the 'usually wet' 2.2 ft) and k (ft of Nagalagam per m of height above the channel) is fitted
# per reach. The first picture's slope-1 form (HAND + c, 3.28 ft per m) saturates at its lower limit upstream (c = -6 m at the grid edge): the plain floods to 8 m of HAND at the 30 Nov crest
# while Nagalagam only rose ~1.5 m, so a slope-1 fit puts 8% of the valley bottoms at 'usually wet' (never painted). Pinning the intercept at the bank keeps normal levels dry.
L0 = 2.3
KGRID = np.arange(0.2, 6.001, 0.05)
def score(sel, events):
    tp = np.zeros(len(KGRID)); fpp = np.zeros(len(KGRID)); fnn = np.zeros(len(KGRID))
    for e in events:
        ok = sel & EV[e]["foot"] & NEWCONV
        if not ok.any(): continue
        h = HAND[ok]; wv = EV[e]["wet"][ok]; st = EV[e]["nag"]
        for i, k in enumerate(KGRID):
            pr = (L0 + k * h) <= st
            tp[i] += (pr & wv).sum(); fpp[i] += (pr & ~wv).sum(); fnn[i] += (~pr & wv).sum()
    csi = tp / np.maximum(1, tp + fpp + fnn); ratio = (tp + fpp) / np.maximum(1, tp + fnn)
    return np.where(ratio <= 1.25, csi, -1 + 0 * csi), int((tp + fnn)[0])        # never buy CSI by over-predicting
def fit_new(events):
    csi, n = score(NEWCONV, events); kg = float(KGRID[int(np.argmax(csi))])
    kz = {}
    for zid in ZIDS_NEW:
        csi, kk = score(ZONE == zid, events); w = min(1.0, kk / 150.0)
        kz[int(zid)] = (w * float(KGRID[int(np.argmax(csi))]) + (1 - w) * kg, kk, w)
    return kz, kg
GK = {"H": np.isin(ZONE, [zid for zid, g in GOF.items() if g == "H"]), "G": np.isin(ZONE, [zid for zid, g in GOF.items() if g == "G"])}
CZ, CG = fit_new(["E1", "E3"])
print("area-wide k (ft per m of HAND)", round(CG, 2)); [print("zone", zid, GOF[zid], "lon %.3f" % zone_lon(zid), "k %.2f" % v[0], "wet cells", v[1], "w %.2f" % v[2]) for zid, v in sorted(CZ.items())]
def level_new_ft(cz):
    L = np.full((H, W), np.inf)
    kk = np.vectorize(lambda zid: cz[int(zid)][0] if int(zid) in cz else CG)(ZONE[NEWCONV]) if NEWCONV.any() else np.array([])
    L[NEWCONV] = L0 + kk * HAND[NEWCONV]
    return L
Lm_new = level_new_ft(CZ)
# leave-one-event-out per reach (fit on one dated map, test on the other); Hanwella reach = zones west of the Hanwella/Glencourse split, Glencourse reach = east of it
LOEO = []
for tr, te in (("E1", "E3"), ("E3", "E1")):
    cz, _cg = fit_new([tr]); Lt = level_new_ft(cz)
    for name, gk in (("Hanwella to Kosgama", "H"), ("Puwakpitiya to Ruwanwella", "G")):
        ok = EV[te]["foot"] & NEWCONV & GK[gk]
        if ok.sum() == 0: continue
        LOEO.append(dict(fit_on=tr, test_on=te, area=name, **{k: (round(v, 3) if isinstance(v, float) else v) for k, v in skill(Lt <= EV[te]["nag"], EV[te]["wet"], ok).items()},
                         plain_HAND_best=round(max(skill(HAND <= t, EV[te]["wet"], ok)["csi"] for t in np.arange(0.25, 8, 0.25)), 3)))
for r in LOEO: print(r)
# ---- brackets from the dated maps, then the same clip + spread as prep.py
def stage_of(e, gk_array=None):
    return np.where(OLDCONV | NEWCONV, EV[e]["nag"], np.nan)
hi_b = np.full((H, W), np.inf); lo_b = np.full((H, W), -np.inf)
for k in EV:
    s = stage_of(k)
    sv = np.where(np.isfinite(s), s, np.nan)
    wetm = EV[k]["foot"] & EV[k]["wet"] & np.isfinite(sv); drym = EV[k]["foot"] & ~EV[k]["wet"] & np.isfinite(sv)
    hi_b = np.where(wetm, np.minimum(hi_b, sv), hi_b); lo_b = np.where(drym, np.maximum(lo_b, sv), lo_b)
# old-convention level: HAND + old zone offset (cells never fitted use the old global offset), in ft
Lm_old = np.full((H, W), np.inf)
cmap = np.vectorize(lambda zid: CZ_OLD.get(int(zid), CG_OLD))(ZONE[OLDCONV]) if OLDCONV.any() else np.array([])
Lm_old[OLDCONV] = (HAND[OLDCONV] + cmap) / FT
Lft = np.where(OLDCONV, Lm_old, np.where(NEWCONV, Lm_new, np.inf))
Lft = np.where(NEWCONV & (Lft > 12.0), np.inf, Lft)      # above the page's 10 ft slider: no level (R = 0), keeps hill tops out of the grid
Lm_ft0 = Lft.copy()
Lft = np.minimum(np.maximum(Lft, lo_b + 0.02), np.where(hi_b < np.inf, np.maximum(hi_b, lo_b + 0.03), np.inf))
Lft = np.where(OKN, Lft, np.inf)
# spread, do not stack (prep.py): cells moved to the edge of their bracket keep the order of their HAND inside it
_fin = np.isfinite
_top = OKN & _fin(hi_b) & (Lm_ft0 > hi_b + 1e-6); _bot = OKN & _fin(lo_b) & (Lm_ft0 < lo_b - 1e-6) & ~_top
_new = Lft.copy()
for sel, up in ((_top, False), (_bot, True)):
    pairs = {}
    for r_, c_ in zip(*np.nonzero(sel)): pairs.setdefault((round(float(lo_b[r_, c_]), 3) if _fin(lo_b[r_, c_]) else None, round(float(hi_b[r_, c_]), 3) if _fin(hi_b[r_, c_]) else None), []).append((r_, c_))
    for (lo_, hi_), cells in pairs.items():
        rr = np.array([c[0] for c in cells]); cc = np.array([c[1] for c in cells]); rk = rankdata(HAND[rr, cc], method="average") / len(cells)
        if not up:
            lo_e = lo_ + 0.02 if lo_ is not None else max(2.4, hi_ - 3.4); _new[rr, cc] = hi_ - (hi_ - lo_e) * (1 - rk)
        else:
            hi_e = hi_ if hi_ is not None else lo_ + 3.0; _new[rr, cc] = lo_ + 0.02 + (hi_e - lo_ - 0.02) * rk
Lft = _new
# classes: 2 observed-bounded, 1 interpolated (between the lowest observed stage and the crest), 0 extrapolated; no EMS evidence near the cell -> 0 (estimate)
cls = np.zeros((H, W), np.uint8)
LO_OLD = 4.6
inr = np.where(OLDCONV, (Lft >= LO_OLD - 0.01) & (Lft <= 8.5), (Lft >= 2.3) & (Lft <= 8.5))
cls[inr] = 1
bracketed = _fin(hi_b) | _fin(lo_b)
cls[bracketed] = 2
# cells of the gauge-keyed convention in zones with almost no wet evidence stay estimates unless an observation bracket reaches them
weak = np.zeros((H, W), bool)
for zid, v_ in CZ.items(): weak |= NEWCONV & (ZONE == zid) & (v_[2] < 0.3)
cls = np.where(weak & ~bracketed, 0, cls)
cls = np.where(OKN, cls, 0).astype(np.uint8)

# ---- Irrigation Dept May 2016 extent as a FLOOR under the new cells (floor2016.py), stage 7.64 ft Nagalagam-equivalent
zf = np.where(np.isfinite(z), z, 99.0).astype(float)
F = np.full(zf.shape, np.inf); hp = []
for r_, c_ in zip(*np.where(KNET)):
    F[r_, c_] = zf[r_, c_]; heapq.heappush(hp, (F[r_, c_], r_, c_))
while hp:
    f_, r_, c_ = heapq.heappop(hp)
    if f_ > F[r_, c_]: continue
    for dr_ in (-1, 0, 1):
        for dc_ in (-1, 0, 1):
            rr_, cc_ = r_ + dr_, c_ + dc_
            if (dr_ or dc_) and 0 <= rr_ < H and 0 <= cc_ < W:
                nf = max(f_, zf[rr_, cc_])
                if nf < F[rr_, cc_]: F[rr_, cc_] = nf; heapq.heappush(hp, (nf, rr_, cc_))
# the Kolonnawa pool taper (prep.py): new cells that lie within its 2.5 km fade (uncovered edge cells beside the pool box) get the same pool level as their covered neighbours
POOL_ZONE = (79.885, 79.925, 6.915, 6.955); POOL_FADE_M = 2500.0
_dx = np.maximum.reduce([POOL_ZONE[0] - LON, LON - POOL_ZONE[1], np.zeros_like(LON)]) * 111320.0 * np.cos(np.radians(LAT)); _dy = np.maximum.reduce([POOL_ZONE[2] - LAT, LAT - POOL_ZONE[3], np.zeros_like(LAT)]) * 110574.0
TAPER = np.clip(1.0 - np.hypot(_dx, _dy) / POOL_FADE_M, 0.0, 1.0)
def pool_s(wm): return np.where(wm <= 0.81 * 7.4, wm / 0.81, 7.4 + (wm - 0.81 * 7.4) / 0.25)
PZ = OKN & (TAPER > 0.05) & LAND & ~DRAIN & np.isfinite(F)
_Lp = np.where(PZ, pool_s(F / np.maximum(TAPER, 0.05)), np.inf)
_take = PZ & (_Lp < np.where(np.isfinite(Lft), Lft, 99.0))
print("new cells inside the pool taper:", int(PZ.sum()), "lowered by the pool:", int(_take.sum()))
Lft = np.where(_take, _Lp, Lft); cls = np.where(_take, 1, cls)
Lbefore = Lft.copy(); clsb = cls.copy()
# the reach slope outside the polygon: water-surface rise (m) per ft of Nagalagam-equivalent stage. Hanwella: 1 m of gauge ~ 0.9 ft of u between 7 and 11 m; Glencourse: ~1.0 ft per m above 17 m. 0.8 m/ft is used for both (the first picture's 0.25 m/ft is the Kolonnawa pool plateau).
Lft, cls, FL = floor2016.apply(Lft, cls, P16, OKN, DRAIN, HAND, F, z, slope=0.8, reach_max=9.0)
FLOOR_MOVED = np.isfinite(Lft) & ~(np.isfinite(Lbefore) & (Lbefore == Lft))
print("floor 2016 on new cells:", int(FL["floored"]), "lowered inside polygon,", int(FL["reach"].sum()), "reach outside")

# ---- picture
valid = OKN & np.isfinite(Lft)
BAND = np.select([HAND <= 1, HAND <= 2, HAND <= 3, HAND <= 5], [0, 1, 2, 3], 4)
R = np.where(valid & (Lft < 25), np.clip(np.round((Lft - 2) * 10) + 1, 1, 250), 0)
R = np.where(DRAIN | sea, 255, R)
LW, LS, LE = Wl, S, E_
k_n = int(math.ceil((N - N0) / DEG)); k_s = int(math.ceil((S0 - S) / DEG)); k_e = int(math.ceil((E_ - E0) / DEG))
LN = N0 + k_n * DEG; LS = S0 - k_s * DEG; LE = E0 + k_e * DEG
gw = int(round((LE - LW) / DEG)); gh = int(round((LN - LS) / DEG))
GTR = Affine(DEG, 0, LW, 0, -DEG, LN)
def to_wgs(a, fill, dtype=np.float32):
    out = np.full((gh, gw), fill, dtype)
    reproject(a.astype(dtype), out, src_transform=TR, src_crs="EPSG:32644", dst_transform=GTR, dst_crs="EPSG:4326", resampling=Resampling.nearest, dst_nodata=fill)
    return out
# settled bit from local streets (old + new roads)
rd = json.load(open(f"{WORK}/osm_roads.json"))["elements"]
rd_up = []
for _k in ("roads_main", "roads_local"):
    _p = f"{WORK}/up_osm_{_k}.json"
    if os.path.exists(_p):
        _d = json.load(open(_p)); rd_up += _d["elements"]; print(_k, len(_d["elements"]), "ways; tiles missing:", len(_d.get("missing_tiles", [])))
    else: print("WARNING: no", _p, "(test run)")
seen = set(); rdall = []
for w_ in rd + rd_up:
    if w_["id"] in seen: continue
    seen.add(w_["id"]); rdall.append(w_)
_bm = Image.new("L", (W, H), 0); _bd = ImageDraw.Draw(_bm)
for e in rdall:
    if e["tags"].get("highway") in ("motorway", "trunk", "primary", "secondary") or len(e.get("geometry") or []) < 2: continue
    _bd.line([px(g_["lon"], g_["lat"]) for g_ in e["geometry"]], fill=255, width=1)
BUILT = (ndi.uniform_filter((np.array(_bm) > 0).astype(float), 5) >= 0.03) & ~FLOOR_MOVED
UNC = LAND & ~COVER_ALL & ~DRAIN
WETL = (valid & (Lft <= WET_FT)) & ~DRAIN
half = np.select([cls == 2, cls == 1], [HW["observed"], HW["interpolated"]], HW["extrapolated"]).astype(np.float32)
Rw = to_wgs(R, 0); Gw = to_wgs(np.clip(np.round(half * 10), 0, 250), 0); # the HAND band of a cell outside the calibrated area is never read (grey, no estimate): zero it so the new picture compresses (hill noise); covered and old pixels keep theirs
BUILT_USED = BUILT & valid & (Lft < 25)                    # the settled bit only matters where a level exists (depth note); elsewhere it is hill / street noise
Bw = to_wgs(cls + 4 * (BAND * ~UNC) + 32 * UNC + 64 * WETL + 128 * BUILT_USED, 0)
newimg = np.stack([Rw, Gw, Bw], -1).astype(np.uint8)
# paste the old picture: it keeps every pixel that was covered (or river) in the first picture
oy = int(round((LN - N0) / DEG)); ox = int(round((W0 - LW) / DEG))
assert oy == k_n and ox == 0
old_keep = np.zeros((gh, gw), bool)
oldcov = (~((oldB & 32) > 0)) | (oldR == 255)
old_keep[oy:oy + oldimg.shape[0], ox:ox + oldimg.shape[1]] = oldcov
final = np.where(old_keep[..., None], 0, newimg)
final[oy:oy + oldimg.shape[0], ox:ox + oldimg.shape[1]][oldcov] = oldimg[oldcov]
# old cells that were uncovered and stay uncovered (no new level): keep their old pixel (bytes) too
_oldsl = final[oy:oy + oldimg.shape[0], ox:ox + oldimg.shape[1]]
_still = (~oldcov) & ((newimg[oy:oy + oldimg.shape[0], ox:ox + oldimg.shape[1], 2] & 32) > 0) & (newimg[oy:oy + oldimg.shape[0], ox:ox + oldimg.shape[1], 0] != 255)
_oldsl[_still] = oldimg[_still]
img = final.astype(np.uint8)
Image.fromarray(img).save(f"{OUT}/level.webp", "WEBP", lossless=True, quality=100, method=6)
print("level.webp", img.shape, os.path.getsize(f"{OUT}/level.webp"))
# the old covered pixels are identical
assert (img[oy:oy + oldimg.shape[0], ox:ox + oldimg.shape[1]][oldcov] == oldimg[oldcov]).all()

# ---- statistics and checks
def ftmap(im): return np.where((im[..., 0] > 0) & (im[..., 0] < 255), (im[..., 0].astype(float) - 1) / 10 + 2, np.inf)
Lpng = ftmap(img); unc_new = (img[..., 2] & 32) > 0
newcells_png = np.zeros((gh, gw), bool); newcells_png[:] = True
newcells_png[oy:oy + oldimg.shape[0], ox:ox + oldimg.shape[1]][oldcov] = False
isnew = newcells_png & ~unc_new & (img[..., 0] != 255)
usual = (img[..., 2] & 64) > 0
print("new covered pixels (not river)", int(isnew.sum()), "| usually-wet among them", int((isnew & usual).sum()))
_cl = img[..., 2] & 3
CLS_SHARE = {nm_: {c_: round(float(((_cl == v_) & mk & (img[..., 0] > 0)).sum() / max(1, (mk & (img[..., 0] > 0)).sum())), 3) for c_, v_ in (("extrapolated", 0), ("interpolated", 1), ("observed_bounded", 2))}
             for nm_, mk in (("east_of_80.10", isnew & (np.broadcast_to(np.arange(gw)[None, :], (gh, gw)) >= oldimg.shape[1])), ("west_strips_and_edge", isnew & (np.broadcast_to(np.arange(gw)[None, :], (gh, gw)) < oldimg.shape[1])))}
print("class shares of new cells with a level", CLS_SHARE)
low = {}
_xcol = np.broadcast_to(np.arange(gw)[None, :], (gh, gw))
for s_ in (2.2, 2.5, 3.0, 4.0, 5.0, 6.0, 7.0, 7.64, 8.43, 9.0, 10.0):
    row = {}
    for nm_, mk in (("east_of_80.10", isnew & (_xcol >= oldimg.shape[1])), ("west_strips_and_edge", isnew & (_xcol < oldimg.shape[1]))):
        row[nm_] = round(float((mk & (Lpng <= s_) & ~usual).sum()) * (DEG * 111.32 * math.cos(math.radians(6.95))) * (DEG * 110.57), 2)     # painted km2: the page never paints the usually-wet bit
    low[str(s_)] = row
print("new-area painted km2 by Nagalagam stage (ft)", low)
cellkm2 = (DEG * 111.32 * math.cos(math.radians(6.95))) * (DEG * 110.57)
rec = {}
for k in ("E1", "E3"):
    for nm, gk in (("Hanwella to Kosgama", "H"), ("Puwakpitiya to Ruwanwella", "G"), ("old-box newly covered", None)):
        selz = (GK[gk] if gk else OLDCONV) & (NEWCONV if gk else OLDCONV)
        ok = EV[k]["foot"] & selz & valid
        if not ok.any(): continue
        s = stage_of(k)
        pred = np.where(np.isfinite(s), Lft <= s, False)
        rec[f"{k} {nm}"] = {a: (round(b, 3) if isinstance(b, float) else b) for a, b in skill(pred, EV[k]["wet"], ok).items()}
print("in-sample vs the dated maps (bounds clip, so near-perfect by construction):", rec)

# lower-bound checks on maps NOT used for the fit
chk = {}
if os.environ.get("IRR_2025") and os.path.exists(os.environ["IRR_2025"]):
    I25 = rfeat.rasterize([(shp_transform(lambda x, y, zz=None: T.transform(x, y), shape(f_["geometry"])), 1) for f_ in json.load(open(os.environ["IRR_2025"]))["features"]], out_shape=(H, W), transform=TR, fill=0, dtype="uint8").astype(bool) & ~DRAIN
    for nm, sel in (("Hanwella to Kosgama", NEWCONV & GK["H"]), ("Puwakpitiya to Ruwanwella", NEWCONV & GK["G"])):
        a = I25 & sel & np.isfinite(Lft)
        chk[f"Irrigation Nov 2025 raw polygon, {nm}: share predicted wet at the crest 8.43 ft"] = dict(n=int(a.sum()), share=round(float((Lft[a] <= 8.43).mean()), 3) if a.any() else None)
    chk["Irrigation Nov 2025 raw polygon vs predicted at 8.43 ft, new area"] = None
# AOI08 (Pleiades 5 Dec 'flood trace', Pugoda/Hanwella/Kosgama), AOI07 not used by the fit: share of its traces predicted wet at the crest
for nm in ("AOI08_GRA_PRODUCT",):
    try:
        w_ = rast(P(nm, "observedEventA")); f_ = fp(P(nm, "imageFootprintA"), P(nm, "notAnalysedA"))
        a = w_ & NEWCONV & np.isfinite(Lft) & ~DRAIN
        okp = f_ & NEWCONV
        chk[f"{nm} flood trace cells in new area"] = dict(n=int(a.sum()), share_wet_at_crest=round(float((Lft[a] <= 8.43).mean()), 3) if a.any() else None, share_wet_at_7_64=round(float((Lft[a] <= 7.64).mean()), 3) if a.any() else None)
    except Exception as ex:
        print("aoi08 check failed", ex)
print(json.dumps(chk, indent=1))
# 2016 polygon: share of its new-area covered cells flooded at 7.64 ft
pp = P16 & NEWCONV & ~DRAIN
chk["2016 polygon, new area: share of covered cells flooded at 7.64 ft"] = round(float((Lft[pp] <= 7.64).mean()), 3)
chk["2016 polygon, new area, covered cells"] = int(pp.sum())

# ---- roads: only runs inside newly covered cells (the first picture's road files keep every feature they had)
CLASS = {"motorway": 0, "motorway_link": 0, "trunk": 0, "trunk_link": 0, "primary": 1, "primary_link": 1, "secondary": 2, "secondary_link": 2, "tertiary": 3, "tertiary_link": 3, "unclassified": 4, "residential": 4}
BINS = [3, 4, 5, 6, 7, 8, 9, 10, 12]
def lbin(l):
    for i, t in enumerate(BINS):
        if l <= t: return i
    return len(BINS)
def cell(x, y):
    c = int((x - X0) // RES); r = int((Y1 - y) // RES)
    return (r, c) if 0 <= r < H and 0 <= c < W else None
main, local = [], []
for w_ in rdall:
    tg = w_["tags"]; geom = w_.get("geometry") or []
    if len(geom) < 2: continue
    pts = [T.transform(g["lon"], g["lat"]) for g in geom if g]
    if len(pts) < 2: continue
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
    if not any(v < 98 for v in ls): continue
    if len(ls) > 4: ls = [float(np.median(ls[max(0, i - 2):i + 3])) for i in range(len(ls))]
    br = 1 if tg.get("bridge") not in (None, "no") or tg.get("tunnel") not in (None, "no") else 0
    runs = []; cur = [0]; cb = lbin(ls[0])
    for i in range(1, len(dense)):
        b_ = lbin(ls[i])
        if b_ == cb: cur.append(i)
        else:
            cur.append(i); runs.append((cb, cur)); cur = [i]; cb = b_
    runs.append((cb, cur))
    for b_, idx in runs:
        if b_ > 8 or len(idx) < 2 or (CLASS[tg['highway']] == 4 and b_ > 6): continue
        lm = float(np.median([ls[i] for i in idx])); hm = min(hs[i] for i in idx)
        if lm <= WET_FT or lm > 90: continue
        band = 0 if hm <= 1 else 1 if hm <= 2 else 2 if hm <= 3 else 3
        ln = LineString([dense[i] for i in idx]).simplify(5.0)      # 5 m tolerance: the 25 m resampling above is for the cell lookup, not for drawing
        coords = [[round(v, 5) for v in Ti.transform(*pt)] for pt in ln.coords]
        f = {"type": "Feature", "properties": {"n": tg.get("name") or tg.get("ref") or "", "c": CLASS[tg["highway"]], "l": round(float(lm), 1), "b": band, **({"br": 1} if br else {})}, "geometry": {"type": "LineString", "coordinates": coords}}
        (main if CLASS[tg["highway"]] <= 3 else local).append(f)
for nm, fs in (("roads-main", main), ("roads-local", local)):
    old_f = json.load(open(f"{OLD}/{nm}.json"))["features"]                 # the first picture's features are kept as they were; the new runs are appended
    json.dump({"type": "FeatureCollection", "features": old_f + fs}, open(f"{OUT}/{nm}.json", "w"), separators=(",", ":"))
    print(nm, "old", len(old_f), "+ new", len(fs), os.path.getsize(f"{OUT}/{nm}.json"))

# ---- EMS observed polygons for the 'real past flood' toggle: add the part outside the first box
def rcoords(o):
    return [rcoords(c) for c in o] if isinstance(o, (list, tuple)) and o and isinstance(o[0], (list, tuple)) else [round(o[0], 5), round(o[1], 5)]
past = json.load(open(f"{OLD}/ems-2025.json"))["features"]
for evk, nm in (("E1", "EMS 30 Nov 2025"), ("E3", "EMS 3 Dec 2025")):
    m = ndi.binary_opening(EV[evk]["wet"] & ~DRAIN & ~OLDBOX)
    for g, v in rfeat.shapes(m.astype(np.uint8), mask=m, transform=TR):
        s = shape(g).simplify(30)
        if s.area < 4 * RES * RES: continue
        p = shp_transform(lambda x, y, zz=None: Ti.transform(x, y), s)
        past.append({"type": "Feature", "properties": {"event": nm, "nag_ft": EV[evk]["nag"]}, "geometry": {"type": p.geom_type, "coordinates": rcoords(mapping(p)["coordinates"])}})
json.dump({"type": "FeatureCollection", "features": past}, open(f"{OUT}/ems-2025.json", "w"), separators=(",", ":"))
print("ems-2025", os.path.getsize(f"{OUT}/ems-2025.json"))

# ---- gazetteer: places and named roads in the new box that are outside the old one
gz = json.load(open(f"{OLD}/gazetteer.json"))["p"]
def inbox(lat, lon): return S <= lat <= N and Wl <= lon <= E_
def inold(lat, lon): return S0 <= lat <= N0 and W0 <= lon <= E0
have = {(r[0].lower(), round(r[1], 2), round(r[2], 2)) for r in gz}
add = []
for e in (json.load(open(f"{WORK}/up_osm_places.json"))["elements"] if os.path.exists(f"{WORK}/up_osm_places.json") else []):
    t = e.get("tags", {}); nm = t.get("name:en") or t.get("name"); c = e.get("center") or e
    if not nm or "lat" not in c or not inbox(c["lat"], c["lon"]) or inold(c["lat"], c["lon"]): continue
    key = (nm.lower(), round(c["lat"], 2), round(c["lon"], 2))
    if key in have: continue
    have.add(key)
    add.append([nm, round(c["lat"], 4), round(c["lon"], 4), 0 if t.get("place") else 1, t.get("name:si", ""), t.get("name:ta", "")])
best = {}
for w_ in rd_up:
    tg = w_.get("tags", {}); nm = tg.get("name:en") or tg.get("name")
    if not nm or not w_.get("geometry"): continue
    g_ = [g for g in w_["geometry"] if g]; mid = g_[len(g_) // 2]
    if not inbox(mid["lat"], mid["lon"]) or inold(mid["lat"], mid["lon"]): continue
    prev = best.get(nm.lower())
    if not prev or len(g_) > prev[0]: best[nm.lower()] = (len(g_), [nm, round(mid["lat"], 4), round(mid["lon"], 4), 2, tg.get("name:si", ""), tg.get("name:ta", "")])
for v in best.values():
    if (v[1][0].lower(), round(v[1][1], 2), round(v[1][2], 2)) not in have: add.append(v[1])
add = [[*r[:4], *([r[4]] if r[4] or r[5] else []), *([r[5]] if r[5] else [])] if (r[4] or r[5]) else r[:4] for r in add]
json.dump({"p": gz + add}, open(f"{OUT}/gazetteer.json", "w"), ensure_ascii=False, separators=(",", ":"))
print("gazetteer +", len(add), os.path.getsize(f"{OUT}/gazetteer.json"))

# ---- metadata
meta = json.load(open(f"{OLD}/accuracy.json"))
rows_, cols_ = np.where(COVER_ALL)
_w_, _n_ = Ti.transform(X0 + cols_.min() * RES, Y1 - rows_.min() * RES); _e_, _s_ = Ti.transform(X0 + (cols_.max() + 1) * RES, Y1 - (rows_.max() + 1) * RES)
meta["cover_bounds"] = [round(_w_ - 0.03, 3), round(_s_ - 0.03, 3), round(_e_ + 0.03, 3), round(_n_ + 0.03, 3)]
meta["png"].update(w=gw, h=gh, west=LW, east=round(LE, 5), south=round(LS, 5), north=round(LN, 5), deg=DEG)
meta["png"]["level"] += "; upstream/edge cells added 28 Oct 2026 (see 'upstream')"
meta["upstream"] = dict(
    generated="2026-10-28",
    note="Rest of the Kelani (Hanwella to Ruwanwella) and the edge cells the first picture left uncovered. The first picture's covered pixels are unchanged, byte for byte. West of 80.10 E the new cells use the first picture's own method and zone offsets; east of it level = 2.3 ft + k * height above the Kelani main stem, k fitted per 3 km reach on the two dated Copernicus maps (Nagalagam at the satellite time), clipped to the observed wet / dry brackets, with the Irrigation Department's May 2016 extent as a floor. Cells with no EMS evidence near them are 'extrapolated' (class 0, hatched). Weaker calibration than the lower Kelani: two dated maps only, east of 80.2 E none.",
    old_box=dict(south=S0, west=W0, north=N0, east=E0), split_lon=SPLIT_LON,
    gauges_at_satellite_time={k: {g: round(v, 2) for g, v in EV[k]["gauge"].items()} for k in ("E1", "E3")},
    stage_relations=dict(hanwella=ST["hanwella"], glencourse=dict(lag_hours=ST["glencourse"]["lag_hours"], base_m=ST["glencourse"]["base_m"], table=ST["glencourse"]["table"])),
    zone_k_ft_per_m_new={str(k): dict(reach=GOF[k], lon=round(zone_lon(k), 3), k=round(v[0], 2), wet_cells=v[1], weight=round(v[2], 2)) for k, v in sorted(CZ.items())}, area_wide_k_ft_per_m=round(CG, 2), level_form="L = 2.3 ft + k * HAND(m), k per 3 km reach",
    gauge_keyed_attempt="Tried and dropped: a per-cell gauge rating (Hanwella / Glencourse reading at the satellite time -> Nagalagam-equivalent ft by stage_relations). The 3 Dec map is a falling limb with water lying on the plain and the 30 Nov map is 2 days after the Glencourse crest, so the extent-vs-gauge fit is not in equilibrium; Nagalagam does not respond to Glencourse below about 16 m (flat relation), and 4.6% of the new plain came out 'usually wet'. The map keeps the first picture's convention: Nagalagam at the satellite time. Relations kept for the lead times only.",
    loeo=LOEO, insample_note="in-sample scores reproduce the two dated maps by construction (bounds clip)", insample=rec, checks=chk,
    new_area_painted_km2_by_stage_ft=low, class_shares_new_cells_with_level=CLS_SHARE, new_cells=int(OKN.sum()), floor_2016=dict(lowered=int(FL["floored"]), reach=int(FL["reach"].sum())),
    corridor_cells=dict(west_of_80_10_old_method=int(OLDCONV.sum()), east_of_80_10_new_method=int(NEWCONV.sum())))
json.dump(meta, open(f"{OUT}/accuracy.json", "w"), indent=1)
np.savez_compressed(f"{WORK}/ext_arrays.npz", Lft=np.where(np.isfinite(Lft), Lft, 99).astype(np.float32), HAND=HAND.astype(np.float32), OKN=OKN, OLDCONV=OLDCONV, NEWCONV=NEWCONV, cls=cls, GKH=GK["H"], GKG=GK["G"])
print("done; bounds", meta["png"], "cover", meta["cover_bounds"])
