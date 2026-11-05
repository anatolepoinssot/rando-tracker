"""Lecture des traces (GPX, FIT, TCX, éventuellement compressées en .gz) et calcul des statistiques."""
import gzip
import io
import json
import math
import re
import xml.etree.ElementTree as ET
from bisect import bisect_left
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

import gpxpy
import gpxpy.gpx

from . import config

EARTH_R = 6371008.8
SEMICIRCLE = 180 / 2 ** 31
TRACK_EXTENSIONS = (".gpx", ".fit", ".tcx")

TYPE_MAP = {
    # anglais (GPX, FIT, Strava)
    "hiking": "Randonnée", "hike": "Randonnée", "walking": "Marche", "walk": "Marche",
    "trail_running": "Trail", "trail_run": "Trail", "trail": "Trail", "running": "Course", "run": "Course",
    "mountaineering": "Alpinisme", "climbing": "Escalade", "rock_climb": "Escalade", "rock_climbing": "Escalade",
    "snowshoeing": "Raquettes", "snow_shoe": "Raquettes", "snowshoe": "Raquettes",
    "backcountry_skiing": "Ski de rando", "backcountry_ski": "Ski de rando", "ski_touring": "Ski de rando",
    "alpine_skiing": "Ski alpin", "alpine_ski": "Ski alpin", "cross_country_skiing": "Ski de fond",
    "nordic_ski": "Ski de fond", "cycling": "Vélo", "ride": "Vélo", "road_biking": "Vélo", "gravel_ride": "Vélo",
    "e-bike_ride": "Vélo", "mountain_biking": "VTT", "mountain_bike_ride": "VTT", "swimming": "Natation",
    "swim": "Natation", "kayaking": "Kayak", "canoeing": "Kayak",
    # français (export Strava en français, GPX nommés à la main)
    "randonnée": "Randonnée", "randonnee": "Randonnée", "rando": "Randonnée", "marche": "Marche",
    "course_à_pied": "Course", "course": "Course", "vélo": "Vélo", "velo": "Vélo", "vtt": "VTT",
    "alpinisme": "Alpinisme", "escalade": "Escalade", "raquettes": "Raquettes", "raquette": "Raquettes",
    "ski_de_randonnée": "Ski de rando", "ski_de_rando": "Ski de rando", "ski_alpin": "Ski alpin",
    "ski_de_fond": "Ski de fond", "natation": "Natation", "trek": "Trek",
}
ACTIVITY_TYPES = ["Randonnée", "Trek", "Marche", "Trail", "Course", "Alpinisme", "Escalade",
                  "Raquettes", "Ski de rando", "Ski alpin", "Ski de fond", "VTT", "Vélo", "Autre"]

GENERIC_NAMES = {
    "", "randonnée", "randonnee", "hiking", "hike", "marche", "walking", "walk", "course à pied",
    "running", "trail", "trail running", "activité", "activity", "track", "current track",
    "piste", "trace", "mountaineering", "snowshoeing",
}
# Noms donnés automatiquement par Strava / les montres : « Morning Hike », « Randonnée l'après-midi »…
_GENERIC_EN = re.compile(r"^(morning|afternoon|evening|night|lunch)\s+[\w\s-]+$", re.I)
_GENERIC_FR = re.compile(
    r"^(randonnée|marche|course( à pied)?|sortie( à| en)? \w+|trail|vélo|vtt|ski[\w\s]*|raquettes|activité)\s+"
    r"(le matin|du matin|matinale|l['’]après-midi|de l['’]après-midi|le midi|du midi|en soirée|le soir|"
    r"du soir|de nuit|nocturne)$", re.I)
_GENERIC_DEVICE = re.compile(r"^[\w\s-]{0,20}\s(hiking|walk|walking|trail run|run)$", re.I)  # « Chamonix Hiking »


def haversine(lat1, lon1, lat2, lon2):
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = p2 - p1
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * EARTH_R * math.asin(min(1.0, math.sqrt(a)))


def normalize_type(raw):
    if not raw:
        return "Randonnée"
    k = str(raw).strip().lower()
    if k.isdigit() or k in ("generic", "all", "training", "invalid"):
        return "Randonnée"
    return TYPE_MAP.get(k) or TYPE_MAP.get(re.sub(r"[\s-]+", "_", k)) or str(raw).strip().capitalize()


def is_generic_name(name):
    if not name:
        return True
    n = name.strip().lower()
    if n in GENERIC_NAMES or len(n) < 3:
        return True
    if _GENERIC_EN.match(n) or _GENERIC_FR.match(n):
        return True
    if _GENERIC_DEVICE.match(n) and len(n.split()) <= 2:
        return True
    return bool(re.fullmatch(r"[\d\s:/\-_.t]+", n))  # nom = juste une date/un numéro


def auto_name(activity_type, start_iso, commune=None):
    act = activity_type or "Randonnée"
    if commune:
        return f"{act} à {commune}"
    if start_iso:
        d = datetime.fromisoformat(start_iso.replace("Z", "+00:00")).astimezone(ZoneInfo(config.LOCAL_TIMEZONE))
        return f"{act} du {d.strftime('%d/%m/%Y')}"
    return act


def _ts(t):
    if t is None:
        return None
    if t.tzinfo is None:
        t = t.replace(tzinfo=timezone.utc)
    return t.timestamp()


def _iso(ts):
    if ts is None:
        return None
    return datetime.fromtimestamp(ts, timezone.utc).isoformat().replace("+00:00", "Z")


def _num(v):
    try:
        f = float(v)
        return f if math.isfinite(f) else None
    except (TypeError, ValueError):
        return None


# ------------------------------------------------------------------ lecture des formats
def decompress(content: bytes) -> bytes:
    if content[:2] == b"\x1f\x8b":
        return gzip.decompress(content)
    return content


def detect_format(content: bytes) -> str:
    if len(content) >= 12 and content[8:12] == b".FIT":
        return "fit"
    head = content[:3000].lower()
    if b"<trainingcenterdatabase" in head:
        return "tcx"
    if b"<gpx" in head:
        return "gpx"
    raise ValueError("Format non reconnu (formats acceptés : GPX, FIT, TCX).")


def _gpx_hr(point):
    for ext in getattr(point, "extensions", None) or []:
        for el in ext.iter():
            tag = el.tag.split("}")[-1].lower()
            if tag in ("hr", "heartrate") and el.text:
                return _num(el.text)
    return None


def _read_gpx(content):
    gpx = gpxpy.parse(content.decode("utf-8-sig", errors="replace"))
    raw, name, typ = [], None, None
    for trk in gpx.tracks:
        name = name or trk.name
        typ = typ or trk.type
        for seg in trk.segments:
            raw.extend(seg.points)
    if not raw:
        for rte in gpx.routes:
            name = name or rte.name
            raw.extend(rte.points)
    pts = [(p.latitude, p.longitude, p.elevation, _ts(p.time), _gpx_hr(p)) for p in raw]
    return pts, name or gpx.name, typ


def _read_fit(content):
    import fitdecode

    pts, sport, sub_sport = [], None, None
    with fitdecode.FitReader(io.BytesIO(content), check_crc=fitdecode.CrcCheck.DISABLED,
                             error_handling=fitdecode.ErrorHandling.IGNORE) as fit:
        for frame in fit:
            if frame.frame_type != fitdecode.FIT_FRAME_DATA:
                continue
            if frame.name == "record":
                lat = frame.get_value("position_lat", fallback=None)
                lon = frame.get_value("position_long", fallback=None)
                if not isinstance(lat, int) or not isinstance(lon, int):
                    continue
                lat, lon = lat * SEMICIRCLE, lon * SEMICIRCLE
                if not (-90 <= lat <= 90 and -180 <= lon <= 180) or (lat == 0 and lon == 0):
                    continue
                ele = _num(frame.get_value("enhanced_altitude", fallback=None))
                if ele is None:
                    ele = _num(frame.get_value("altitude", fallback=None))
                if ele is not None and not -500 < ele < 9000:
                    ele = None
                t = frame.get_value("timestamp", fallback=None)
                hr = _num(frame.get_value("heart_rate", fallback=None))
                pts.append((lat, lon, ele, _ts(t) if isinstance(t, datetime) else None, hr or None))
            elif frame.name in ("session", "sport") and sport is None:
                sport = frame.get_value("sport", fallback=None)
                sub_sport = frame.get_value("sub_sport", fallback=None)
    sport = sport if isinstance(sport, str) else None
    sub_sport = sub_sport if isinstance(sub_sport, str) else None
    if sport == "running" and sub_sport == "trail":
        typ = "trail_running"
    elif sub_sport in ("mountaineering", "backcountry", "mountain"):
        typ = {"backcountry": "backcountry_skiing", "mountain": "mountain_biking"}.get(sub_sport, sub_sport)
    else:
        typ = sport
    return pts, None, typ


def _read_tcx(content):
    root = ET.fromstring(content.decode("utf-8-sig", errors="replace").strip().encode())

    def local(el):
        return el.tag.split("}")[-1]

    def child(el, name):
        for c in el:
            if local(c) == name:
                return c
        return None

    pts, typ, name = [], None, None
    for el in root.iter():
        tag = local(el)
        if tag == "Activity" and typ is None:
            typ = el.get("Sport")
        elif tag in ("Notes", "Name") and name is None and el.text and el.text.strip():
            name = el.text.strip()
        elif tag == "Trackpoint":
            pos = child(el, "Position")
            if pos is None:
                continue
            lat, lon = _num(getattr(child(pos, "LatitudeDegrees"), "text", None)), _num(getattr(child(pos, "LongitudeDegrees"), "text", None))
            if lat is None or lon is None:
                continue
            ele = _num(getattr(child(el, "AltitudeMeters"), "text", None))
            tt = getattr(child(el, "Time"), "text", None)
            t = _ts(datetime.fromisoformat(tt.replace("Z", "+00:00"))) if tt else None
            hrel = child(el, "HeartRateBpm")
            hr = _num(getattr(child(hrel, "Value"), "text", None)) if hrel is not None else None
            pts.append((lat, lon, ele, t, hr))
    return pts, name, ("hiking" if (typ or "").lower() == "other" else typ)


def read_points(content: bytes):
    """Renvoie (points, nom, type brut, format). Un point = (lat, lon, alt|None, timestamp|None, fc|None)."""
    content = decompress(content)
    fmt = detect_format(content)
    pts, name, typ = {"gpx": _read_gpx, "fit": _read_fit, "tcx": _read_tcx}[fmt](content)
    return pts, name, typ, fmt


# ------------------------------------------------------------------ calculs
def _fill(values):
    """Interpole les altitudes manquantes."""
    known = [i for i, v in enumerate(values) if v is not None]
    if not known:
        return None
    out = list(values)
    first = known[0]
    for i in range(first):
        out[i] = values[first]
    last = first
    for k in known[1:]:
        for i in range(last + 1, k):
            out[i] = values[last] + (values[k] - values[last]) * (i - last) / (k - last)
        last = k
    for i in range(last + 1, len(out)):
        out[i] = values[last]
    return out


def _smooth(values, window):
    n = len(values)
    if window <= 1 or n < window:
        return list(values)
    half = window // 2
    ps = [0.0]
    for v in values:
        ps.append(ps[-1] + v)
    return [(ps[min(n, i + half + 1)] - ps[max(0, i - half)]) / (min(n, i + half + 1) - max(0, i - half))
            for i in range(n)]


def _climb(eles, threshold):
    """D+ / D− avec hystérésis : on ne compte une variation que si elle dépasse le seuil."""
    gain = loss = 0.0
    ref = eles[0]
    for e in eles[1:]:
        d = e - ref
        if d >= threshold:
            gain += d
            ref = e
        elif d <= -threshold:
            loss -= d
            ref = e
    return gain, loss


def _decimate(dist, min_step):
    n = len(dist)
    keep = [0]
    last = dist[0]
    for i in range(1, n - 1):
        if dist[i] - last >= min_step:
            keep.append(i)
            last = dist[i]
    keep.append(n - 1)
    return keep


class NoTrackError(ValueError):
    """Activité sans trace GPS exploitable (séance en salle, tapis…) : ignorée, pas une vraie erreur."""


def compute(points, name=None, typ=None) -> dict:
    if len(points) < 2:
        raise NoTrackError("Pas de trace GPS dans ce fichier (activité en intérieur ?).")
    lat = [p[0] for p in points]
    lon = [p[1] for p in points]
    times = [p[3] for p in points]
    hrs = [p[4] for p in points if p[4]]
    n = len(points)

    dist = [0.0]
    for i in range(1, n):
        dist.append(dist[-1] + haversine(lat[i - 1], lon[i - 1], lat[i], lon[i]))
    if dist[-1] < 50:
        raise NoTrackError("Trace trop courte (moins de 50 m).")

    eles = _fill([p[2] for p in points])
    if eles:
        sm = _smooth(eles, config.ELEVATION_SMOOTHING_WINDOW)
        gain, loss = _climb(sm, config.ELEVATION_THRESHOLD_M)
        ele_max, ele_min = max(sm), min(sm)
    else:
        sm, gain, loss, ele_max, ele_min = None, None, None, None, None

    valid_t = [t for t in times if t is not None]
    start = min(valid_t) if valid_t else None
    end = max(valid_t) if valid_t else None
    moving = None
    if valid_t:
        moving = 0.0
        for i in range(1, n):
            t0, t1 = times[i - 1], times[i]
            if t0 is None or t1 is None or t1 <= t0:
                continue
            dt = t1 - t0
            dd = dist[i] - dist[i - 1]
            dz = (sm[i] - sm[i - 1]) if sm else 0.0
            if math.hypot(dd, dz) / dt >= config.MOVING_SPEED_THRESHOLD:
                moving += dt

    total = dist[-1]
    step = max(5.0, total / 5000)
    detail = [[round(lon[i], 6), round(lat[i], 6),
               round(sm[i], 1) if sm else None,
               round(dist[i] / 1000, 4),
               int(times[i]) if times[i] is not None else None]
              for i in _decimate(dist, step)]
    overview = [[round(lon[i], 5), round(lat[i], 5)] for i in _decimate(dist, max(25.0, total / 300))]

    activity = normalize_type(typ)
    start_iso = _iso(start)
    clean_name = (name or "").strip()
    generic = is_generic_name(clean_name)
    return {
        "name": auto_name(activity, start_iso) if generic else clean_name,
        "auto_name": 1 if generic else 0,
        "activity_type": activity,
        "start_time": start_iso,
        "end_time": _iso(end),
        "distance_m": round(total, 1),
        "ele_gain": round(gain) if gain is not None else None,
        "ele_loss": round(loss) if loss is not None else None,
        "ele_max": round(ele_max) if ele_max is not None else None,
        "ele_min": round(ele_min) if ele_min is not None else None,
        "duration_s": round(end - start) if start is not None else None,
        "moving_s": round(moving) if moving is not None else None,
        "avg_hr": round(sum(hrs) / len(hrs)) if hrs else None,
        "max_hr": round(max(hrs)) if hrs else None,
        "start_lat": lat[0],
        "start_lon": lon[0],
        "bbox": json.dumps([min(lon), min(lat), max(lon), max(lat)]),
        "track_overview": json.dumps(overview, separators=(",", ":")),
        "track_detail": json.dumps(detail, separators=(",", ":")),
    }


def parse_track(content: bytes) -> dict:
    pts, name, typ, _fmt = read_points(content)
    return compute(pts, name, typ)


def parse_gpx(content: bytes) -> dict:  # compatibilité
    return parse_track(content)


def to_gpx(content: bytes, name: str) -> str:
    """Convertit n'importe quelle trace acceptée en GPX (pour le téléchargement)."""
    pts, _n, _t, _f = read_points(content)
    gpx = gpxpy.gpx.GPX()
    gpx.creator = "Rando Tracker"
    trk = gpxpy.gpx.GPXTrack(name=name)
    seg = gpxpy.gpx.GPXTrackSegment()
    for lat, lon, ele, t, _hr in pts:
        seg.points.append(gpxpy.gpx.GPXTrackPoint(
            lat, lon, elevation=ele, time=datetime.fromtimestamp(t, timezone.utc) if t is not None else None))
    trk.segments.append(seg)
    gpx.tracks.append(trk)
    return gpx.to_xml()


STAT_FIELDS = ["start_time", "end_time", "distance_m", "ele_gain", "ele_loss",
               "ele_max", "ele_min", "duration_s", "moving_s", "avg_hr", "max_hr",
               "start_lat", "start_lon", "bbox", "track_overview", "track_detail"]


def position_at(detail, t, tolerance):
    """Position (lat, lon) sur la trace à l'instant t (timestamp UTC), ou None."""
    pts = [p for p in detail if p[4] is not None]
    if not pts:
        return None
    times = [p[4] for p in pts]
    if t < times[0] - tolerance or t > times[-1] + tolerance:
        return None
    if t <= times[0]:
        return pts[0][1], pts[0][0]
    if t >= times[-1]:
        return pts[-1][1], pts[-1][0]
    i = bisect_left(times, t)
    a, b = pts[i - 1], pts[i]
    span = b[4] - a[4]
    f = (t - a[4]) / span if span else 0.0
    return a[1] + (b[1] - a[1]) * f, a[0] + (b[0] - a[0]) * f


def nearest_on_track(detail, lat, lon):
    """Point de la trace le plus proche : ((lat, lon), distance en m)."""
    best, best_d = None, float("inf")
    for p in detail:
        d = haversine(lat, lon, p[1], p[0])
        if d < best_d:
            best, best_d = p, d
    return ((best[1], best[0]), best_d) if best else (None, best_d)
