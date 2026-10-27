"""Step 1 of the flood-3d prep: download raw inputs into a work dir (never committed).
  python fetch.py WORKDIR
Copernicus GLO-30 COGs (AWS open data, keyless) + OSM waterways and roads via Overpass (contact UA)."""
import sys, os, json, time, urllib.request, urllib.parse
W = sys.argv[1]; os.makedirs(W, exist_ok=True)
BBOX = (6.86, 79.84, 7.00, 80.10)  # S,W,N,E: Colombo (Nagalagam) to Hanwella, Kelaniya in the middle
UA = "sl-water-levels flood3d prep (+https://waterlevels.lk; shakee.zats@gmail.com)"
def get(url, data=None):
    req = urllib.request.Request(url, data=data, headers={"User-Agent": UA})
    return urllib.request.urlopen(req, timeout=300).read()
for t in ["N06_00_E079_00", "N06_00_E080_00"]:
    p = f"{W}/dem_{t}.tif"
    if not os.path.exists(p):
        open(p, "wb").write(get(f"https://copernicus-dem-30m.s3.amazonaws.com/Copernicus_DSM_COG_10_{t}_DEM/Copernicus_DSM_COG_10_{t}_DEM.tif"))
b = ",".join(map(str, BBOX))
Q = {
 "waterways": f'[out:json][timeout:180];(way["waterway"~"^(river|canal|drain)$"]({b}););out geom;',
 "places": f'[out:json][timeout:120];(nwr["place"~"^(suburb|neighbourhood|village|hamlet|town|quarter|locality)$"]["name"]({b});nwr["amenity"~"^(place_of_worship|school|college|university|hospital|bus_station|marketplace)$"]["name"]({b});nwr["railway"="station"]["name"]({b});nwr["man_made"="bridge"]["name"]({b});nwr["tourism"~"^(attraction|museum)$"]["name"]({b}););out center tags;',
 "roads": f'[out:json][timeout:240];(way["highway"~"^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|motorway_link|trunk_link|primary_link|secondary_link|tertiary_link)$"]({b}););out geom tags;',
}
for k, q in Q.items():
    p = f"{W}/osm_{k}.json"
    if os.path.exists(p) and os.path.getsize(p) > 0: continue
    for ep in ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter"]:
        try:
            d = get(ep, urllib.parse.urlencode({"data": q}).encode()); open(p, "wb").write(d); break
        except Exception as e:
            print(k, ep, e); time.sleep(10)
    time.sleep(5)
print(os.listdir(W))
