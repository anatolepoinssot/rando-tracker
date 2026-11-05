"""Configuration de Rando Tracker. Modifie ces valeurs si besoin."""
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BASE_DIR / "data"          # tout ce qui t'appartient est ici : à sauvegarder !
GPX_DIR = DATA_DIR / "gpx"
PHOTO_DIR = DATA_DIR / "photos"
THUMB_DIR = DATA_DIR / "thumbs"
STATIC_DIR = BASE_DIR / "static"
DB_PATH = DATA_DIR / "randos.db"

HOST = "127.0.0.1"
PORT = 8000

# Fuseau horaire utilisé pour les photos dont l'EXIF ne précise pas le décalage
# (et pour nommer automatiquement les sorties).
LOCAL_TIMEZONE = "Europe/Paris"
# Une photo prise jusqu'à X secondes avant/après la trace est placée au départ/à l'arrivée.
PHOTO_TIME_TOLERANCE_S = 20 * 60
# Une photo placée à la main est « aimantée » sur la trace si elle est à moins de X mètres.
PHOTO_SNAP_DISTANCE_M = 300

# Calcul du dénivelé : lissage (nb de points) + seuil d'hystérésis (m).
# L'altimètre barométrique d'une montre est propre : 3 m est un bon compromis.
ELEVATION_SMOOTHING_WINDOW = 5
ELEVATION_THRESHOLD_M = 3.0
# Vitesse 3D (m/s) en dessous de laquelle on considère qu'on est à l'arrêt.
MOVING_SPEED_THRESHOLD = 0.2

# Géocodage inverse (commune / département / région) via OpenStreetMap Nominatim.
GEOCODING_ENABLED = True

for _d in (GPX_DIR, PHOTO_DIR, THUMB_DIR):
    _d.mkdir(parents=True, exist_ok=True)
