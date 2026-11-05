"""Traitement des photos : lecture EXIF (date, GPS), miniatures, version d'affichage."""
import io
import math
import uuid
from datetime import datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

from PIL import Image, ImageOps

from .config import LOCAL_TIMEZONE, PHOTO_DIR, THUMB_DIR

try:  # photos HEIC/HEIF des iPhone
    from pillow_heif import register_heif_opener
    register_heif_opener()
except Exception:  # pragma: no cover
    pass

EXIF_IFD, GPS_IFD = 0x8769, 0x8825


def _f(x):
    try:
        return float(x)
    except Exception:
        return float("nan")


def _dms(value, ref):
    try:
        d, m, s = (_f(v) for v in value)
    except Exception:
        return None
    v = d + m / 60 + s / 3600
    if not math.isfinite(v):
        return None
    if isinstance(ref, bytes):
        ref = ref.decode(errors="ignore")
    if ref and str(ref).strip().upper() in ("S", "W"):
        v = -v
    return v


def read_exif(img):
    out = {"taken_at": None, "lat": None, "lon": None}
    try:
        exif = img.getexif()
    except Exception:
        return out
    try:
        sub = exif.get_ifd(EXIF_IFD)
    except Exception:
        sub = {}
    raw = sub.get(36867) or sub.get(36868) or exif.get(306)   # DateTimeOriginal / Digitized / DateTime
    offset = sub.get(36881) or sub.get(36880)                   # OffsetTimeOriginal / OffsetTime
    if raw:
        try:
            dt = datetime.strptime(str(raw).strip()[:19], "%Y:%m:%d %H:%M:%S")
            tz = None
            if offset:
                try:
                    tz = datetime.strptime(str(offset).strip(), "%z").tzinfo
                except ValueError:
                    tz = None
            out["taken_at"] = dt.replace(tzinfo=tz or ZoneInfo(LOCAL_TIMEZONE)).astimezone(timezone.utc)
        except Exception:
            pass
    try:
        gps = exif.get_ifd(GPS_IFD)
    except Exception:
        gps = {}
    if gps and 2 in gps and 4 in gps:
        lat, lon = _dms(gps[2], gps.get(1)), _dms(gps[4], gps.get(3))
        if (lat is not None and lon is not None and not (lat == 0 and lon == 0)
                and -90 <= lat <= 90 and -180 <= lon <= 180):
            out["lat"], out["lon"] = lat, lon
    return out


def peek_meta(content: bytes):
    """Date et position EXIF d'une image, sans rien enregistrer."""
    return read_exif(Image.open(io.BytesIO(content)))


def copy_photo_files(src: dict, folder: str):
    """Copie les fichiers d'une photo (original, affichage, miniature) dans un autre dossier."""
    import shutil
    stem = uuid.uuid4().hex[:16]
    files = {
        "original_file": f"originals/{folder}/{stem}{Path(src['original_file']).suffix}",
        "display_file": f"display/{folder}/{stem}.jpg",
        "thumb_file": f"{folder}/{stem}.jpg",
    }
    for base, key in ((PHOTO_DIR, "original_file"), (PHOTO_DIR, "display_file"), (THUMB_DIR, "thumb_file")):
        dst = base / files[key]
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(base / src[key], dst)
    return files


def process_photo(content: bytes, filename: str, hike_id):
    """Enregistre l'original + une version JPEG d'affichage + une miniature (dans le dossier `hike_id`)."""
    img = Image.open(io.BytesIO(content))
    meta = read_exif(img)
    try:
        img = ImageOps.exif_transpose(img)
    except Exception:
        pass
    if img.mode != "RGB":
        img = img.convert("RGB")

    stem = uuid.uuid4().hex[:16]
    ext = (Path(filename or "").suffix.lower() or ".jpg")[:6]
    files = {
        "original_file": f"originals/{hike_id}/{stem}{ext}",
        "display_file": f"display/{hike_id}/{stem}.jpg",
        "thumb_file": f"{hike_id}/{stem}.jpg",
    }
    orig = PHOTO_DIR / files["original_file"]
    disp = PHOTO_DIR / files["display_file"]
    thumb = THUMB_DIR / files["thumb_file"]
    for p in (orig, disp, thumb):
        p.parent.mkdir(parents=True, exist_ok=True)

    orig.write_bytes(content)
    d = img.copy()
    d.thumbnail((2048, 2048), Image.LANCZOS)
    d.save(disp, "JPEG", quality=86)
    t = img.copy()
    t.thumbnail((420, 420), Image.LANCZOS)
    t.save(thumb, "JPEG", quality=80)
    return meta, files


def delete_photo_files(row):
    for base, key in ((PHOTO_DIR, "original_file"), (PHOTO_DIR, "display_file"), (THUMB_DIR, "thumb_file")):
        if row[key]:
            try:
                (base / row[key]).unlink(missing_ok=True)
            except OSError:
                pass


def save_profile_photo(content: bytes, filename: str, folder: str):
    """Photo de profil : original conservé, versions carrées (centre de l'image) 600 px et 200 px."""
    img = Image.open(io.BytesIO(content))
    try:
        img = ImageOps.exif_transpose(img)
    except Exception:
        pass
    if img.mode != "RGB":
        img = img.convert("RGB")
    stem = uuid.uuid4().hex[:16]
    ext = (Path(filename or "").suffix.lower() or ".jpg")[:6]
    files = {
        "original_file": f"originals/{folder}/{stem}{ext}",
        "display_file": f"display/{folder}/{stem}.jpg",
        "thumb_file": f"{folder}/{stem}.jpg",
    }
    for base, key in ((PHOTO_DIR, "original_file"), (PHOTO_DIR, "display_file"), (THUMB_DIR, "thumb_file")):
        (base / files[key]).parent.mkdir(parents=True, exist_ok=True)
    (PHOTO_DIR / files["original_file"]).write_bytes(content)
    ImageOps.fit(img, (600, 600), Image.LANCZOS, centering=(0.5, 0.4)).save(PHOTO_DIR / files["display_file"], "JPEG", quality=88)
    ImageOps.fit(img, (200, 200), Image.LANCZOS, centering=(0.5, 0.4)).save(THUMB_DIR / files["thumb_file"], "JPEG", quality=85)
    return files
