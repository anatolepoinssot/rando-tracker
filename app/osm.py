"""Sommets et cols depuis OpenStreetMap : détection le long d'une trace (Overpass) et recherche par nom (Nominatim)."""
import json
import re
import urllib.parse
import urllib.request

from .gpx_utils import haversine

UA = {"User-Agent": "RandoTracker/1.0 (application personnelle locale)", "Accept-Language": "fr"}
OVERPASS_URLS = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter"]

# Distance max entre la trace et le point OSM pour considérer qu'on y est passé.
PEAK_MAX_DIST_M = 80
PASS_MAX_DIST_M = 80
# Un sommet n'est retenu que si la trace monte à moins de X m de son altitude (évite les sommets « longés »).
PEAK_MAX_ELE_GAP_M = 45
# Le point culminant est rattaché à un sommet/col s'il en est à moins de X m.
CULMINANT_MATCH_M = 150

PEAK_TYPES = {"peak", "volcano", "hill"}
PASS_TYPES = {"saddle", "mountain_pass"}


def parse_ele(v):
    if v is None:
        return None
    m = re.search(r"-?\d+(?:[.,]\d+)?", str(v))
    if not m:
        return None
    ele = float(m.group().replace(",", "."))
    return ele if -500 < ele < 9000 else None


def _kind(tags):
    if tags.get("mountain_pass") == "yes" or tags.get("natural") in PASS_TYPES:
        return "col"
    return "sommet"


def overpass_points(bbox, margin=0.004):
    """Sommets et cols (nœuds OSM) dans l'emprise [ouest, sud, est, nord]."""
    w, s, e, n = bbox[0] - margin, bbox[1] - margin, bbox[2] + margin, bbox[3] + margin
    box = f"{s},{w},{n},{e}"
    q = (f'[out:json][timeout:25];('
         f'node["natural"~"^(peak|volcano|hill|saddle)$"]({box});'
         f'node["mountain_pass"="yes"]({box});'
         f');out body;')
    last = None
    for url in OVERPASS_URLS:
        try:
            req = urllib.request.Request(url, data=urllib.parse.urlencode({"data": q}).encode(), headers=UA)
            with urllib.request.urlopen(req, timeout=40) as r:
                return json.load(r).get("elements", [])
        except Exception as ex:  # serveur saturé : on tente le miroir
            last = ex
    raise RuntimeError(f"OpenStreetMap (Overpass) injoignable : {last}")


def candidates_along(track, elements):
    """Sommets/cols par lesquels passe la trace, + le point culminant.
    track = [[lon, lat, ele, km, t], …] ; elements = nœuds Overpass."""
    pts = [p for p in track if p[0] is not None and p[1] is not None]
    if not pts:
        return []
    out = []
    for el in elements:
        tags = el.get("tags") or {}
        name = (tags.get("name:fr") or tags.get("name") or "").strip()
        if not name:
            continue
        lat, lon = el["lat"], el["lon"]
        kind = _kind(tags)
        best, best_d = None, float("inf")
        for p in pts:
            d = haversine(lat, lon, p[1], p[0])
            if d < best_d:
                best, best_d = p, d
        limit = PASS_MAX_DIST_M if kind == "col" else PEAK_MAX_DIST_M
        if best_d > limit:
            continue
        ele = parse_ele(tags.get("ele"))
        if kind == "sommet" and ele is not None and best[2] is not None and best[2] < ele - PEAK_MAX_ELE_GAP_M:
            continue  # on est passé à côté, en contrebas
        out.append({
            "name": name, "kind": kind, "lat": lat, "lon": lon,
            "ele": round(ele) if ele is not None else (round(best[2]) if best[2] is not None else None),
            "osm_id": f"node/{el['id']}", "time": best[4], "distance_m": round(best_d), "culminant": False,
        })
    # point culminant de la trace
    with_ele = [p for p in pts if p[2] is not None]
    if with_ele:
        top = max(with_ele, key=lambda p: p[2])
        near = [c for c in out if haversine(c["lat"], c["lon"], top[1], top[0]) <= CULMINANT_MATCH_M]
        if near:
            min(near, key=lambda c: haversine(c["lat"], c["lon"], top[1], top[0]))["culminant"] = True
        else:
            out.append({"name": "", "kind": "sommet", "lat": top[1], "lon": top[0], "ele": round(top[2]),
                        "osm_id": None, "time": top[4], "distance_m": 0, "culminant": True})
    # dédoublonnage (un même lieu cartographié deux fois)
    uniq = {}
    for c in out:
        key = c["osm_id"] or f"top:{c['lat']:.4f},{c['lon']:.4f}"
        uniq.setdefault(key, c)
    return sorted(uniq.values(), key=lambda c: (c["time"] is None, c["time"] or 0))


def search(query, limit=10):
    """Recherche d'un sommet/col par son nom (Nominatim)."""
    url = "https://nominatim.openstreetmap.org/search?" + urllib.parse.urlencode(
        {"q": query, "format": "jsonv2", "extratags": 1, "addressdetails": 1, "limit": 25})
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=15) as r:
        data = json.load(r)
    res = []
    for d in data:
        cat, typ = d.get("category") or d.get("class"), d.get("type")
        tags = d.get("extratags") or {}
        is_peak = cat == "natural" and typ in PEAK_TYPES
        is_pass = (cat == "natural" and typ in PASS_TYPES) or tags.get("mountain_pass") == "yes" or typ == "mountain_pass"
        a = d.get("address") or {}
        res.append({
            "name": d.get("name") or d.get("display_name", "").split(",")[0],
            "kind": "col" if is_pass else ("sommet" if is_peak else "lieu"),
            "mountain": is_peak or is_pass,
            "lat": float(d["lat"]), "lon": float(d["lon"]),
            "ele": parse_ele(tags.get("ele")),
            "osm_id": f"{d.get('osm_type')}/{d.get('osm_id')}" if d.get("osm_type") else None,
            "where": ", ".join(x for x in [a.get("county") or a.get("state"), a.get("country")] if x),
        })
    res.sort(key=lambda r: not r["mountain"])
    return res[:limit]
