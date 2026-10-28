"""Step 1b of the flood-3d prep (upstream extension, 28 Oct 2026): the extra raw inputs for the Kelani between Hanwella and Ruwanwella and the mouth edge.
  python fetch_upstream.py WORKDIR
Adds the GLO-30 tile north of 7 N and OSM waterways / roads / places for the three strips that the first fetch.py box did not hold (east, north, south).
Writes WORKDIR/up_osm_{waterways,roads,places}.json and dem_N07_00_E080_00.tif. Same contact UA as fetch.py. Never committed."""
import sys, os, json, time, urllib.request, urllib.parse
W = sys.argv[1]; os.makedirs(W, exist_ok=True)
import itertools
def tiles(s, w, n, e, step=0.065):
    ys = [round(s + i * step, 4) for i in range(int((n - s) / step) + 1)] + [n]; xs = [round(w + i * step, 4) for i in range(int((e - w) / step) + 1)] + [e]
    ys = sorted(set(y for y in ys if y <= n)); xs = sorted(set(x for x in xs if x <= e))
    return [(a, c, b, d) for a, b in zip(ys, ys[1:]) for c, d in zip(xs, xs[1:])]
# the three strips the first fetch.py box did not hold (east, north, south), cut into small tiles: the public Overpass refuses big boxes (502 at capacity)
STRIPS = tiles(6.84, 80.10, 7.10, 80.31) + tiles(7.00, 79.84, 7.10, 80.10) + tiles(6.84, 79.84, 6.86, 80.10)   # S,W,N,E
UA = "sl-water-levels flood3d prep (+https://waterlevels.lk; shakee.zats@gmail.com)"
import subprocess
def get(url, data=None):
    # curl: the python 3.9 system SSL fails the handshake with overpass-api.de (seen 28 Oct 2026)
    cmd = ["curl", "-sS", "-f", "-m", "280", "-A", UA, url] + (["--data-binary", data.decode()] if data else [])
    return subprocess.run(cmd, check=True, capture_output=True).stdout
t = "N07_00_E080_00"; p = f"{W}/dem_{t}.tif"
if not os.path.exists(p):
    open(p, "wb").write(get(f"https://copernicus-dem-30m.s3.amazonaws.com/Copernicus_DSM_COG_10_{t}_DEM/Copernicus_DSM_COG_10_{t}_DEM.tif"))
def q(kind, b):
    return {
     "waterways": f'[out:json][timeout:180];(way["waterway"~"^(river|canal|drain)$"]({b}););out geom;',
     "places": f'[out:json][timeout:120];(nwr["place"~"^(suburb|neighbourhood|village|hamlet|town|quarter|locality)$"]["name"]({b});nwr["amenity"~"^(place_of_worship|school|college|university|hospital|bus_station|marketplace)$"]["name"]({b});nwr["railway"="station"]["name"]({b});nwr["man_made"="bridge"]["name"]({b});nwr["tourism"~"^(attraction|museum)$"]["name"]({b}););out center tags;',
     "roads_main": f'[out:json][timeout:240];(way["highway"~"^(motorway|trunk|primary|secondary|tertiary|motorway_link|trunk_link|primary_link|secondary_link|tertiary_link)$"]({b}););out geom tags;',
     "roads_local": f'[out:json][timeout:240];(way["highway"~"^(unclassified|residential)$"]({b}););out geom tags;',
    }[kind]
for k in ("waterways", "roads_main", "places", "roads_local"):
    out = f"{W}/up_osm_{k}.json"
    if os.path.exists(out) and os.path.getsize(out) > 0: continue
    els = {}; missing = []
    for s in STRIPS:
        b = ",".join(map(str, s)); ok = False
        part = f"{W}/up_part_{k}_{b}.json"
        if os.path.exists(part):
            for e in json.load(open(part)): els[(e["type"], e["id"])] = e
            continue
        for ep in ["https://overpass.openstreetmap.fr/api/interpreter", "https://overpass-api.de/api/interpreter", "https://overpass.openstreetmap.fr/api/interpreter", "https://overpass-api.de/api/interpreter"]:   # .fr answers in ~1 s when .de is at capacity
            try:
                d = json.loads(get(ep, urllib.parse.urlencode({"data": q(k, b)}).encode()))
                for e in d["elements"]: els[(e["type"], e["id"])] = e
                json.dump(d["elements"], open(part, "w")); ok = True; break
            except Exception as e:
                print(k, s, ep, e); time.sleep(45)
        if not ok:
            if k != "waterways": print("skipping", k, "tile", s); missing.append((k, s)); continue      # roads / places: a missing tile is not fatal (the map then has no local-street evidence there)
            raise SystemExit(f"failed {k} {s}")
        time.sleep(3)
    json.dump({"elements": list(els.values()), "missing_tiles": missing}, open(out, "w"))
    print(k, len(els))
print(os.listdir(W))
