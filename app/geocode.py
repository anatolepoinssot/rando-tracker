"""Géocodage inverse en tâche de fond (OpenStreetMap Nominatim, 1 requête/seconde max)."""
import json
import threading
import time
import urllib.parse
import urllib.request

from . import config
from .db import connect
from .gpx_utils import auto_name

_lock = threading.Lock()
_running = False


def reverse(lat, lon):
    url = "https://nominatim.openstreetmap.org/reverse?" + urllib.parse.urlencode(
        {"format": "jsonv2", "lat": lat, "lon": lon, "zoom": 12, "addressdetails": 1})
    req = urllib.request.Request(url, headers={
        "User-Agent": "RandoTracker/1.0 (application personnelle locale)",
        "Accept-Language": "fr",
    })
    with urllib.request.urlopen(req, timeout=12) as r:
        data = json.load(r)
    a = data.get("address", {})
    return {
        "commune": a.get("village") or a.get("town") or a.get("city") or a.get("municipality")
                   or a.get("hamlet") or a.get("suburb"),
        "departement": a.get("county") or a.get("state_district"),
        "region": a.get("state") or a.get("region") or a.get("province"),
        "country": a.get("country"),
    }


def reset_failed():
    conn = connect()
    try:
        conn.execute("UPDATE hikes SET geocoded = 0 WHERE geocoded = -1")
        conn.commit()
    finally:
        conn.close()


def start_worker():
    global _running
    if not config.GEOCODING_ENABLED:
        return
    with _lock:
        if _running:
            return
        _running = True
    threading.Thread(target=_run, daemon=True).start()


def _run():
    global _running
    conn = connect()
    try:
        while True:
            row = conn.execute(
                "SELECT id, start_lat, start_lon, auto_name, activity_type, start_time FROM hikes "
                "WHERE geocoded = 0 AND start_lat IS NOT NULL LIMIT 1").fetchone()
            if not row:
                break
            try:
                info = reverse(row["start_lat"], row["start_lon"])
            except Exception:
                # hors ligne : on réessaiera au prochain démarrage
                conn.execute("UPDATE hikes SET geocoded = -1 WHERE id = ?", (row["id"],))
                conn.commit()
                break
            # on ne remplace jamais ce que tu as saisi toi-même
            conn.execute(
                """UPDATE hikes SET
                     commune = COALESCE(NULLIF(commune, ''), ?),
                     departement = COALESCE(NULLIF(departement, ''), ?),
                     region = COALESCE(NULLIF(region, ''), ?),
                     country = COALESCE(NULLIF(country, ''), ?),
                     geocoded = 1
                   WHERE id = ?""",
                (info["commune"], info["departement"], info["region"], info["country"], row["id"]))
            if row["auto_name"] and info["commune"]:
                conn.execute("UPDATE hikes SET name = ? WHERE id = ? AND auto_name = 1",
                             (auto_name(row["activity_type"], row["start_time"], info["commune"]), row["id"]))
            conn.commit()
            time.sleep(1.1)
    finally:
        conn.close()
        with _lock:
            _running = False
