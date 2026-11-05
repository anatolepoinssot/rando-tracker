"""Base SQLite : un seul fichier, data/randos.db."""
import sqlite3
from contextlib import contextmanager

from .config import DB_PATH

SCHEMA = """
CREATE TABLE IF NOT EXISTS hikes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    auto_name INTEGER DEFAULT 0,
    activity_type TEXT,
    start_time TEXT,
    end_time TEXT,
    gpx_file TEXT NOT NULL,
    file_hash TEXT UNIQUE,
    distance_m REAL, ele_gain REAL, ele_loss REAL, ele_max REAL, ele_min REAL,
    duration_s REAL, moving_s REAL, avg_hr REAL, max_hr REAL,
    start_lat REAL, start_lon REAL,
    bbox TEXT,
    commune TEXT, departement TEXT, region TEXT, country TEXT, massif TEXT,
    geocoded INTEGER DEFAULT 0,
    notes TEXT DEFAULT '',
    rating INTEGER,
    track_overview TEXT,
    track_detail TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_hikes_start ON hikes(start_time);

CREATE TABLE IF NOT EXISTS people (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL COLLATE NOCASE
);

CREATE TABLE IF NOT EXISTS hike_people (
    hike_id INTEGER NOT NULL REFERENCES hikes(id) ON DELETE CASCADE,
    person_id INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,
    PRIMARY KEY (hike_id, person_id)
);

CREATE TABLE IF NOT EXISTS photos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    hike_id INTEGER NOT NULL REFERENCES hikes(id) ON DELETE CASCADE,
    original_name TEXT,
    original_file TEXT,
    display_file TEXT,
    thumb_file TEXT,
    taken_at TEXT,
    lat REAL,
    lon REAL,
    position_source TEXT,
    caption TEXT DEFAULT '',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_photos_hike ON photos(hike_id);

CREATE TABLE IF NOT EXISTS treks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    notes TEXT DEFAULT '',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Un « sommet effectué » = un passage à un sommet ou un col, à une date (avec ou sans trace).
CREATE TABLE IF NOT EXISTS summits (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'sommet',          -- 'sommet' ou 'col'
    lat REAL, lon REAL, ele REAL,
    date TEXT,                                     -- AAAA-MM-JJ
    hike_id INTEGER REFERENCES hikes(id) ON DELETE SET NULL,
    osm_id TEXT,
    notes TEXT DEFAULT '',
    photo_original TEXT, photo_display TEXT, photo_thumb TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_summits_hike ON summits(hike_id);

CREATE TABLE IF NOT EXISTS summit_photos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    summit_id INTEGER NOT NULL REFERENCES summits(id) ON DELETE CASCADE,
    original_file TEXT, display_file TEXT, thumb_file TEXT,
    caption TEXT DEFAULT '',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_summit_photos ON summit_photos(summit_id);

CREATE TABLE IF NOT EXISTS summit_people (
    summit_id INTEGER NOT NULL REFERENCES summits(id) ON DELETE CASCADE,
    person_id INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,
    PRIMARY KEY (summit_id, person_id)
);
"""

# Supprime les personnes qui ne sont plus liées à aucune sortie ni aucun sommet.
PEOPLE_GC = ("DELETE FROM people WHERE id NOT IN "
             "(SELECT person_id FROM hike_people UNION SELECT person_id FROM summit_people)")


def _migrate(conn):
    """Met à niveau une base créée par une version précédente (ajout de colonnes)."""
    hike_cols = {r[1] for r in conn.execute("PRAGMA table_info(hikes)")}
    if "trek_id" not in hike_cols:
        conn.execute("ALTER TABLE hikes ADD COLUMN trek_id INTEGER REFERENCES treks(id) ON DELETE SET NULL")
    people_cols = {r[1] for r in conn.execute("PRAGMA table_info(people)")}
    for col in ("photo_original", "photo_display", "photo_thumb"):   # photo de profil des compagnons
        if col not in people_cols:
            conn.execute(f"ALTER TABLE people ADD COLUMN {col} TEXT")
    photo_cols = {r[1] for r in conn.execute("PRAGMA table_info(photos)")}
    if "file_hash" not in photo_cols:
        conn.execute("ALTER TABLE photos ADD COLUMN file_hash TEXT")
    # ancienne version : une seule photo par sommet, stockée dans la table summits → summit_photos
    conn.execute("""INSERT INTO summit_photos (summit_id, original_file, display_file, thumb_file)
                    SELECT id, photo_original, photo_display, photo_thumb FROM summits
                    WHERE photo_display IS NOT NULL""")
    conn.execute("UPDATE summits SET photo_original = NULL, photo_display = NULL, photo_thumb = NULL "
                 "WHERE photo_display IS NOT NULL")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_hikes_trek ON hikes(trek_id)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_photos_hash ON photos(file_hash)")


def connect() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH, timeout=15)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_db() -> None:
    conn = connect()
    try:
        conn.execute("PRAGMA journal_mode = WAL")
        conn.executescript(SCHEMA)
        _migrate(conn)
        conn.commit()
    finally:
        conn.close()


@contextmanager
def get_conn():
    conn = connect()
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()
