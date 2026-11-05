"""API de Rando Tracker."""
import hashlib
import json
import re
import shutil
import unicodedata
import uuid
from collections import defaultdict
from contextlib import asynccontextmanager
from datetime import datetime, timedelta
from typing import Optional

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from zoneinfo import ZoneInfo

from . import config, osm
from .db import PEOPLE_GC, get_conn, init_db
from .geocode import reset_failed, start_worker
from .gpx_utils import (ACTIVITY_TYPES, STAT_FIELDS, NoTrackError, compute, decompress, detect_format, haversine,
                        nearest_on_track, parse_track, position_at, read_points, to_gpx)
from .photos import copy_photo_files, delete_photo_files, peek_meta, process_photo, save_profile_photo

SUMMARY_COLS = ("id, name, activity_type, start_time, end_time, distance_m, ele_gain, ele_loss, ele_max, "
                "ele_min, duration_s, moving_s, avg_hr, max_hr, start_lat, start_lon, bbox, commune, "
                "departement, region, country, massif, notes, rating, geocoded, trek_id")
EDITABLE = {"name", "activity_type", "notes", "rating", "commune", "departement", "region", "country", "massif"}


@asynccontextmanager
async def lifespan(_app):
    init_db()
    reset_failed()
    start_worker()
    yield


app = FastAPI(title="Rando Tracker", lifespan=lifespan)
app.mount("/static", StaticFiles(directory=config.STATIC_DIR), name="static")
app.mount("/media/photos", StaticFiles(directory=config.PHOTO_DIR), name="photos")
app.mount("/media/thumbs", StaticFiles(directory=config.THUMB_DIR), name="thumbs")


# ---------------------------------------------------------------- helpers
def _summaries(conn, where="", params=()):
    rows = conn.execute(f"SELECT {SUMMARY_COLS} FROM hikes {where} ORDER BY start_time DESC, id DESC",
                        params).fetchall()
    people = defaultdict(list)
    for r in conn.execute("SELECT hp.hike_id, p.name FROM hike_people hp "
                          "JOIN people p ON p.id = hp.person_id ORDER BY p.name COLLATE NOCASE"):
        people[r[0]].append(r[1])
    photo_counts = dict(conn.execute("SELECT hike_id, COUNT(*) FROM photos GROUP BY hike_id").fetchall())
    out = []
    for r in rows:
        d = dict(r)
        d["bbox"] = json.loads(d["bbox"]) if d["bbox"] else None
        d["people"] = people.get(r["id"], [])
        d["photo_count"] = photo_counts.get(r["id"], 0)
        out.append(d)
    return out


def _summary(conn, hike_id):
    s = _summaries(conn, "WHERE id = ?", (hike_id,))
    if not s:
        raise HTTPException(404, "Sortie introuvable")
    return s[0]


def _photo_dict(r):
    d = dict(r)
    d["url"] = f"/media/photos/{r['display_file']}"
    d["thumb_url"] = f"/media/thumbs/{r['thumb_file']}"
    d["original_url"] = f"/media/photos/{r['original_file']}"
    return d


def _slug(text):
    t = unicodedata.normalize("NFKD", text or "rando").encode("ascii", "ignore").decode()
    return re.sub(r"[^A-Za-z0-9]+", "-", t).strip("-").lower() or "rando"


# ---------------------------------------------------------------- pages
@app.get("/")
def index():
    return FileResponse(config.STATIC_DIR / "index.html")


# ---------------------------------------------------------------- randos
@app.get("/api/hikes")
def list_hikes():
    start_worker()  # termine le géocodage éventuellement en attente
    with get_conn() as conn:
        return _summaries(conn)


@app.get("/api/tracks")
def list_tracks():
    with get_conn() as conn:
        return {r["id"]: json.loads(r["track_overview"])
                for r in conn.execute("SELECT id, track_overview FROM hikes")}


@app.get("/api/meta")
def meta():
    return {"activity_types": ACTIVITY_TYPES}


@app.get("/api/hikes/{hike_id}")
def get_hike(hike_id: int):
    with get_conn() as conn:
        s = _summary(conn, hike_id)
        row = conn.execute("SELECT track_detail FROM hikes WHERE id = ?", (hike_id,)).fetchone()
        s["track"] = json.loads(row["track_detail"])
        s["photos"] = [_photo_dict(r) for r in conn.execute(
            "SELECT * FROM photos WHERE hike_id = ? ORDER BY taken_at IS NULL, taken_at, id", (hike_id,))]
        return s


def _same_outing(conn, data):
    """Même sortie déjà importée (ex. le GPX et le FIT d'une même activité) : départ à ±2 min, distance à ±15 %.
    Renvoie la ligne existante ou None."""
    if not data["start_time"]:
        return None
    t = datetime.fromisoformat(data["start_time"].replace("Z", "+00:00"))
    lo = (t - timedelta(minutes=2)).isoformat().replace("+00:00", "Z")
    hi = (t + timedelta(minutes=2)).isoformat().replace("+00:00", "Z")
    for r in conn.execute("SELECT id, distance_m, auto_name, notes, avg_hr FROM hikes "
                          "WHERE start_time BETWEEN ? AND ?", (lo, hi)):
        d0, d1 = r["distance_m"] or 0, data["distance_m"] or 0
        if abs(d0 - d1) <= 0.15 * max(d0, d1, 1):
            return r
    return None


def _enrich(conn, existing, data):
    """Complète une sortie existante avec ce que le doublon apporte (nom Strava, description, cardio)."""
    sets, vals = [], []
    if existing["auto_name"] and not data["auto_name"]:
        sets += ["name = ?", "auto_name = 0"]
        vals.append(data["name"])
    if not (existing["notes"] or "").strip() and data.get("notes"):
        sets.append("notes = ?")
        vals.append(data["notes"])
    if existing["avg_hr"] is None and data["avg_hr"] is not None:
        sets += ["avg_hr = ?", "max_hr = ?"]
        vals += [data["avg_hr"], data["max_hr"]]
    if sets:
        conn.execute(f"UPDATE hikes SET {', '.join(sets)} WHERE id = ?", (*vals, existing["id"]))
    return bool(sets)


@app.post("/api/hikes/import")
async def import_tracks(files: list[UploadFile] = File(...), meta: str = Form("{}")):
    """Importe des traces GPX / FIT / TCX (éventuellement .gz).
    `meta` (optionnel) : {"nom_du_fichier": {"name", "type", "description"}} issu de activities.csv (Strava)."""
    try:
        meta_map = {k.lower(): v for k, v in json.loads(meta or "{}").items()}
    except ValueError:
        meta_map = {}
    results = []
    with get_conn() as conn:
        for f in files:
            raw = await f.read()
            # un import de dossier transmet « export/activities/123.fit.gz » : on garde le nom seul
            fname = (f.filename or "trace.gpx").replace("\\", "/").rsplit("/", 1)[-1]
            try:
                content = decompress(raw)
                fmt = detect_format(content)
            except Exception as e:
                results.append({"file": fname, "status": "error", "message": str(e)})
                continue
            digest = hashlib.sha256(content).hexdigest()
            same_file = conn.execute("SELECT id, auto_name, notes, avg_hr FROM hikes WHERE file_hash = ?",
                                     (digest,)).fetchone()
            try:
                pts, name, typ, _ = read_points(content)
                m = meta_map.get(fname.lower()) or {}
                data = compute(pts, (m.get("name") or "").strip() or name, m.get("type") or typ)
            except NoTrackError as e:
                results.append({"file": fname, "status": "skipped", "message": str(e)})
                continue
            except Exception as e:
                results.append({"file": fname, "status": "error", "message": str(e)})
                continue
            if (m.get("description") or "").strip():
                data["notes"] = m["description"].strip()
            existing = same_file or _same_outing(conn, data)
            if existing is not None:
                enriched = _enrich(conn, existing, data)
                results.append({"file": fname, "status": "duplicate", "id": existing["id"], "enriched": enriched})
                continue
            base = re.sub(r"\.(gpx|fit|tcx)(\.gz)?$", "", fname, flags=re.I)
            stored = f"{uuid.uuid4().hex[:12]}_{_slug(base)}.{fmt}"
            (config.GPX_DIR / stored).write_bytes(content)
            data.update(gpx_file=stored, file_hash=digest)
            cols = ", ".join(data)
            cur = conn.execute(f"INSERT INTO hikes ({cols}) VALUES ({', '.join('?' * len(data))})",
                               list(data.values()))
            results.append({"file": fname, "status": "imported", "id": cur.lastrowid, "name": data["name"]})
    start_worker()
    return results


class HikePatch(BaseModel):
    name: Optional[str] = None
    activity_type: Optional[str] = None
    notes: Optional[str] = None
    rating: Optional[int] = None
    commune: Optional[str] = None
    departement: Optional[str] = None
    region: Optional[str] = None
    country: Optional[str] = None
    massif: Optional[str] = None


@app.patch("/api/hikes/{hike_id}")
def patch_hike(hike_id: int, body: HikePatch):
    fields = {k: v for k, v in body.model_dump(exclude_unset=True).items() if k in EDITABLE}
    with get_conn() as conn:
        _summary(conn, hike_id)
        if fields:
            sets, vals = [], []
            for k, v in fields.items():
                if isinstance(v, str):
                    v = v.strip()
                if k == "name" and not v:
                    raise HTTPException(400, "Le nom ne peut pas être vide")
                if k == "rating" and v is not None and not 1 <= v <= 5:
                    v = None
                sets.append(f"{k} = ?")
                vals.append(v)
            if "name" in fields:
                sets.append("auto_name = 0")
            conn.execute(f"UPDATE hikes SET {', '.join(sets)} WHERE id = ?", (*vals, hike_id))
        return _summary(conn, hike_id)


@app.delete("/api/hikes/{hike_id}")
def delete_hike(hike_id: int):
    with get_conn() as conn:
        row = conn.execute("SELECT gpx_file FROM hikes WHERE id = ?", (hike_id,)).fetchone()
        if not row:
            raise HTTPException(404, "Sortie introuvable")
        for p in conn.execute("SELECT * FROM photos WHERE hike_id = ?", (hike_id,)):
            delete_photo_files(p)
        conn.execute("DELETE FROM hikes WHERE id = ?", (hike_id,))
        conn.execute(PEOPLE_GC)
        _gc_treks(conn)
    (config.GPX_DIR / row["gpx_file"]).unlink(missing_ok=True)
    for sub in (config.PHOTO_DIR / "originals" / str(hike_id), config.PHOTO_DIR / "display" / str(hike_id),
                config.THUMB_DIR / str(hike_id)):
        shutil.rmtree(sub, ignore_errors=True)
    return {"ok": True}


@app.get("/api/hikes/{hike_id}/gpx")
def download_gpx(hike_id: int):
    with get_conn() as conn:
        row = conn.execute("SELECT name, gpx_file FROM hikes WHERE id = ?", (hike_id,)).fetchone()
    if not row:
        raise HTTPException(404, "Sortie introuvable")
    path = config.GPX_DIR / row["gpx_file"]
    filename = f"{_slug(row['name'])}.gpx"
    if path.suffix.lower() == ".gpx":
        return FileResponse(path, media_type="application/gpx+xml", filename=filename)
    return Response(to_gpx(path.read_bytes(), row["name"]), media_type="application/gpx+xml",
                    headers={"Content-Disposition": f'attachment; filename="{filename}"'})


@app.post("/api/recompute")
def recompute_all():
    """Recalcule les statistiques de toutes les sorties (après avoir modifié config.py)."""
    n = 0
    with get_conn() as conn:
        for row in conn.execute("SELECT id, gpx_file FROM hikes").fetchall():
            path = config.GPX_DIR / row["gpx_file"]
            if not path.exists():
                continue
            data = parse_track(path.read_bytes())
            conn.execute(f"UPDATE hikes SET {', '.join(f'{k} = ?' for k in STAT_FIELDS)} WHERE id = ?",
                         (*[data[k] for k in STAT_FIELDS], row["id"]))
            n += 1
    return {"recomputed": n}


# ---------------------------------------------------------------- compagnons
class PeoplePut(BaseModel):
    names: list[str]


def _person_dict(r):
    d = dict(r)
    for k in ("photo_original", "photo_display", "photo_thumb"):
        d.pop(k, None)
    d["photo_url"] = f"/media/photos/{r['photo_display']}" if r["photo_display"] else None
    d["photo_thumb_url"] = f"/media/thumbs/{r['photo_thumb']}" if r["photo_thumb"] else None
    return d


@app.get("/api/people")
def list_people():
    with get_conn() as conn:
        return [_person_dict(r) for r in conn.execute(
            "SELECT p.id, p.name, p.photo_original, p.photo_display, p.photo_thumb, "
            "(SELECT COUNT(*) FROM hike_people hp WHERE hp.person_id = p.id) AS hikes, "
            "(SELECT COUNT(*) FROM summit_people sp WHERE sp.person_id = p.id) AS summits "
            "FROM people p ORDER BY p.name COLLATE NOCASE")]


def _clean_names(names):
    out, seen = [], set()
    for n in names or []:
        n = " ".join(str(n).split())
        if n and n.lower() not in seen:
            seen.add(n.lower())
            out.append(n)
    return out


def _assign_people(conn, table, col, obj_id, names):
    conn.execute(f"DELETE FROM {table} WHERE {col} = ?", (obj_id,))
    for n in _clean_names(names):
        conn.execute("INSERT OR IGNORE INTO people (name) VALUES (?)", (n,))
        pid = conn.execute("SELECT id FROM people WHERE name = ?", (n,)).fetchone()["id"]
        conn.execute(f"INSERT OR IGNORE INTO {table} ({col}, person_id) VALUES (?, ?)", (obj_id, pid))
    conn.execute(PEOPLE_GC)


@app.put("/api/hikes/{hike_id}/people")
def set_people(hike_id: int, body: PeoplePut):
    with get_conn() as conn:
        _summary(conn, hike_id)
        _assign_people(conn, "hike_people", "hike_id", hike_id, body.names)
        return _summary(conn, hike_id)


# ---------------------------------------------------------------- photos
def _insert_photo(conn, hike_id, content, filename, detail, offset_minutes=0, digest=None):
    """Enregistre une photo sur une sortie et la place sur la trace (GPS de la photo, sinon heure)."""
    digest = digest or hashlib.sha256(content).hexdigest()
    if conn.execute("SELECT 1 FROM photos WHERE hike_id = ? AND file_hash = ?", (hike_id, digest)).fetchone():
        return {"file": filename, "status": "duplicate", "hike_id": hike_id}
    meta, stored = process_photo(content, filename, hike_id)
    taken = meta["taken_at"]
    if taken is not None and offset_minutes:
        taken = taken.fromtimestamp(taken.timestamp() + offset_minutes * 60, taken.tzinfo)
    lat, lon, source = meta["lat"], meta["lon"], "exif_gps"
    if lat is None and taken is not None:
        pos = position_at(detail, taken.timestamp(), config.PHOTO_TIME_TOLERANCE_S)
        if pos:
            lat, lon, source = pos[0], pos[1], "time_match"
    if lat is None:
        source = "none"
    cur = conn.execute(
        "INSERT INTO photos (hike_id, original_name, original_file, display_file, thumb_file, "
        "taken_at, lat, lon, position_source, file_hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (hike_id, filename, stored["original_file"], stored["display_file"], stored["thumb_file"],
         taken.isoformat().replace("+00:00", "Z") if taken else None, lat, lon, source, digest))
    return {"file": filename, "status": "ok", "id": cur.lastrowid, "position_source": source, "hike_id": hike_id}


def _basename(name):
    return (name or "photo.jpg").replace("\\", "/").rsplit("/", 1)[-1]


@app.post("/api/hikes/{hike_id}/photos")
async def upload_photos(hike_id: int, files: list[UploadFile] = File(...), offset_minutes: int = Form(0)):
    results = []
    with get_conn() as conn:
        row = conn.execute("SELECT track_detail FROM hikes WHERE id = ?", (hike_id,)).fetchone()
        if not row:
            raise HTTPException(404, "Sortie introuvable")
        detail = json.loads(row["track_detail"])
        for f in files:
            content = await f.read()
            try:
                results.append(_insert_photo(conn, hike_id, content, _basename(f.filename), detail, offset_minutes))
            except Exception as e:
                results.append({"file": f.filename, "status": "error", "message": f"Image illisible ({e})"})
    return results


def _ts(iso):
    return datetime.fromisoformat(iso.replace("Z", "+00:00")).timestamp() if iso else None


@app.post("/api/photos/auto")
async def auto_assign_photos(files: list[UploadFile] = File(...), offset_minutes: int = Form(0)):
    """Rattache chaque photo à la sortie correspondante : d'abord par l'heure de prise de vue,
    sinon par sa position GPS (trace à moins de 300 m). Sert à importer le dossier media/ de Strava."""
    tol = config.PHOTO_TIME_TOLERANCE_S
    results = []
    with get_conn() as conn:
        hikes = [{"id": h["id"], "name": h["name"], "t0": _ts(h["start_time"]), "t1": _ts(h["end_time"]),
                  "bbox": json.loads(h["bbox"]) if h["bbox"] else None, "detail_raw": h["track_detail"]}
                 for h in conn.execute("SELECT id, name, start_time, end_time, bbox, track_detail FROM hikes")]
        details = {}

        def detail_of(h):
            if h["id"] not in details:
                details[h["id"]] = json.loads(h["detail_raw"])
            return details[h["id"]]

        for f in files:
            content = await f.read()
            fname = _basename(f.filename)
            digest = hashlib.sha256(content).hexdigest()
            dup = conn.execute("SELECT hike_id FROM photos WHERE file_hash = ?", (digest,)).fetchone()
            if dup:
                results.append({"file": fname, "status": "duplicate", "hike_id": dup["hike_id"]})
                continue
            try:
                meta = peek_meta(content)
            except Exception as e:
                results.append({"file": fname, "status": "error", "message": f"Image illisible ({e})"})
                continue
            taken = meta["taken_at"].timestamp() + offset_minutes * 60 if meta["taken_at"] else None
            target, best = None, None
            if taken is not None:
                for h in hikes:
                    if h["t0"] is None or h["t1"] is None:
                        continue
                    gap = 0 if h["t0"] <= taken <= h["t1"] else min(abs(taken - h["t0"]), abs(taken - h["t1"]))
                    if gap <= tol and (best is None or gap < best):
                        target, best = h, gap
            if target is None and meta["lat"] is not None:
                for h in hikes:
                    b = h["bbox"]
                    if not b or not (b[0] - .01 <= meta["lon"] <= b[2] + .01 and b[1] - .01 <= meta["lat"] <= b[3] + .01):
                        continue
                    _, d = nearest_on_track(detail_of(h), meta["lat"], meta["lon"])
                    if d <= 300 and (best is None or d < best):
                        target, best = h, d
            if target is None:
                reason = ("sans date ni position" if taken is None and meta["lat"] is None
                          else "ne correspond à aucune sortie importée")
                results.append({"file": fname, "status": "unmatched", "message": reason})
                continue
            try:
                r = _insert_photo(conn, target["id"], content, fname, detail_of(target), offset_minutes, digest)
                r["hike_name"] = target["name"]
                results.append(r)
            except Exception as e:
                results.append({"file": fname, "status": "error", "message": f"Image illisible ({e})"})
    return results


class PhotoPatch(BaseModel):
    caption: Optional[str] = None
    lat: Optional[float] = None
    lon: Optional[float] = None


@app.patch("/api/photos/{photo_id}")
def patch_photo(photo_id: int, body: PhotoPatch):
    fields = body.model_dump(exclude_unset=True)
    with get_conn() as conn:
        row = conn.execute("SELECT p.*, h.track_detail FROM photos p JOIN hikes h ON h.id = p.hike_id "
                           "WHERE p.id = ?", (photo_id,)).fetchone()
        if not row:
            raise HTTPException(404, "Photo introuvable")
        if "caption" in fields:
            conn.execute("UPDATE photos SET caption = ? WHERE id = ?", ((fields["caption"] or "").strip(), photo_id))
        if "lat" in fields or "lon" in fields:
            lat, lon = fields.get("lat"), fields.get("lon")
            if lat is None or lon is None:
                conn.execute("UPDATE photos SET lat = NULL, lon = NULL, position_source = 'none' WHERE id = ?",
                             (photo_id,))
            else:
                snapped, d = nearest_on_track(json.loads(row["track_detail"]), lat, lon)
                if snapped and d <= config.PHOTO_SNAP_DISTANCE_M:
                    lat, lon = snapped
                conn.execute("UPDATE photos SET lat = ?, lon = ?, position_source = 'manual' WHERE id = ?",
                             (lat, lon, photo_id))
        return _photo_dict(conn.execute("SELECT * FROM photos WHERE id = ?", (photo_id,)).fetchone())


@app.delete("/api/photos/{photo_id}")
def delete_photo(photo_id: int):
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM photos WHERE id = ?", (photo_id,)).fetchone()
        if not row:
            raise HTTPException(404, "Photo introuvable")
        delete_photo_files(row)
        conn.execute("DELETE FROM photos WHERE id = ?", (photo_id,))
    return {"ok": True}


# ---------------------------------------------------------------- treks
def _gc_treks(conn):
    """Supprime les treks qui n'ont plus aucune étape."""
    conn.execute("DELETE FROM treks WHERE id NOT IN (SELECT trek_id FROM hikes WHERE trek_id IS NOT NULL)")


def _trek(conn, trek_id):
    row = conn.execute("SELECT id, name, notes FROM treks WHERE id = ?", (trek_id,)).fetchone()
    if not row:
        raise HTTPException(404, "Trek introuvable")
    return dict(row)


class TrekCreate(BaseModel):
    name: Optional[str] = None
    hike_ids: list[int]


class TrekPatch(BaseModel):
    name: Optional[str] = None
    notes: Optional[str] = None


class HikeIds(BaseModel):
    hike_ids: list[int]


def _set_trek(conn, trek_id, hike_ids):
    ids = [int(i) for i in hike_ids]
    if ids:
        conn.execute(f"UPDATE hikes SET trek_id = ? WHERE id IN ({','.join('?' * len(ids))})", (trek_id, *ids))


@app.get("/api/treks")
def list_treks():
    with get_conn() as conn:
        return [dict(r) for r in conn.execute("SELECT id, name, notes FROM treks ORDER BY id")]


@app.post("/api/treks")
def create_trek(body: TrekCreate):
    if not body.hike_ids:
        raise HTTPException(400, "Choisis au moins une sortie")
    with get_conn() as conn:
        cur = conn.execute("INSERT INTO treks (name) VALUES (?)", ((body.name or "").strip() or "Nouveau trek",))
        _set_trek(conn, cur.lastrowid, body.hike_ids)
        _gc_treks(conn)
        return _trek(conn, cur.lastrowid)


@app.patch("/api/treks/{trek_id}")
def patch_trek(trek_id: int, body: TrekPatch):
    fields = body.model_dump(exclude_unset=True)
    with get_conn() as conn:
        _trek(conn, trek_id)
        if "name" in fields:
            if not (fields["name"] or "").strip():
                raise HTTPException(400, "Le nom ne peut pas être vide")
            conn.execute("UPDATE treks SET name = ? WHERE id = ?", (fields["name"].strip(), trek_id))
        if "notes" in fields:
            conn.execute("UPDATE treks SET notes = ? WHERE id = ?", ((fields["notes"] or "").strip(), trek_id))
        return _trek(conn, trek_id)


@app.post("/api/treks/{trek_id}/add")
def add_to_trek(trek_id: int, body: HikeIds):
    with get_conn() as conn:
        _trek(conn, trek_id)
        _set_trek(conn, trek_id, body.hike_ids)
        _gc_treks(conn)
        return _trek(conn, trek_id)


@app.post("/api/treks/{trek_id}/remove")
def remove_from_trek(trek_id: int, body: HikeIds):
    with get_conn() as conn:
        ids = [int(i) for i in body.hike_ids]
        if ids:
            conn.execute(f"UPDATE hikes SET trek_id = NULL WHERE trek_id = ? AND id IN ({','.join('?' * len(ids))})",
                         (trek_id, *ids))
        _gc_treks(conn)
        exists = conn.execute("SELECT 1 FROM treks WHERE id = ?", (trek_id,)).fetchone()
        return {"ok": True, "trek_deleted": not exists}


@app.delete("/api/treks/{trek_id}")
def delete_trek(trek_id: int):
    """Dissout le trek : les étapes redeviennent des sorties indépendantes (rien n'est supprimé)."""
    with get_conn() as conn:
        conn.execute("UPDATE hikes SET trek_id = NULL WHERE trek_id = ?", (trek_id,))
        conn.execute("DELETE FROM treks WHERE id = ?", (trek_id,))
    return {"ok": True}


# ---------------------------------------------------------------- sommets & cols
KINDS = {"sommet", "col", "lieu"}   # lieu = endroit marquant (lac, cascade, refuge…)


def _summits(conn, where="", params=()):
    rows = conn.execute(f"SELECT s.*, h.name AS hike_name FROM summits s LEFT JOIN hikes h ON h.id = s.hike_id "
                        f"{where} ORDER BY s.date IS NULL, s.date DESC, s.id DESC", params).fetchall()
    photos = defaultdict(list)
    for p in conn.execute("SELECT * FROM summit_photos ORDER BY id"):
        photos[p["summit_id"]].append(p)
    people = defaultdict(list)
    for r in conn.execute("SELECT sp.summit_id, p.name FROM summit_people sp "
                          "JOIN people p ON p.id = sp.person_id ORDER BY p.name COLLATE NOCASE"):
        people[r[0]].append(r[1])
    out = []
    for r in rows:
        d = dict(r)
        d["people"] = people.get(r["id"], [])
        d["photos"] = [_photo_dict(p) for p in photos.get(r["id"], [])]
        first = d["photos"][0] if d["photos"] else None
        d["photo_url"] = first["url"] if first else None            # 1re photo (vignette de la liste)
        d["photo_thumb_url"] = first["thumb_url"] if first else None
        d["photo_original_url"] = first["original_url"] if first else None
        out.append(d)
    return out


def _summit(conn, summit_id):
    s = _summits(conn, "WHERE s.id = ?", (summit_id,))
    if not s:
        raise HTTPException(404, "Sommet introuvable")
    return s[0]


def _local_date(ts):
    if ts is None:
        return None
    return datetime.fromtimestamp(ts, ZoneInfo(config.LOCAL_TIMEZONE)).date().isoformat()


def _clean_date(v):
    v = (v or "").strip()[:10]
    if not v:
        return None
    try:
        return datetime.strptime(v, "%Y-%m-%d").date().isoformat()
    except ValueError:
        raise HTTPException(400, "Date invalide (format attendu : AAAA-MM-JJ)")


class SummitIn(BaseModel):
    name: Optional[str] = None
    kind: Optional[str] = "sommet"
    lat: Optional[float] = None
    lon: Optional[float] = None
    ele: Optional[float] = None
    date: Optional[str] = None
    hike_id: Optional[int] = None
    osm_id: Optional[str] = None
    notes: Optional[str] = None
    people: Optional[list[str]] = None


def _create_summit(conn, s: SummitIn):
    kind = s.kind if s.kind in KINDS else "sommet"
    name = (s.name or "").strip() or {"col": "Col sans nom", "lieu": "Lieu sans nom"}.get(kind, "Sommet sans nom")
    if s.hike_id is not None:
        if not conn.execute("SELECT 1 FROM hikes WHERE id = ?", (s.hike_id,)).fetchone():
            raise HTTPException(404, "Sortie introuvable")
        if s.osm_id:
            dup = conn.execute("SELECT id FROM summits WHERE hike_id = ? AND osm_id = ?", (s.hike_id, s.osm_id)).fetchone()
            if dup:
                return dup["id"], False
    cur = conn.execute(
        "INSERT INTO summits (name, kind, lat, lon, ele, date, hike_id, osm_id, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (name, kind, s.lat, s.lon, round(s.ele) if s.ele is not None else None, _clean_date(s.date),
         s.hike_id, s.osm_id, (s.notes or "").strip()))
    sid = cur.lastrowid
    people = s.people
    if people is None and s.hike_id is not None:  # par défaut : les compagnons de la sortie
        people = [r[0] for r in conn.execute("SELECT p.name FROM hike_people hp JOIN people p ON p.id = hp.person_id "
                                             "WHERE hp.hike_id = ?", (s.hike_id,))]
    if people:
        _assign_people(conn, "summit_people", "summit_id", sid, people)
    return sid, True


@app.get("/api/summits")
def list_summits():
    with get_conn() as conn:
        return _summits(conn)


@app.post("/api/summits")
def create_summit(body: SummitIn):
    with get_conn() as conn:
        sid, _ = _create_summit(conn, body)
        return _summit(conn, sid)


@app.post("/api/summits/batch")
def create_summits(body: list[SummitIn]):
    created = 0
    with get_conn() as conn:
        for s in body:
            _, new = _create_summit(conn, s)
            created += new
    return {"created": created}


@app.get("/api/summits/search")
def search_summits(q: str):
    if len(q.strip()) < 2:
        return []
    try:
        return osm.search(q.strip())
    except Exception as e:
        raise HTTPException(502, f"Recherche OpenStreetMap impossible (connexion internet ?) : {e}")


class SummitPatch(BaseModel):
    name: Optional[str] = None
    kind: Optional[str] = None
    lat: Optional[float] = None
    lon: Optional[float] = None
    ele: Optional[float] = None
    date: Optional[str] = None
    notes: Optional[str] = None
    hike_id: Optional[int] = None


@app.patch("/api/summits/{summit_id}")
def patch_summit(summit_id: int, body: SummitPatch):
    fields = body.model_dump(exclude_unset=True)
    with get_conn() as conn:
        _summit(conn, summit_id)
        sets, vals = [], []
        for k, v in fields.items():
            if k == "name":
                v = (v or "").strip()
                if not v:
                    raise HTTPException(400, "Le nom ne peut pas être vide")
            elif k == "kind" and v not in KINDS:
                continue
            elif k == "date":
                v = _clean_date(v)
            elif k == "notes":
                v = (v or "").strip()
            elif k == "ele" and v is not None:
                v = round(v)
            sets.append(f"{k} = ?")
            vals.append(v)
        if sets:
            conn.execute(f"UPDATE summits SET {', '.join(sets)} WHERE id = ?", (*vals, summit_id))
        return _summit(conn, summit_id)


@app.put("/api/summits/{summit_id}/people")
def set_summit_people(summit_id: int, body: PeoplePut):
    with get_conn() as conn:
        _summit(conn, summit_id)
        _assign_people(conn, "summit_people", "summit_id", summit_id, body.names)
        return _summit(conn, summit_id)


def _add_summit_photo(conn, summit_id, files):
    conn.execute("INSERT INTO summit_photos (summit_id, original_file, display_file, thumb_file) VALUES (?, ?, ?, ?)",
                 (summit_id, files["original_file"], files["display_file"], files["thumb_file"]))


@app.post("/api/summits/{summit_id}/photos")
async def upload_summit_photos(summit_id: int, files: list[UploadFile] = File(...)):
    """Ajoute une ou plusieurs photos à un sommet / col."""
    contents = [(await f.read(), _basename(f.filename)) for f in files]
    errors = []
    with get_conn() as conn:
        _summit(conn, summit_id)
        for content, name in contents:
            try:
                _meta, stored = process_photo(content, name, f"s{summit_id}")
            except Exception as e:
                errors.append(f"{name} : image illisible ({e})")
                continue
            _add_summit_photo(conn, summit_id, stored)
        s = _summit(conn, summit_id)
    s["errors"] = errors
    return s


@app.post("/api/summits/{summit_id}/photo/from/{photo_id}")
def summit_photo_from_hike(summit_id: int, photo_id: int):
    """Ajoute au sommet une photo de la sortie (copie)."""
    with get_conn() as conn:
        _summit(conn, summit_id)
        p = conn.execute("SELECT * FROM photos WHERE id = ?", (photo_id,)).fetchone()
        if not p:
            raise HTTPException(404, "Photo introuvable")
        _add_summit_photo(conn, summit_id, copy_photo_files(dict(p), f"s{summit_id}"))
        return _summit(conn, summit_id)


@app.delete("/api/summit-photos/{photo_id}")
def delete_summit_photo(photo_id: int):
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM summit_photos WHERE id = ?", (photo_id,)).fetchone()
        if not row:
            raise HTTPException(404, "Photo introuvable")
        delete_photo_files(row)
        conn.execute("DELETE FROM summit_photos WHERE id = ?", (photo_id,))
        return _summit(conn, row["summit_id"])


@app.delete("/api/summits/{summit_id}")
def delete_summit(summit_id: int):
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM summits WHERE id = ?", (summit_id,)).fetchone()
        if not row:
            raise HTTPException(404, "Sommet introuvable")
        for p in conn.execute("SELECT * FROM summit_photos WHERE summit_id = ?", (summit_id,)).fetchall():
            delete_photo_files(p)
        conn.execute("DELETE FROM summits WHERE id = ?", (summit_id,))
        conn.execute(PEOPLE_GC)
    return {"ok": True}


@app.get("/api/hikes/{hike_id}/summit-candidates")
def summit_candidates(hike_id: int):
    """Sommets et cols (OpenStreetMap) par lesquels passe la trace, + son point culminant."""
    with get_conn() as conn:
        row = conn.execute("SELECT name, bbox, track_detail FROM hikes WHERE id = ?", (hike_id,)).fetchone()
        if not row:
            raise HTTPException(404, "Sortie introuvable")
        existing = conn.execute("SELECT osm_id, lat, lon FROM summits WHERE hike_id = ?", (hike_id,)).fetchall()
    detail = json.loads(row["track_detail"])
    try:
        elements = osm.overpass_points(json.loads(row["bbox"]))
        osm_ok, osm_error = True, None
    except Exception as e:
        elements, osm_ok, osm_error = [], False, str(e)
    cands = osm.candidates_along(detail, elements)
    for c in cands:
        c["date"] = _local_date(c.pop("time"))
        c["hike_id"] = hike_id
        c["already"] = any((c["osm_id"] and e["osm_id"] == c["osm_id"]) or
                           (e["lat"] is not None and haversine(e["lat"], e["lon"], c["lat"], c["lon"]) < 60)
                           for e in existing)
    return {"hike_id": hike_id, "hike_name": row["name"], "candidates": cands, "osm_ok": osm_ok, "osm_error": osm_error}


# ---------------------------------------------------------------- fiche compagnon
def _year_of(iso_or_date):
    if not iso_or_date:
        return None
    if len(iso_or_date) == 10:          # date AAAA-MM-JJ (sommets)
        return int(iso_or_date[:4])
    return datetime.fromisoformat(iso_or_date.replace("Z", "+00:00")).astimezone(ZoneInfo(config.LOCAL_TIMEZONE)).year


def _person_row(conn, person_id):
    r = conn.execute("SELECT * FROM people WHERE id = ?", (person_id,)).fetchone()
    if not r:
        raise HTTPException(404, "Compagnon introuvable")
    return r


def _parse_years(years):
    if not years:
        return None
    out = set()
    for y in str(years).split(","):
        y = y.strip()
        if y.isdigit():
            out.add(int(y))
    return out or None


def _person_profile(conn, person_id, years=None):
    """Stats, sorties et lieux partagés avec un compagnon ; `years` = ensemble d'années (None = toutes)."""
    person = _person_dict(_person_row(conn, person_id))
    hikes = _summaries(conn, "WHERE id IN (SELECT hike_id FROM hike_people WHERE person_id = ?)", (person_id,))
    for h in hikes:
        h["year"] = _year_of(h["start_time"])
    shared_ids = {h["id"] for h in hikes}
    hike_year = {h["id"]: h["year"] for h in hikes}
    tagged = {r[0] for r in conn.execute("SELECT summit_id FROM summit_people WHERE person_id = ?", (person_id,))}
    places = [x for x in _summits(conn) if x["id"] in tagged or x["hike_id"] in shared_ids]
    for x in places:
        x["year"] = _year_of(x["date"]) or hike_year.get(x["hike_id"])
    available = sorted({h["year"] for h in hikes if h["year"]} | {x["year"] for x in places if x["year"]})
    sel = set(years) & set(available) if years else set(available)
    H = sorted([h for h in hikes if h["year"] in sel], key=lambda h: h["start_time"] or "")
    P = sorted([x for x in places if x["year"] in sel or (x["year"] is None and not years)],
               key=lambda x: (x["date"] or "", x["name"]))

    def totals(lst):
        maxes = [h["ele_max"] for h in lst if h["ele_max"] is not None]
        return {
            "count": len(lst),
            "distance_m": sum(h["distance_m"] or 0 for h in lst),
            "ele_gain": sum(h["ele_gain"] or 0 for h in lst),
            "moving_s": sum((h["moving_s"] if h["moving_s"] is not None else h["duration_s"]) or 0 for h in lst),
            "duration_s": sum(h["duration_s"] or 0 for h in lst),
            "ele_max": max(maxes) if maxes else None,
        }
    stats = totals(H)
    stats["first"] = H[0]["start_time"] if H else None
    stats["last"] = H[-1]["start_time"] if H else None
    stats["places"] = {k: sum(1 for x in P if x["kind"] == k) for k in ("sommet", "col", "lieu")}
    per_year = [{"year": y, **totals([h for h in H if h["year"] == y])} for y in sorted(sel)]
    keep = ("id", "name", "start_time", "distance_m", "ele_gain", "moving_s", "duration_s", "ele_max",
            "commune", "region", "country", "trek_id", "year")
    return {
        "person": person, "years_available": available, "years_selected": sorted(sel), "all_years": not years,
        "stats": stats, "per_year": per_year, "places": P,
        "hikes": [{k: h[k] for k in keep} for h in H],
    }


@app.get("/api/people/{person_id}/profile")
def person_profile(person_id: int, years: Optional[str] = None):
    with get_conn() as conn:
        return _person_profile(conn, person_id, _parse_years(years))


class PersonPatch(BaseModel):
    name: str


@app.patch("/api/people/{person_id}")
def rename_person(person_id: int, body: PersonPatch):
    name = " ".join((body.name or "").split())
    if not name:
        raise HTTPException(400, "Le nom ne peut pas être vide")
    with get_conn() as conn:
        _person_row(conn, person_id)
        other = conn.execute("SELECT id FROM people WHERE name = ? AND id != ?", (name, person_id)).fetchone()
        if other:
            raise HTTPException(400, f"« {name} » existe déjà")
        conn.execute("UPDATE people SET name = ? WHERE id = ?", (name, person_id))
        return _person_dict(_person_row(conn, person_id))


def _delete_person_photo_files(r):
    delete_photo_files({"original_file": r["photo_original"], "display_file": r["photo_display"], "thumb_file": r["photo_thumb"]})


@app.post("/api/people/{person_id}/photo")
async def upload_person_photo(person_id: int, file: UploadFile = File(...)):
    """Photo de profil : recadrée au carré (centre de l'image)."""
    content = await file.read()
    with get_conn() as conn:
        r = _person_row(conn, person_id)
        try:
            files = save_profile_photo(content, _basename(file.filename), f"people/{person_id}")
        except Exception as e:
            raise HTTPException(400, f"Image illisible ({e})")
        if r["photo_display"]:
            _delete_person_photo_files(r)
        conn.execute("UPDATE people SET photo_original = ?, photo_display = ?, photo_thumb = ? WHERE id = ?",
                     (files["original_file"], files["display_file"], files["thumb_file"], person_id))
        return _person_dict(_person_row(conn, person_id))


@app.delete("/api/people/{person_id}/photo")
def delete_person_photo(person_id: int):
    with get_conn() as conn:
        r = _person_row(conn, person_id)
        if r["photo_display"]:
            _delete_person_photo_files(r)
        conn.execute("UPDATE people SET photo_original = NULL, photo_display = NULL, photo_thumb = NULL WHERE id = ?",
                     (person_id,))
        return _person_dict(_person_row(conn, person_id))


@app.get("/api/people/{person_id}/report.pdf")
def person_report(person_id: int, years: Optional[str] = None):
    """Fiche compagnon en PDF : photo, statistiques, sommets / cols / lieux et sorties de la période."""
    from .report import build_person_report
    with get_conn() as conn:
        prof = _person_profile(conn, person_id, _parse_years(years))
        r = _person_row(conn, person_id)
    photo = config.PHOTO_DIR / r["photo_display"] if r["photo_display"] else None
    pdf = build_person_report(prof, photo)
    ys = prof["years_selected"]
    period = "toutes-annees" if prof["all_years"] or not ys else "-".join(map(str, ys))
    filename = f"compagnon-{_slug(prof['person']['name'])}-{period}.pdf"
    return Response(pdf, media_type="application/pdf",
                    headers={"Content-Disposition": f'attachment; filename="{filename}"'})
