"""Ditwah replay, step A: build the shared grids (terrain, HAND, drainage, coverage) and the dated EMSR851 satellite flood maps,
and cache them for replay.py. Re-uses the first half of prep.py (same terrain, same drainage choice, same HAND) by running its source.
  python replay_base.py WORKDIR EMS_DOWNLOAD_DIR   (EMS_DOWNLOAD_DIR holds AOI01_GRA_PRODUCT/, AOI01_GRA_MONIT01/, AOI02_DEL_PRODUCT/,
  AOI02_DEL_MONIT01/, AOI06_GRA_PRODUCT/, AOI06_GRA_MONIT01/, AOI06_GRA_MONIT02/ unzipped from the public Copernicus EMS zips)
Writes WORKDIR/replay_cache.npz. Nothing here is committed output."""
import sys, os, json, glob
HERE = os.path.dirname(os.path.abspath(__file__))
WORKDIR, EMSDL = sys.argv[1], sys.argv[2]
sys.argv = [sys.argv[0], WORKDIR, "/nonexistent", "/tmp/_unused_out"]
src = open(os.path.join(HERE, "prep.py")).read().split("\n")
g = globals()
exec("\n".join(src[0:86]), g)            # imports, grid, terrain, drainage, rast(), fp()
os.rmdir("/tmp/_unused_out") if os.path.isdir("/tmp/_unused_out") and not os.listdir("/tmp/_unused_out") else None

def P(d, kind):
    return glob.glob(f"{EMSDL}/{d}/*_{kind}_v1.json")[0]
def ev(prod, srcs=None):
    wet = rast(P(prod, "observedEventA"))
    foot = fp(P(prod, "imageFootprintA"), P(prod, "notAnalysedA"), srcs=srcs)
    return wet, foot
# moments: (key, label, Sri Lanka local time of capture, Nagalagam stage at capture from the hourly archive, products)
E1w, E1f = ev("AOI02_DEL_PRODUCT"); a, b = ev("AOI01_GRA_PRODUCT"); E1w |= a; E1f |= b
EV = {"E1": dict(label="30 Nov 2025 11:09", nag_ft=7.4, wet=E1w, foot=E1f)}
w, f = ev("AOI02_DEL_MONIT01", srcs=[1]); EV["E3"] = dict(label="3 Dec 2025 12:36 (falling)", nag_ft=4.6, wet=w, foot=f)
w, f = ev("AOI01_GRA_MONIT01", srcs=[3]); EV["E2"] = dict(label="2 Dec 2025 10:55 (Colombo only)", nag_ft=7.2, wet=w, foot=f)
w, f = ev("AOI06_GRA_PRODUCT", srcs=[2]); EV["A4"] = dict(label="4 Dec 2025 10:44 (Angoda)", nag_ft=3.0, wet=w, foot=f)
w, f = ev("AOI06_GRA_MONIT01", srcs=[3]); EV["A5"] = dict(label="5 Dec 2025 11:02 (Angoda)", nag_ft=2.5, wet=w, foot=f)
w, f = ev("AOI06_GRA_MONIT02", srcs=[4]); EV["A6"] = dict(label="6 Dec 2025 10:33 (Angoda)", nag_ft=1.9, wet=w, foot=f)
for k, v in EV.items(): print(k, v["label"], "wet", int(v["wet"].sum()), "foot", int(v["foot"].sum()))
exec("\n".join(src[108:138]), g)         # area masks, skill(), drainage pick, HAND, COVER, LAND
np.savez_compressed(f"{WORKDIR}/replay_cache.npz", HAND=HAND, DRAIN=DRAIN, KNET=KNET, COVER=COVER, okall=okall, sea=sea, LAND=LAND,
    KELANIYA=KELANIYA, WELL=WELL, IX=IX, DIST=DIST, z=z,
    **{f"{k}_wet": v["wet"] for k, v in EV.items()}, **{f"{k}_foot": v["foot"] for k, v in EV.items()})
json.dump({k: dict(label=v["label"], nag_ft=v["nag_ft"]) for k, v in EV.items()}, open(f"{WORKDIR}/replay_events.json", "w"))
print("cached", H, W)
