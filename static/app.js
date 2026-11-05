'use strict';
/* =====================================================================
   Rando Tracker — interface
   ===================================================================== */

/* ---------------------------------------------------------- utilitaires */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nf0 = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const fmtKm = m => m == null ? '–' : nf1.format(m / 1000) + ' km';
const fmtM = m => m == null ? '–' : nf0.format(m) + ' m';
const fmtDur = s => {
  if (s == null) return '–';
  const tm = Math.round(s / 60), h = Math.floor(tm / 60), m = tm % 60;
  return h ? `${h} h ${String(m).padStart(2, '0')}` : `${m} min`;
};
const fmtHours = s => nf0.format(Math.round((s || 0) / 3600)) + ' h';
const fmtDate = iso => iso ? new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' }) : 'Date inconnue';
const fmtDateLong = iso => iso ? new Date(iso).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) : 'Date inconnue';
const fmtDateTime = iso => iso ? new Date(iso).toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' }) : '';
const speedKmh = h => (h.moving_s && h.distance_m) ? h.distance_m / h.moving_s * 3.6 : null;
const dt = h => new Date(h.start_time);
const MONTHS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
const WEEKDAYS = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'];
const SEASONS = ['Printemps', 'Été', 'Automne', 'Hiver'];
const seasonOf = d => { const m = d.getMonth(); return (m === 11 || m < 2) ? 'Hiver' : m < 5 ? 'Printemps' : m < 8 ? 'Été' : 'Automne'; };
const plural = (n, w) => `${nf0.format(n)} ${w}${n > 1 ? 's' : ''}`;
const css = v => getComputedStyle(document.documentElement).getPropertyValue(v).trim();

let toastTimer;
function toast(msg, ms = 3500) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), ms);
}

const api = {
  async req(method, url, body, isForm) {
    const opt = { method };
    if (body !== undefined) {
      if (isForm) opt.body = body;
      else { opt.body = JSON.stringify(body); opt.headers = { 'Content-Type': 'application/json' }; }
    }
    const r = await fetch(url, opt);
    if (!r.ok) {
      let msg = r.statusText;
      try { msg = (await r.json()).detail || msg; } catch (_) { /* ignore */ }
      throw new Error(msg);
    }
    return r.json();
  },
  get: url => api.req('GET', url),
  send: (m, url, body) => api.req(m, url, body),
  upload: (url, fd) => api.req('POST', url, fd, true),
};

/* ---------------------------------------------------------- état */
const EMPTY_FILTERS = { from: '', to: '', year: '', season: '', type: '', person: '', region: '', massif: '', distMin: '', distMax: '', gainMin: '', gainMax: '' };
const state = {
  hikes: [], tracks: {}, people: [], activityTypes: [],
  filtered: [], colors: {}, legend: null,
  filters: { ...EMPTY_FILTERS }, search: '',
  colorMode: 'year', basemap: 'ign-plan', view: 'map', terrainOn: true, sidebarCollapsed: false,
  selectedId: null, detail: null,
  placingPhotoId: null, lightboxIndex: null,
  tableSort: { k: 'date', dir: -1 },
  // treks
  treks: [], selectedTrekId: null, expandedTreks: new Set(), selecting: false, selected: new Set(),
  // sommets & cols
  summits: [], filteredSummits: [], mapMode: 'tracks', selectedSummitId: null, placingSummit: null,
  // compagnons
  personId: null, personYears: new Set(),
};
try {
  const saved = JSON.parse(localStorage.getItem('rando-prefs') || '{}');
  if (saved.colorMode) state.colorMode = saved.colorMode;
  if (saved.basemap) state.basemap = saved.basemap;
  if (saved.terrainOn === false) state.terrainOn = false;
  if (saved.sidebarCollapsed) state.sidebarCollapsed = true;
} catch (_) { /* ignore */ }
const savePrefs = () => {
  try {
    localStorage.setItem('rando-prefs', JSON.stringify({
      colorMode: state.colorMode, basemap: state.basemap, terrainOn: state.terrainOn, sidebarCollapsed: state.sidebarCollapsed,
    }));
  } catch (_) { /* ignore */ }
};

/* ---------------------------------------------------------- données */
async function loadAll({ fit = false } = {}) {
  const [hikes, tracks, people, meta, treks, summits] = await Promise.all([
    api.get('/api/hikes'), api.get('/api/tracks'), api.get('/api/people'), api.get('/api/meta'),
    api.get('/api/treks'), api.get('/api/summits'),
  ]);
  state.hikes = hikes; state.tracks = tracks; state.people = people; state.activityTypes = meta.activity_types;
  state.treks = treks; state.summits = summits;
  populateFilterOptions();
  applyFilters({ fit });
}

async function refreshHikes() {
  const [hikes, people, treks, summits] = await Promise.all([
    api.get('/api/hikes'), api.get('/api/people'), api.get('/api/treks'), api.get('/api/summits'),
  ]);
  state.hikes = hikes; state.people = people; state.treks = treks; state.summits = summits;
  populateFilterOptions();
  applyFilters();
  if (state.view === 'people') renderPeopleView();
}

function replaceHike(summary) {
  const i = state.hikes.findIndex(h => h.id === summary.id);
  if (i >= 0) state.hikes[i] = summary;
  if (state.detail && state.detail.kind === 'hike' && state.detail.id === summary.id) Object.assign(state.detail, summary);
  populateFilterOptions();
  applyFilters();
}

/* ---------------------------------------------------------- filtres */
function fillSelect(sel, options, allLabel) {
  const cur = sel.value;
  sel.innerHTML = `<option value="">${allLabel}</option>` +
    options.map(o => Array.isArray(o) ? `<option value="${esc(o[0])}">${esc(o[1])}</option>` : `<option value="${esc(o)}">${esc(o)}</option>`).join('');
  if ([...sel.options].some(o => o.value === cur)) sel.value = cur;
}

function populateFilterOptions() {
  const H = state.hikes;
  const uniq = arr => [...new Set(arr.filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b), 'fr'));
  const years = uniq(H.filter(h => h.start_time).map(h => dt(h).getFullYear())).reverse();
  fillSelect($('[data-filter=year]'), years.map(String), 'Toutes');
  fillSelect($('[data-filter=season]'), SEASONS, 'Toutes');
  fillSelect($('[data-filter=type]'), uniq(H.map(h => h.activity_type)), 'Toutes');
  fillSelect($('[data-filter=person]'), [['__solo__', 'Seul·e'], ...state.people.map(p => [p.name, `${p.name} (${p.hikes + (p.summits || 0)})`])], 'Tout le monde');
  fillSelect($('[data-filter=region]'), uniq(H.map(h => h.region)), 'Toutes');
  fillSelect($('[data-filter=massif]'), uniq(H.map(h => h.massif)), 'Tous');
  $('#people-list').innerHTML = state.people.map(p => `<option value="${esc(p.name)}">`).join('');
}

function passes(h) {
  const f = state.filters;
  const d = h.start_time ? dt(h) : null;
  if (f.from && (!d || d < new Date(f.from + 'T00:00:00'))) return false;
  if (f.to && (!d || d > new Date(f.to + 'T23:59:59'))) return false;
  if (f.year && (!d || d.getFullYear() !== +f.year)) return false;
  if (f.season && (!d || seasonOf(d) !== f.season)) return false;
  if (f.type && h.activity_type !== f.type) return false;
  if (f.person === '__solo__' && h.people.length) return false;
  if (f.person && f.person !== '__solo__' && !h.people.includes(f.person)) return false;
  if (f.region && h.region !== f.region) return false;
  if (f.massif && h.massif !== f.massif) return false;
  const km = (h.distance_m || 0) / 1000, g = h.ele_gain || 0;
  if (f.distMin !== '' && km < +f.distMin) return false;
  if (f.distMax !== '' && km > +f.distMax) return false;
  if (f.gainMin !== '' && g < +f.gainMin) return false;
  if (f.gainMax !== '' && g > +f.gainMax) return false;
  const q = state.search.trim().toLowerCase();
  if (q) {
    const trek = h.trek_id ? state.treks.find(t => t.id === h.trek_id) : null;
    const hay = [h.name, h.commune, h.departement, h.region, h.country, h.massif, h.notes, h.activity_type, trek ? trek.name : '', ...h.people].join(' ').toLowerCase();
    if (!q.split(/\s+/).every(w => hay.includes(w))) return false;
  }
  return true;
}

function applyFilters({ fit = false } = {}) {
  state.filtered = state.hikes.filter(passes);
  state.filteredSummits = state.summits.filter(passesSummit);
  const { colors, legend } = computeColors(state.filtered);
  state.colors = colors; state.legend = legend;
  const n = Object.entries(state.filters).filter(([, v]) => v !== '').length;
  $('#filter-count').hidden = !n;
  $('#filter-count').textContent = n;
  renderList();
  updateMapData(fit);
  renderSummitMarkers();
  $('#empty-state').hidden = state.hikes.length > 0;
  if (state.view === 'stats') renderStats();
}

/* ---------------------------------------------------------- couleurs */
const PALETTE = ['#e8590c', '#1c7ed6', '#2f9e44', '#ae3ec9', '#f08c00', '#0ca678', '#e03131', '#4263eb', '#74b816', '#d6336c', '#1098ad', '#7048e8'];
const RAMP = ['#2b8a3e', '#94d82d', '#ffd43b', '#ff922b', '#e03131'];
const hex2rgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
function rampColor(t) {
  t = Math.max(0, Math.min(1, t));
  const x = t * (RAMP.length - 1), i = Math.min(RAMP.length - 2, Math.floor(x)), f = x - i;
  const a = hex2rgb(RAMP[i]), b = hex2rgb(RAMP[i + 1]);
  return '#' + a.map((v, k) => Math.round(v + (b[k] - v) * f).toString(16).padStart(2, '0')).join('');
}
function computeColors(list) {
  const colors = {}; let legend = null;
  const mode = state.colorMode;
  if (!list.length) return { colors, legend };
  if (mode === 'year' || mode === 'type') {
    const keyOf = mode === 'year' ? h => h.start_time ? String(dt(h).getFullYear()) : '?' : h => h.activity_type || '?';
    const keys = [...new Set(list.map(keyOf))].sort();
    const cmap = {}; keys.forEach((k, i) => { cmap[k] = PALETTE[i % PALETTE.length]; });
    list.forEach(h => { colors[h.id] = cmap[keyOf(h)]; });
    legend = { type: 'cat', items: keys.map(k => [k, cmap[k]]) };
  } else if (mode === 'gain' || mode === 'distance') {
    const val = mode === 'gain' ? h => h.ele_gain || 0 : h => (h.distance_m || 0) / 1000;
    const vals = list.map(val), min = Math.min(...vals), max = Math.max(...vals);
    list.forEach(h => { colors[h.id] = rampColor(max > min ? (val(h) - min) / (max - min) : .5); });
    legend = { type: 'ramp', min, max, fmt: mode === 'gain' ? v => fmtM(v) + ' D+' : v => nf1.format(v) + ' km' };
  } else {
    list.forEach(h => { colors[h.id] = '#e8590c'; });
  }
  return { colors, legend };
}
function renderLegend() {
  const L = state.legend, el = $('#legend');
  if (!L) { el.innerHTML = ''; return; }
  if (L.type === 'cat') {
    el.innerHTML = `<div class="items">${L.items.slice(0, 16).map(([k, c]) => `<span class="item"><span class="sw" style="background:${c}"></span>${esc(k)}</span>`).join('')}</div>`;
  } else {
    el.innerHTML = `<div class="ramp" style="background:linear-gradient(90deg,${RAMP.join(',')})"></div>
      <div class="ramp-labels"><span>${L.fmt(L.min)}</span><span>${L.fmt(L.max)}</span></div>`;
  }
}

/* ---------------------------------------------------------- liste */
function hikeRowHtml(h, { stage = 0 } = {}) {
  const cls = [h.id === state.selectedId ? 'active' : '', stage ? 'stage' : '', state.selected.has(h.id) ? 'checked' : ''].join(' ');
  return `
    <li data-id="${h.id}" class="${cls}" style="--c:${state.colors[h.id] || ''}">
      ${state.selecting ? '<span class="check" aria-hidden="true"></span>' : ''}
      <div class="li-title">${stage ? `<span class="stage-n">J${stage}</span>` : ''}${esc(h.name)}</div>
      <div class="li-meta">${fmtDate(h.start_time)}${h.commune ? ' · ' + esc(h.commune) : ''}</div>
      <div class="li-stats">
        <span>${fmtKm(h.distance_m)}</span><span>${fmtM(h.ele_gain)} D+</span><span>${fmtDur(h.moving_s ?? h.duration_s)}</span>
        ${h.photo_count ? `<span class="pill">${plural(h.photo_count, 'photo')}</span>` : ''}
        ${h.people.length ? `<span class="pill" title="${esc(h.people.join(', '))}">${h.people.length} pers.</span>` : ''}
      </div>
    </li>`;
}

function renderList() {
  const tracksMode = state.mapMode === 'tracks';
  $('#list-tools-tracks').hidden = !tracksMode;
  $('#list-tools-summits').hidden = tracksMode;
  if (!tracksMode) { renderSummitList(); renderSelectBar(); return; }
  const L = state.filtered;
  const dist = L.reduce((a, h) => a + (h.distance_m || 0), 0), gain = L.reduce((a, h) => a + (h.ele_gain || 0), 0);
  $('#list-summary').textContent = `${plural(L.length, 'sortie')} · ${fmtKm(dist)} · ${fmtM(gain)} D+`;
  $('#hike-list').classList.toggle('selecting', state.selecting);
  renderSelectBar();
  if (!L.length) {
    $('#hike-list').innerHTML = `<li class="list-empty">${state.hikes.length ? 'Aucune sortie ne correspond aux filtres.' : 'Importe tes premiers GPX pour commencer.'}</li>`;
    return;
  }
  // les étapes d'un même trek sont regroupées sous une seule ligne (dépliable)
  const html = [], seen = new Set();
  for (const h of L) {
    const trek = h.trek_id ? state.treks.find(t => t.id === h.trek_id) : null;
    if (!trek) { html.push(hikeRowHtml(h)); continue; }
    if (seen.has(trek.id)) continue;
    seen.add(trek.id);
    html.push(trekRowHtml(trek, L.filter(x => x.trek_id === trek.id)));
  }
  $('#hike-list').innerHTML = html.join('');
}

/* ---------------------------------------------------------- carte */
const IGN = layer => `https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=${layer}&STYLE=normal&TILEMATRIXSET=PM&TILEMATRIX={z}&TILECOL={x}&TILEROW={y}`;
const BASEMAPS = {
  'ign-plan': { label: 'IGN Plan (France)', tiles: [IGN('GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2') + '&FORMAT=image/png'], maxzoom: 18, attribution: '© IGN – Géoplateforme', hillshade: true },
  'ign-ortho': { label: 'IGN Photos aériennes (France)', tiles: [IGN('ORTHOIMAGERY.ORTHOPHOTOS') + '&FORMAT=image/jpeg'], maxzoom: 19, attribution: '© IGN – Géoplateforme', hillshade: false },
  'otm': { label: 'OpenTopoMap (monde)', tiles: ['a', 'b', 'c'].map(s => `https://${s}.tile.opentopomap.org/{z}/{x}/{y}.png`), maxzoom: 17, attribution: '© OpenStreetMap, SRTM · © OpenTopoMap (CC-BY-SA)', hillshade: false },
  'esri': { label: 'Satellite (monde)', tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'], maxzoom: 18, attribution: 'Imagerie © Esri, Maxar, Earthstar Geographics', hillshade: false },
};
const TERRAIN_TILES = ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'];
const EXAGGERATION = 1.4;
const MAX_PITCH = 80;
let map, mapReady = false, photoMarkers = [], cursorMarker = null;
const emptyFC = () => ({ type: 'FeatureCollection', features: [] });

/* ---------------------------------------------------------- passage progressif 3D → 2D
   L'échelle (en bas à droite) mesure SCALE_MAX_WIDTH px et affiche une valeur « ronde » :
   « 30 km » tant que ces px couvrent entre 30 et 50 km, « 50 km » entre 50 et 100 km.
   La transition commence au milieu de la plage « 30 km » (√(30·50) ≈ 38,7 km)
   et se termine au milieu de la plage « 50 km » (√(50·100) ≈ 70,7 km) — milieux pris en zoom,
   donc en échelle logarithmique. Entre les deux, l'inclinaison et le relief diminuent ensemble. */
const SCALE_MAX_WIDTH = 100;
const DEPTH_START_KM = Math.sqrt(30 * 50);
const DEPTH_END_KM = Math.sqrt(50 * 100);
const depth = { userPitch: 50, lastRequested: NaN, lastOutput: 0 };

/** Distance (km) couverte par SCALE_MAX_WIDTH px au centre de la carte, comme le calcule l'échelle. */
function scaleKm(zoom, lat) {
  const metersPerPx = (2 * Math.PI * 6371008.8 * Math.cos(lat * Math.PI / 180)) / (512 * 2 ** zoom);
  return metersPerPx * SCALE_MAX_WIDTH / 1000;
}
/** 0 = pleine 3D, 1 = 2D. */
function flatness(zoom, lat) {
  const x = (Math.log(scaleKm(zoom, lat)) - Math.log(DEPTH_START_KM)) / (Math.log(DEPTH_END_KM) - Math.log(DEPTH_START_KM));
  const c = Math.min(1, Math.max(0, x));
  return c * c * (3 - 2 * c);   // départ et arrivée en douceur
}
/** Appelé par MapLibre avant chaque image : l'inclinaison voulue est multipliée par (1 − aplatissement).
    On mémorise l'inclinaison « voulue » pour la retrouver en rezoomant. */
function depthCameraHook(tr) {
  const f = 1 - flatness(tr.zoom, tr.center.lat);
  // L'inclinaison demandée a changé, et ce n'est pas simplement notre propre valeur reprise par MapLibre :
  // c'est un geste (Ctrl/clic droit + glisser) ou une animation → nouvelle inclinaison « voulue ».
  const changed = Math.abs(tr.pitch - depth.lastRequested) > 1e-6 && Math.abs(tr.pitch - depth.lastOutput) > 1e-6;
  if (changed && f > 0.02) depth.userPitch = Math.min(MAX_PITCH, Math.max(0, tr.pitch / f));
  depth.lastRequested = tr.pitch;
  depth.lastOutput = depth.userPitch * f;
  return { pitch: depth.lastOutput };
}
/** Le relief s'aplatit en même temps (exagération → 0 en 2D).
    Pendant un mouvement, on ne fait que changer son exagération ; il n'est créé ou supprimé (pour alléger
    la vue 2D lointaine) que lorsque la carte est immobile. Appliqué à l'image suivante, hors du rendu. */
let terrainFrame = null;
function scheduleTerrainDepth() {
  if (terrainFrame === null) terrainFrame = requestAnimationFrame(() => { terrainFrame = null; applyTerrainDepth(); });
}
function applyTerrainDepth() {
  if (!mapReady) return;
  const f = 1 - flatness(map.getZoom(), map.getCenter().lat);
  const ex = EXAGGERATION * f;
  const idle = !map.isMoving();
  if (!state.terrainOn) {
    if (map.terrain) map.setTerrain(null);
  } else if (!map.terrain) {
    if (idle && ex >= 0.02) map.setTerrain({ source: 'dem', exaggeration: ex });
  } else if (idle && ex < 0.02) {
    map.setTerrain(null);
  } else if (Math.abs(map.terrain.exaggeration - ex) > 0.002) {
    map.terrain.exaggeration = ex;   // mise à jour en continu, sans recréer le relief
    try {
      map.transform.elevation = map.terrain.getElevationForLngLatZoom(map.transform.center, map.transform.tileZoom);
    } catch (_) { /* ignore */ }
    map.triggerRepaint();
  }
}
/** Avant une animation vers une vue proche : prépare le relief (à plat) pour qu'il se lève pendant le vol. */
function prepareTerrainForFlight() {
  if (mapReady && state.terrainOn && !map.terrain && !map.isMoving()) {
    map.setTerrain({ source: 'dem', exaggeration: Math.max(0.001, EXAGGERATION * (1 - flatness(map.getZoom(), map.getCenter().lat))) });
  }
}
/** Bouton « relief 3D » (remplace celui de MapLibre pour cohabiter avec le passage en 2D). */
class TerrainToggle {
  onAdd() {
    this._c = document.createElement('div');
    this._c.className = 'maplibregl-ctrl maplibregl-ctrl-group';
    this._b = document.createElement('button');
    this._b.type = 'button';
    this._b.innerHTML = '<span class="maplibregl-ctrl-icon" aria-hidden="true"></span>';
    this._b.onclick = () => { state.terrainOn = !state.terrainOn; savePrefs(); this._sync(); applyTerrainDepth(); };
    this._c.append(this._b);
    this._sync();
    return this._c;
  }
  _sync() {
    this._b.className = 'maplibregl-ctrl-terrain' + (state.terrainOn ? ' maplibregl-ctrl-terrain-enabled' : '');
    this._b.title = state.terrainOn ? 'Désactiver le relief 3D' : 'Activer le relief 3D';
  }
  onRemove() { this._c.remove(); }
}

function initMap() {
  if (!BASEMAPS[state.basemap]) state.basemap = 'ign-plan';
  const style = { version: 8, sources: {}, layers: [] };
  for (const [k, b] of Object.entries(BASEMAPS)) {
    style.sources['bm-' + k] = { type: 'raster', tiles: b.tiles, tileSize: 256, maxzoom: b.maxzoom, attribution: b.attribution };
    style.layers.push({ id: 'bm-' + k, type: 'raster', source: 'bm-' + k, layout: { visibility: k === state.basemap ? 'visible' : 'none' } });
  }
  const dem = { type: 'raster-dem', tiles: TERRAIN_TILES, tileSize: 256, maxzoom: 15, encoding: 'terrarium', attribution: 'Relief : Mapzen / AWS Terrain Tiles' };
  style.sources.dem = dem;
  style.sources.hs = { ...dem };
  style.layers.push({
    id: 'hillshade', type: 'hillshade', source: 'hs',
    layout: { visibility: BASEMAPS[state.basemap].hillshade ? 'visible' : 'none' },
    paint: { 'hillshade-exaggeration': 0.3, 'hillshade-shadow-color': '#33403a' },
  });
  map = new maplibregl.Map({
    container: 'map', style, center: [2.6, 46.4], zoom: 5, pitch: 0, maxPitch: MAX_PITCH,
    attributionControl: { compact: true },
    transformCameraUpdate: depthCameraHook,   // inclinaison progressive selon le zoom (voir plus bas)
  });
  map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right');
  map.addControl(new TerrainToggle(), 'top-right');
  map.addControl(new maplibregl.ScaleControl({ unit: 'metric', maxWidth: SCALE_MAX_WIDTH }), 'bottom-right');
  map.on('move', scheduleTerrainDepth);
  map.on('moveend', scheduleTerrainDepth);

  map.on('load', () => {
    map.addSource('tracks', { type: 'geojson', data: emptyFC() });
    map.addSource('starts', { type: 'geojson', data: emptyFC() });
    map.addSource('selected', { type: 'geojson', data: emptyFC() });
    const width = (a, b) => ['interpolate', ['linear'], ['zoom'], 6, a, 14, b];
    const round = { 'line-join': 'round', 'line-cap': 'round' };
    map.addLayer({ id: 'tracks-casing', type: 'line', source: 'tracks', layout: round, paint: { 'line-color': '#ffffff', 'line-width': width(2.5, 7), 'line-opacity': 0.85 } });
    map.addLayer({ id: 'tracks-line', type: 'line', source: 'tracks', layout: round, paint: { 'line-color': ['get', 'color'], 'line-width': width(1.2, 4) } });
    map.addLayer({ id: 'selected-casing', type: 'line', source: 'selected', layout: round, paint: { 'line-color': '#ffffff', 'line-width': width(5, 11) } });
    map.addLayer({ id: 'selected-line', type: 'line', source: 'selected', layout: round, paint: { 'line-color': '#ff2d55', 'line-width': width(3, 6) } });
    map.addLayer({
      id: 'starts', type: 'circle', source: 'starts', maxzoom: 10,
      paint: { 'circle-radius': 5, 'circle-color': ['get', 'color'], 'circle-stroke-color': '#fff', 'circle-stroke-width': 1.5 },
    });
    mapReady = true;
    applyTerrainDepth();
    updateMapData(true);
  });

  map.on('click', onMapClick);
  map.on('mousemove', e => {
    if (state.placingPhotoId || state.placingPhotoIds || state.placingSummit) { map.getCanvas().style.cursor = 'crosshair'; return; }
    if (state.mapMode !== 'tracks') { map.getCanvas().style.cursor = ''; return; }
    const f = hitTrack(e.point);
    map.getCanvas().style.cursor = f ? 'pointer' : '';
  });
  ['mousedown', 'wheel', 'touchstart'].forEach(ev => map.on(ev, e => { if (fly && e.originalEvent) stopFlyover(); }));
}

function hitTrack(pt) {
  if (!mapReady) return null;
  const p = 6;
  const feats = map.queryRenderedFeatures([[pt.x - p, pt.y - p], [pt.x + p, pt.y + p]], { layers: ['tracks-casing', 'starts'] });
  return feats[0] || null;
}

async function onMapClick(e) {
  if (state.placingPhotoIds) {   // plusieurs photos au même point
    const ids = state.placingPhotoIds;
    cancelPlacing();
    try {
      for (const id of ids) {
        const p = await api.send('PATCH', `/api/photos/${id}`, { lat: e.lngLat.lat, lon: e.lngLat.lng });
        const i = state.detail.photos.findIndex(x => x.id === id);
        if (i >= 0) state.detail.photos[i] = p;
      }
      renderPhotoMarkers(); renderGallery();
      toast(`${plural(ids.length, 'photo')} placée${ids.length > 1 ? 's' : ''} au même endroit`);
    } catch (err) { toast('Erreur : ' + err.message); }
    return;
  }
  if (state.placingPhotoId) {
    const id = state.placingPhotoId;
    cancelPlacing();
    try {
      const p = await api.send('PATCH', `/api/photos/${id}`, { lat: e.lngLat.lat, lon: e.lngLat.lng });
      const i = state.detail.photos.findIndex(x => x.id === id);
      if (i >= 0) state.detail.photos[i] = p;
      renderPhotoMarkers(); renderGallery();
      toast('Photo placée');
    } catch (err) { toast('Erreur : ' + err.message); }
    return;
  }
  if (state.placingSummit) { placeSummitAt(e.lngLat); return; }
  if (state.mapMode !== 'tracks') return;
  const f = hitTrack(e.point);
  if (f) selectHike(+f.properties.id);
}

function setBasemap(k) {
  state.basemap = k; savePrefs();
  if (!map) return;
  for (const key of Object.keys(BASEMAPS)) map.setLayoutProperty('bm-' + key, 'visibility', key === k ? 'visible' : 'none');
  map.setLayoutProperty('hillshade', 'visibility', BASEMAPS[k].hillshade ? 'visible' : 'none');
}

function updateMapData(fit) {
  renderLegend();
  if (!mapReady) return;
  const lines = [], starts = [];
  for (const h of state.filtered) {
    const tr = state.tracks[h.id];
    if (!tr || tr.length < 2) continue;
    const props = { id: h.id, color: state.colors[h.id] || '#e8590c' };
    lines.push({ type: 'Feature', properties: props, geometry: { type: 'LineString', coordinates: tr } });
    starts.push({ type: 'Feature', properties: props, geometry: { type: 'Point', coordinates: tr[0] } });
  }
  map.getSource('tracks').setData({ type: 'FeatureCollection', features: lines });
  map.getSource('starts').setData({ type: 'FeatureCollection', features: starts });
  const vis = state.mapMode === 'tracks' ? 'visible' : 'none';
  for (const l of ['tracks-casing', 'tracks-line', 'starts', 'selected-casing', 'selected-line']) {
    if (map.getLayoutProperty(l, 'visibility') !== vis) map.setLayoutProperty(l, 'visibility', vis);
  }
  if (fit) {
    if (state.mapMode === 'tracks') fitToHikes(state.filtered);
    else fitToSummits(state.filteredSummits);
  }
}

/** Trace(s) mises en évidence sur la carte (une sortie, ou toutes les étapes d'un trek). */
function setSelectedLines(tracks) {
  if (!mapReady) return;
  map.getSource('selected').setData({
    type: 'Feature', properties: {},
    geometry: { type: 'MultiLineString', coordinates: tracks.map(tr => tr.map(p => [p[0], p[1]])) },
  });
}

function boundsOf(list) {
  const bb = list.map(h => h.bbox).filter(Boolean);
  if (!bb.length) return null;
  return [[Math.min(...bb.map(b => b[0])), Math.min(...bb.map(b => b[1]))], [Math.max(...bb.map(b => b[2])), Math.max(...bb.map(b => b[3]))]];
}

function flyToBounds(b, { pitch = 50, rightPad = 60, duration = 1600 } = {}) {
  if (!b || !map) return;
  const cam = map.cameraForBounds(b, { padding: { top: 70, bottom: 70, left: 70, right: rightPad } });
  if (!cam) return;
  prepareTerrainForFlight();
  map.flyTo({ ...cam, zoom: Math.min(cam.zoom, 15), pitch, bearing: map.getBearing(), duration, essential: true });
}

function fitToHikes(list) { if (list.length) flyToBounds(boundsOf(list), { pitch: 40, duration: 1200 }); }

/* ---------------------------------------------------------- fiche détaillée */
async function selectHike(id, { fly: doFly = true } = {}) {
  if (state.view !== 'map') switchView('map');
  if (state.mapMode !== 'tracks') setMapMode('tracks', { keepDetail: true });
  stopFlyover();
  state.selectedId = id; state.selectedTrekId = null; state.selectedSummitId = null; state.multiPick = null;
  const h = state.hikes.find(x => x.id === id);
  if (h && h.trek_id && !state.expandedTreks.has(h.trek_id)) { state.expandedTreks.add(h.trek_id); renderList(); }
  $$('#hike-list li').forEach(li => li.classList.toggle('active', +li.dataset.id === id));
  let d;
  try { d = await api.get(`/api/hikes/${id}`); } catch (err) { toast('Erreur : ' + err.message); return; }
  if (state.selectedId !== id) return;
  d.kind = 'hike';
  state.detail = d;
  setSelectedLines([d.track]);
  renderDetail();
  renderPhotoMarkers();
  if (doFly && d.bbox) {
    const rightPad = window.innerWidth > 720 ? $('#detail').offsetWidth + 40 : 60;
    flyToBounds([[d.bbox[0], d.bbox[1]], [d.bbox[2], d.bbox[3]]], { pitch: 60, rightPad });
  }
  const li = $(`#hike-list li[data-id="${id}"]`);
  if (li) li.scrollIntoView({ block: 'nearest' });
}

function closeDetail() {
  stopFlyover();
  state.selectedId = null; state.detail = null; state.selectedTrekId = null; state.selectedSummitId = null; state.multiPick = null;
  $('#detail').hidden = true;
  if (mapReady) map.getSource('selected').setData(emptyFC());
  clearPhotoMarkers(); hideCursor(); cancelPlacing(); cancelSummitPlacing();
  $$('#hike-list li.active').forEach(li => li.classList.remove('active'));
  $$('.summit-marker.active').forEach(m => m.classList.remove('active'));
  if (profileChart) { profileChart.dispose(); profileChart = null; }
}

/** Lien vers le trek (dans la fiche d'une étape). */
function trekLineHtml(d) {
  const trek = d.trek_id ? state.treks.find(t => t.id === d.trek_id) : null;
  if (!trek) return '';
  const stages = trekStages(trek.id);
  const n = stages.findIndex(s => s.id === d.id) + 1;
  return `<div class="trek-line">Étape ${n}/${stages.length} du trek
    <button class="linklike" id="d-open-trek">${esc(trek.name)}</button> ·
    <button class="linklike muted" id="d-leave-trek">retirer du trek</button></div>`;
}

/** Section « Sommets & cols » d'une sortie. */
function hikeSummitsHtml(d) {
  const list = state.summits.filter(s => s.hike_id === d.id);
  return `<h4>Sommets & cols</h4>
    <div class="summit-chips">${list.length ? list.map(s => `
      <button class="summit-chip kind-${s.kind}" data-summit="${s.id}"><span class="sm-icon"></span>${esc(s.name)}${s.ele != null ? ` <b>${fmtM(s.ele)}</b>` : ''}</button>`).join('')
      : '<span class="hint">Aucun pour l’instant.</span>'}</div>
    <button class="btn small" id="d-detect">Détecter les sommets et cols de la trace</button>`;
}

let profileChart = null;
function renderDetail() {
  const d = state.detail, el = $('#detail');
  el.hidden = false;
  const loc = [d.commune, d.departement, d.region, d.country !== 'France' ? d.country : null].filter(Boolean).join(' · ');
  const types = [...new Set([...state.activityTypes, d.activity_type].filter(Boolean))];
  const stats = [
    ['Distance', fmtKm(d.distance_m)], ['Dénivelé +', fmtM(d.ele_gain)], ['Dénivelé −', fmtM(d.ele_loss)],
    ['Durée totale', fmtDur(d.duration_s)], ['En mouvement', fmtDur(d.moving_s)],
    ['Vitesse moy.', speedKmh(d) ? nf1.format(speedKmh(d)) + ' km/h' : '–'],
    ['Altitude max', fmtM(d.ele_max)], ['Altitude min', fmtM(d.ele_min)],
    ['D+ / heure', d.moving_s && d.ele_gain ? nf0.format(d.ele_gain / (d.moving_s / 3600)) + ' m/h' : '–'],
  ];
  if (d.avg_hr) stats.push(['FC moyenne', nf0.format(d.avg_hr) + ' bpm'], ['FC max', nf0.format(d.max_hr) + ' bpm']);

  el.innerHTML = `
    <div class="detail-head">
      <input type="text" class="title-input" id="d-name" value="${esc(d.name)}" title="Cliquer pour renommer">
      <button class="icon-btn" id="d-close" title="Fermer">×</button>
    </div>
    <div class="detail-sub">
      <span>${esc(fmtDateLong(d.start_time))}</span>
      <select id="d-type">${types.map(t => `<option ${t === d.activity_type ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select>
    </div>
    ${trekLineHtml(d)}
    <div class="detail-loc">
      <span>${loc ? esc(loc) : (d.geocoded === 0 ? 'Recherche du lieu…' : 'Lieu non renseigné')}${d.massif ? ' · <b>' + esc(d.massif) + '</b>' : ''}</span>
      <button class="linklike" id="d-loc-toggle">Modifier</button>
    </div>
    <div class="loc-form" id="d-loc-form" hidden>
      ${[['massif', 'Massif'], ['commune', 'Commune'], ['departement', 'Département'], ['region', 'Région'], ['country', 'Pays']]
        .map(([k, l]) => `<label>${l}<input type="text" data-loc="${k}" value="${esc(d[k] || '')}"></label>`).join('')}
    </div>
    <div class="stat-grid">${stats.map(([l, v]) => `<div class="stat"><div class="v">${v}</div><div class="l">${l}</div></div>`).join('')}</div>
    <div class="detail-actions">
      <button class="btn primary small" id="d-fly">▶ Survol 3D</button>
      <button class="btn small" id="d-recenter">Recentrer</button>
      <a class="btn small" href="/api/hikes/${d.id}/gpx">Télécharger le GPX</a>
    </div>

    <h4>Profil altimétrique</h4>
    <div class="profile" id="d-profile"></div>

    <h4>Compagnons</h4>
    <div class="chips" id="d-people"></div>
    <input type="text" id="d-person-input" list="people-list" placeholder="Ajouter une personne (Entrée pour valider)">

    <h4>Ma note</h4>
    <div class="stars" id="d-stars">${[1, 2, 3, 4, 5].map(i => `<button data-v="${i}" class="${d.rating >= i ? 'on' : ''}" title="${i}/5">★</button>`).join('')}</div>

    ${hikeSummitsHtml(d)}

    <h4>Photos <span id="d-photo-count"></span></h4>
    <label class="dropzone" id="d-drop">
      Glisse tes photos ici ou clique pour les choisir<br><small>JPEG, PNG, HEIC — placées automatiquement sur la trace</small>
      <input type="file" id="d-photo-input" accept="image/*,.heic,.heif" multiple hidden>
    </label>
    <div class="clock-offset" title="Si l'horloge de ton appareil photo était décalée par rapport à la montre">
      Décalage de l'horloge de l'appareil :
      <input type="number" id="d-offset" value="0" step="1"> min
    </div>
    <div class="gallery" id="d-gallery"></div>

    <h4>Notes & souvenirs</h4>
    <textarea id="d-notes" placeholder="Conditions, ressenti, refuges, faune croisée…">${esc(d.notes || '')}</textarea>

    <div class="danger-zone"><button class="btn small danger" id="d-delete">Supprimer cette sortie</button></div>
  `;

  $('#d-close').onclick = closeDetail;
  el.onscroll = () => $('.detail-head', el).classList.toggle('scrolled', el.scrollTop > 2);
  $('#d-name').onchange = e => patchHike(d.id, { name: e.target.value });
  $('#d-name').onkeydown = e => { if (e.key === 'Enter') e.target.blur(); };
  $('#d-type').onchange = e => patchHike(d.id, { activity_type: e.target.value });
  $('#d-loc-toggle').onclick = () => { $('#d-loc-form').hidden = !$('#d-loc-form').hidden; };
  $$('[data-loc]', el).forEach(inp => { inp.onchange = () => patchHike(d.id, { [inp.dataset.loc]: inp.value }, { rerender: true }); });
  $('#d-fly').onclick = () => startFlyover(d.track, d.photos);
  $('#d-recenter').onclick = () => flyToBounds([[d.bbox[0], d.bbox[1]], [d.bbox[2], d.bbox[3]]], { pitch: 60, rightPad: $('#detail').offsetWidth + 40 });
  if ($('#d-open-trek')) $('#d-open-trek').onclick = () => selectTrek(d.trek_id);
  if ($('#d-leave-trek')) $('#d-leave-trek').onclick = () => removeFromTrek(d.trek_id, [d.id]);
  $$('[data-summit]', el).forEach(b => { b.onclick = () => selectSummit(+b.dataset.summit); });
  $('#d-detect').onclick = () => runDetection([d.id]);
  $('#d-person-input').onkeydown = e => {
    if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addPerson(e.target.value); e.target.value = ''; }
  };
  $('#d-person-input').onchange = e => {
    if (state.people.some(p => p.name === e.target.value)) { addPerson(e.target.value); e.target.value = ''; }
  };
  $$('#d-stars button').forEach(b => {
    b.onclick = () => {
      const v = +b.dataset.v, nv = d.rating === v ? null : v;
      patchHike(d.id, { rating: nv });
      $$('#d-stars button').forEach(x => x.classList.toggle('on', nv != null && +x.dataset.v <= nv));
    };
  });
  $('#d-photo-input').onchange = e => { uploadPhotos([...e.target.files]); e.target.value = ''; };
  const dz = $('#d-drop');
  dz.ondragover = e => { e.preventDefault(); dz.classList.add('over'); };
  dz.ondragleave = () => dz.classList.remove('over');
  $('#d-notes').onchange = e => patchHike(d.id, { notes: e.target.value });
  $('#d-delete').onclick = deleteHike;

  renderPeople();
  renderGallery();
  renderProfile();
}

async function patchHike(id, fields, { rerender = false } = {}) {
  try {
    const s = await api.send('PATCH', `/api/hikes/${id}`, fields);
    replaceHike(s);
    if (rerender && state.detail && state.detail.kind === 'hike' && state.detail.id === id) {
      const open = !$('#d-loc-form').hidden;
      renderDetail();
      $('#d-loc-form').hidden = !open;
    }
    toast('Enregistré', 1200);
  } catch (err) { toast('Erreur : ' + err.message); }
}

function renderPeople() {
  const d = state.detail;
  $('#d-people').innerHTML = d.people.length
    ? d.people.map(n => `<span class="chip"><button class="chip-name" data-person="${esc(n)}" title="Ouvrir la fiche de ${esc(n)}">${esc(n)}</button><button data-n="${esc(n)}" title="Retirer">×</button></span>`).join('')
    : '<span class="hint">Personne pour l’instant — sortie en solo ?</span>';
  $$('#d-people .chip button[data-n]').forEach(b => { b.onclick = () => savePeople(d.people.filter(n => n !== b.dataset.n)); });
  $$('#d-people [data-person]').forEach(b => { b.onclick = () => openPerson(b.dataset.person); });
}
function addPerson(name) {
  name = name.replace(/,/g, ' ').trim();
  if (!name || !state.detail) return;
  if (state.detail.people.some(n => n.toLowerCase() === name.toLowerCase())) return;
  savePeople([...state.detail.people, name]);
}
async function savePeople(names) {
  const id = state.detail.id;
  try {
    const s = await api.send('PUT', `/api/hikes/${id}/people`, { names });
    state.people = await api.get('/api/people');
    replaceHike(s);
    renderPeople();
  } catch (err) { toast('Erreur : ' + err.message); }
}

async function deleteHike() {
  const d = state.detail;
  if (!confirm(`Supprimer définitivement « ${d.name} », sa trace et ses ${d.photos.length} photo(s) ?`)) return;
  try {
    await api.send('DELETE', `/api/hikes/${d.id}`);
    closeDetail();
    await loadAll();
    toast('Sortie supprimée');
  } catch (err) { toast('Erreur : ' + err.message); }
}

/* ---------------------------------------------------------- profil altimétrique */
function renderProfile() {
  const d = state.detail;
  if (profileChart) { profileChart.dispose(); profileChart = null; }
  const pts = d.track.filter(p => p[2] != null);
  const el = $('#d-profile');
  if (pts.length < 2) { el.innerHTML = '<span class="hint">Pas de données d’altitude.</span>'; el.style.height = 'auto'; return; }
  profileChart = echarts.init(el);
  const accent = css('--accent'), muted = css('--muted'), line = css('--line');
  profileChart.setOption({
    animation: false,
    grid: { left: 46, right: 10, top: 10, bottom: 24 },
    xAxis: { type: 'value', min: 0, max: pts[pts.length - 1][3], axisLabel: { color: muted, formatter: v => nf1.format(v) + ' km' }, splitLine: { show: false }, axisLine: { lineStyle: { color: line } } },
    yAxis: { type: 'value', scale: true, axisLabel: { color: muted, formatter: v => nf0.format(v) }, splitLine: { lineStyle: { color: line } } },
    tooltip: {
      trigger: 'axis', axisPointer: { type: 'line' },
      formatter: params => {
        const p = pts[params[0].dataIndex];
        showCursor(p);
        const time = d.kind === 'hike' && p[4] && d.track[0][4] ? ' · ' + fmtDur(p[4] - d.track[0][4]) : '';
        return `${nf1.format(p[3])} km · <b>${nf0.format(p[2])} m</b>${time}`;
      },
    },
    series: [{
      type: 'line', data: pts.map(p => [p[3], p[2]]), showSymbol: false, lineStyle: { color: accent, width: 2 },
      areaStyle: { color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [{ offset: 0, color: accent + '88' }, { offset: 1, color: accent + '08' }]) },
      // pour un trek : un repère au début de chaque étape
      markLine: d.stageStarts ? {
        silent: true, symbol: 'none', lineStyle: { color: muted, type: 'dashed', width: 1 },
        label: { color: muted, formatter: p => p.name, position: 'insideEndTop', fontSize: 10 },
        data: d.stageStarts.map((km, i) => ({ xAxis: km, name: `J${i + 1}` })),
      } : undefined,
    }],
  });
  profileChart.on('globalout', hideCursor);
  el.onmouseleave = hideCursor;
}
function showCursor(p) {
  if (!map) return;
  if (!cursorMarker) {
    const e = document.createElement('div'); e.className = 'cursor-dot';
    cursorMarker = new maplibregl.Marker({ element: e });
  }
  cursorMarker.setLngLat([p[0], p[1]]).addTo(map);
}
function hideCursor() { if (cursorMarker) cursorMarker.remove(); }

/* ---------------------------------------------------------- photos */
function clearPhotoMarkers() { photoMarkers.forEach(m => m.remove()); photoMarkers = []; }
function renderPhotoMarkers() {
  clearPhotoMarkers();
  if (!state.detail || !map) return;
  state.detail.photos.forEach((p, i) => {
    if (p.lat == null) return;
    const el = document.createElement('div');
    el.className = 'photo-marker';
    el.title = p.caption || fmtDateTime(p.taken_at);
    el.innerHTML = `<img src="${p.thumb_url}" alt="">`;
    el.addEventListener('click', ev => { ev.stopPropagation(); openLightbox(i); });
    photoMarkers.push(new maplibregl.Marker({ element: el }).setLngLat([p.lon, p.lat]).addTo(map));
  });
}
function renderGallery() {
  const ph = state.detail.photos;
  const picking = !!state.multiPick;
  $('#d-photo-count').textContent = ph.length ? `(${ph.length})` : '';
  const g = $('#d-gallery');
  g.classList.toggle('picking', picking);
  g.innerHTML = ph.map((p, i) => `
    <div class="th ${picking && state.multiPick.has(p.id) ? 'picked' : ''}" data-i="${i}" title="${esc(p.caption || p.original_name || '')}">
      <img src="${p.thumb_url}" alt="" loading="lazy">
      ${p.lat == null ? '<span class="warn">non placée</span>' : ''}
    </div>`).join('');
  $$('#d-gallery .th').forEach(t => {
    t.onclick = () => {
      if (!state.multiPick) { openLightbox(+t.dataset.i); return; }
      const id = ph[+t.dataset.i].id;
      if (state.multiPick.has(id)) state.multiPick.delete(id); else state.multiPick.add(id);
      renderGallery();
    };
  });
  // outil « placer plusieurs photos au même endroit » (ex. une série prise au sommet)
  let tools = $('#d-gallery-tools');
  if (!tools) { tools = document.createElement('div'); tools.id = 'd-gallery-tools'; tools.className = 'gallery-tools'; g.after(tools); }
  if (ph.length < 2) { tools.innerHTML = ''; return; }
  if (!picking) {
    tools.innerHTML = '<button class="linklike" id="mp-start">Placer plusieurs photos au même endroit…</button>';
    $('#mp-start').onclick = () => { state.multiPick = new Set(); renderGallery(); };
    return;
  }
  const n = state.multiPick.size;
  tools.innerHTML = `<span>${n ? plural(n, 'photo') + ' choisie' + (n > 1 ? 's' : '') : 'Clique sur les photos prises au même endroit'}</span>
    <button class="btn small primary" id="mp-place" ${n ? '' : 'disabled'}>Placer sur la carte</button>
    <button class="btn small ghost" id="mp-cancel">Annuler</button>`;
  $('#mp-cancel').onclick = () => { state.multiPick = null; renderGallery(); };
  $('#mp-place').onclick = () => {
    state.placingPhotoIds = [...state.multiPick];
    state.multiPick = null;
    renderGallery();
    $('#placing-hint').hidden = false;
    $('#placing-hint').firstChild.textContent = `Clique sur la carte à l'endroit où ces ${plural(state.placingPhotoIds.length, 'photo')} ont été prises `;
  };
}

async function uploadPhotos(files) {
  if (state.detail && state.detail.kind === 'summit') {   // photo déposée sur la fiche d'un sommet
    const img = files.find(f => /^image\//.test(f.type) || /\.(heic|heif|jpe?g|png|webp)$/i.test(f.name));
    uploadSummitPhotos(files);
    return;
  }
  if (!state.detail || state.detail.kind !== 'hike') {
    toast(state.detail ? 'Ouvre une étape du trek pour y ajouter des photos.' : 'Ouvre d’abord une sortie pour y ajouter des photos.');
    return;
  }
  files = files.filter(f => /^image\//.test(f.type) || /\.(heic|heif|jpe?g|png|webp|tiff?)$/i.test(f.name));
  if (!files.length) return;
  const id = state.detail.id;
  const fd = new FormData();
  files.forEach(f => fd.append('files', f));
  fd.append('offset_minutes', ($('#d-offset') && $('#d-offset').value) || '0');
  toast(`Envoi de ${plural(files.length, 'photo')}…`, 60000);
  try {
    const res = await api.upload(`/api/hikes/${id}/photos`, fd);
    const ok = res.filter(r => r.status === 'ok');
    const placed = ok.filter(r => r.position_source !== 'none').length;
    const err = res.filter(r => r.status === 'error');
    let msg = `${plural(ok.length, 'photo')} ajoutée${ok.length > 1 ? 's' : ''}`;
    if (ok.length) msg += ` · ${placed} placée${placed > 1 ? 's' : ''} sur la trace`;
    if (ok.length - placed) msg += ` · ${ok.length - placed} à placer à la main`;
    if (err.length) msg += ` · ${err.length} illisible${err.length > 1 ? 's' : ''}`;
    toast(msg, 6000);
    await selectHike(id, { fly: false });
    refreshHikes();
  } catch (e) { toast('Erreur : ' + e.message); }
}

/* ---------------------------------------------------------- visionneuse */
const SOURCE_LABEL = { exif_gps: 'position GPS de la photo', time_match: 'placée grâce à l’heure', manual: 'placée à la main', none: 'non placée' };
function openLightbox(i) { state.lightboxIndex = i; renderLightbox(); }
function closeLightbox() { state.lightboxIndex = null; $('#lightbox').hidden = true; }
function renderLightbox() {
  const ph = state.detail.photos, i = state.lightboxIndex, p = ph[i], lb = $('#lightbox');
  if (!p) { closeLightbox(); return; }
  lb.hidden = false;
  lb.innerHTML = `
    <button class="icon-btn lb-close" title="Fermer (Échap)">×</button>
    ${ph.length > 1 ? '<button class="icon-btn lb-nav lb-prev" title="Précédente (←)">‹</button><button class="icon-btn lb-nav lb-next" title="Suivante (→)">›</button>' : ''}
    <img class="lb-img" src="${p.url}" alt="">
    <div class="lb-bar">
      <input type="text" id="lb-caption" placeholder="Ajouter une légende…" value="${esc(p.caption || '')}">
      <div class="lb-meta">
        <span>${i + 1} / ${ph.length}</span>
        ${p.taken_at ? `<span>${fmtDateTime(p.taken_at)}</span>` : ''}
        <span>${SOURCE_LABEL[p.position_source] || ''}</span>
      </div>
      <div class="lb-actions">
        <button class="btn small" id="lb-place">${p.lat == null ? 'Placer sur la carte' : 'Déplacer sur la carte'}</button>
        ${p.lat != null ? '<button class="btn small" id="lb-goto">Voir sur la carte</button>' : ''}
        <a class="btn small" href="${p.original_url}" target="_blank" rel="noopener">Original</a>
        <button class="btn small" id="lb-delete">Supprimer</button>
      </div>
    </div>`;
  $('.lb-close', lb).onclick = closeLightbox;
  if (ph.length > 1) {
    $('.lb-prev', lb).onclick = () => { state.lightboxIndex = (i - 1 + ph.length) % ph.length; renderLightbox(); };
    $('.lb-next', lb).onclick = () => { state.lightboxIndex = (i + 1) % ph.length; renderLightbox(); };
  }
  $('#lb-caption').onchange = async e => {
    try {
      ph[i] = await api.send('PATCH', `/api/photos/${p.id}`, { caption: e.target.value });
      renderPhotoMarkers(); toast('Légende enregistrée', 1200);
    } catch (err) { toast('Erreur : ' + err.message); }
  };
  $('#lb-place').onclick = () => {
    closeLightbox();
    state.placingPhotoId = p.id;
    $('#placing-hint').hidden = false;
  };
  if ($('#lb-goto')) $('#lb-goto').onclick = () => { closeLightbox(); prepareTerrainForFlight(); map.flyTo({ center: [p.lon, p.lat], zoom: 15.5, pitch: 60, duration: 1500 }); };
  $('#lb-delete').onclick = async () => {
    if (!confirm('Supprimer cette photo ?')) return;
    try {
      await api.send('DELETE', `/api/photos/${p.id}`);
      ph.splice(i, 1);
      renderGallery(); renderPhotoMarkers();
      if (!ph.length) closeLightbox(); else { state.lightboxIndex = Math.min(i, ph.length - 1); renderLightbox(); }
      refreshHikes();
    } catch (err) { toast('Erreur : ' + err.message); }
  };
}
function cancelPlacing() {
  state.placingPhotoId = null;
  state.placingPhotoIds = null;
  $('#placing-hint').hidden = true;
  $('#placing-hint').firstChild.textContent = "Clique sur la carte pour placer la photo (elle s'aimante sur la trace) ";
  if (map) map.getCanvas().style.cursor = '';
}

/* ---------------------------------------------------------- survol 3D */
let fly = null;
function alongTrack(tr, dkm) {
  let lo = 0, hi = tr.length - 1;
  if (dkm <= tr[0][3]) return [tr[0][0], tr[0][1]];
  if (dkm >= tr[hi][3]) return [tr[hi][0], tr[hi][1]];
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (tr[mid][3] < dkm) lo = mid; else hi = mid; }
  const a = tr[lo], b = tr[hi], f = (dkm - a[3]) / ((b[3] - a[3]) || 1);
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
}
function bearingDeg(a, b) {
  const r = Math.PI / 180, y = Math.sin((b[0] - a[0]) * r) * Math.cos(b[1] * r);
  const x = Math.cos(a[1] * r) * Math.sin(b[1] * r) - Math.sin(a[1] * r) * Math.cos(b[1] * r) * Math.cos((b[0] - a[0]) * r);
  return Math.atan2(y, x) / r;
}
const lerpAngle = (a, b, t) => { const d = ((b - a + 540) % 360) - 180; return a + d * t; };

/** Distance (km, le long de la trace) du point de la trace le plus proche d'une position. */
function kmAlong(tr, lat, lon) {
  const k = Math.cos(lat * Math.PI / 180);
  let best = Infinity, km = 0;
  for (const p of tr) {
    const dx = (p[0] - lon) * k, dy = p[1] - lat, d = dx * dx + dy * dy;
    if (d < best) { best = d; km = p[3]; }
  }
  return km;
}

/** Arrêts photo du survol : les photos placées, triées le long de la trace ; celles prises au même endroit
    (à moins de 150 m d'écart sur la trace) sont regroupées en un seul arrêt. */
function flyPhotoStops(tr, photos) {
  const placed = (photos || []).filter(p => p.lat != null)
    .map(p => ({ p, km: kmAlong(tr, p.lat, p.lon) })).sort((a, b) => a.km - b.km);
  const stops = [];
  for (const x of placed) {
    const last = stops[stops.length - 1];
    if (last && x.km - last.km < 0.15 && last.photos.length < 4) last.photos.push(x.p);
    else stops.push({ km: x.km, photos: [x.p] });
  }
  return stops;
}

function showFlyPhotos(stop) {
  const el = $('#fly-photo');
  const ps = stop.photos;
  el.innerHTML = `<div class="fp-imgs n${ps.length}">${ps.map(p => `<img src="${p.url}" alt="">`).join('')}</div>
    ${ps.some(p => p.caption) ? `<div class="fp-cap">${ps.map(p => esc(p.caption || '')).filter(Boolean).join(' · ')}</div>` : ''}`;
  el.hidden = false;
  requestAnimationFrame(() => el.classList.add('show'));
}
function hideFlyPhotos() {
  const el = $('#fly-photo');
  el.classList.remove('show');
  setTimeout(() => { if (!el.classList.contains('show')) el.hidden = true; }, 350);
}

/** Survol 3D le long d'une trace ([[lon, lat, alt, km, t], …]) ; la caméra marque une pause à chaque photo.
    Barre en bas : pause/lecture, curseur pour se déplacer dans le survol, vitesse x1 / x2 / x3. */
const FLY_SPEEDS = [1, 2, 3];
function startFlyover(tr, photos = []) {
  if (!tr || tr.length < 2 || !map) return;
  stopFlyover();
  const total = tr[tr.length - 1][3];
  const duration = Math.min(120000, Math.max(25000, total * 3500));   // temps de déplacement en x1, hors pauses
  const speed = total / duration;                                      // km par ms en x1
  const stops = flyPhotoStops(tr, photos);
  const pauseBase = stops.length > 15 ? 2200 : 3500;
  const el = document.createElement('div'); el.className = 'fly-dot';
  const dot = new maplibregl.Marker({ element: el }).setLngLat([tr[0][0], tr[0][1]]).addTo(map);
  let bearing = bearingDeg(alongTrack(tr, 0), alongTrack(tr, Math.min(total, 0.4)));
  document.body.classList.add('flying');
  $('#fly-stop').hidden = false;
  $('#fly-bar').hidden = false;
  hideCursor();
  prepareTerrainForFlight();
  map.flyTo({ center: [tr[0][0], tr[0][1]], zoom: 14.3, pitch: 65, bearing, duration: 2500, essential: true });
  fly = {
    dot, raf: null, last: null, dkm: 0, next: 0, pauseUntil: 0, paused: false, playing: true,
    speedIdx: fly && fly.speedIdx || 0, scrubbing: false, total, tr, stops, snapBearing: false,
  };
  const range = $('#fly-range');
  const updateBar = () => {
    if (!fly) return;
    if (!fly.scrubbing) range.value = Math.round((fly.dkm / total) * 1000);
    $('#fly-km').textContent = `${nf1.format(fly.dkm)} / ${nf1.format(total)} km`;
    $('#fly-play').textContent = fly.playing ? '❚❚' : '▶';
    $('#fly-play').title = fly.playing ? 'Pause (Espace)' : 'Lecture (Espace)';
    $('#fly-speed').textContent = 'x' + FLY_SPEEDS[fly.speedIdx];
  };
  fly.updateBar = updateBar;
  updateBar();
  const frame = ts => {
    if (!fly) return;
    const mul = FLY_SPEEDS[fly.speedIdx];
    const dt = fly.last === null ? 0 : Math.min(100, ts - fly.last);
    fly.last = ts;
    if (fly.paused && fly.playing && !fly.scrubbing) {
      if (ts >= fly.pauseUntil) { fly.paused = false; hideFlyPhotos(); }
    } else if (fly.playing && !fly.scrubbing) {
      fly.dkm = Math.min(total, fly.dkm + dt * speed * mul);
      if (fly.next < stops.length && fly.dkm >= stops[fly.next].km) {
        const stop = stops[fly.next++];
        fly.dkm = stop.km;
        fly.paused = true;
        fly.pauseUntil = ts + Math.max(1500, (pauseBase + 900 * (stop.photos.length - 1)) / mul);
        showFlyPhotos(stop);
      }
      if (fly.dkm >= total) fly.playing = false;   // arrivé : on reste sur place, le curseur permet de revenir
    }
    const pos = alongTrack(tr, fly.dkm);
    const ahead = alongTrack(tr, Math.min(total, fly.dkm + 0.45));
    const target = bearingDeg(pos, ahead);
    if (fly.snapBearing) { bearing = target; fly.snapBearing = false; }
    else if (fly.dkm < total - 0.05) bearing = lerpAngle(bearing, target, 0.03 * Math.min(2, mul));
    dot.setLngLat(pos);
    map.jumpTo({ center: pos, bearing, pitch: 65, zoom: 14.3 });
    updateBar();
    fly.raf = requestAnimationFrame(frame);
  };
  setTimeout(() => { if (fly) fly.raf = requestAnimationFrame(frame); }, 2600);
}

/** Saut à une position du survol (curseur). Les arrêts photo déjà dépassés sont ignorés. */
function flySeek(km) {
  if (!fly) return;
  fly.dkm = Math.max(0, Math.min(fly.total, km));
  fly.next = fly.stops.findIndex(s => s.km > fly.dkm + 1e-6);
  if (fly.next < 0) fly.next = fly.stops.length;
  if (fly.paused) { fly.paused = false; hideFlyPhotos(); }
  fly.snapBearing = true;
  fly.updateBar();
}
function flyTogglePlay() {
  if (!fly) return;
  if (!fly.playing && fly.dkm >= fly.total) flySeek(0);   // à la fin : relance depuis le début
  fly.playing = !fly.playing;
  fly.updateBar();
}
function flyCycleSpeed() {
  if (!fly) return;
  fly.speedIdx = (fly.speedIdx + 1) % FLY_SPEEDS.length;
  fly.updateBar();
}

function stopFlyover() {
  if (!fly) return;
  cancelAnimationFrame(fly.raf);
  fly.dot.remove();
  fly = null;
  hideFlyPhotos();
  document.body.classList.remove('flying');
  $('#fly-stop').hidden = true;
  $('#fly-bar').hidden = true;
}

function initFlyControls() {
  const range = $('#fly-range');
  const seekFromRange = () => { if (fly) flySeek((+range.value / 1000) * fly.total); };
  range.addEventListener('pointerdown', () => { if (fly) fly.scrubbing = true; });
  range.addEventListener('input', seekFromRange);
  const endScrub = () => { if (fly && fly.scrubbing) { fly.scrubbing = false; seekFromRange(); } };
  range.addEventListener('pointerup', endScrub);
  range.addEventListener('change', endScrub);
  $('#fly-play').onclick = flyTogglePlay;
  $('#fly-speed').onclick = flyCycleSpeed;
}

/* ---------------------------------------------------------- import des traces (GPX, FIT, TCX, export Strava) */
const TRACK_RE = /\.(gpx|fit|tcx)(\.gz)?$/i;
const isTrack = f => TRACK_RE.test(f.name);
const isStravaCsv = f => /^activities\.csv$/i.test(f.name);
const HIKE_LIKE = /hik|walk|trail|snow ?shoe|backcountry|mountaineer|trek|randonn|marche|raquette|alpinisme|ski de rando/i;
const UNKNOWN_TYPE = '';

function openModal(html) {
  const m = $('#modal');
  $('.modal', m).innerHTML = html;
  m.hidden = false;
  return $('.modal', m);
}
function closeModal() { $('#modal').hidden = true; }

/** Lecteur CSV (guillemets, retours à la ligne dans les champs, séparateur , ou ;). */
function parseCsv(text) {
  text = text.replace(/^﻿/, '');
  const firstLine = text.slice(0, text.indexOf('\n') >>> 0);
  const sep = (firstLine.split(';').length > firstLine.split(',').length) ? ';' : ',';
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === sep) { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter(r => r.some(x => x.trim()));
}

/** activities.csv de Strava → { "1234.fit.gz": { name, type, description } } (en-têtes FR ou EN). */
function readStravaCsv(text) {
  const rows = parseCsv(text);
  if (rows.length < 2) return {};
  const head = rows[0].map(h => h.trim().toLowerCase().replace(/[’`]/g, "'"));
  const col = (re, fallback) => { const i = head.findIndex(h => re.test(h)); return i >= 0 ? i : fallback; };
  const iName = col(/^(activity name|nom de l'activit)/, 2);
  const iType = col(/^(activity type|type d'activit|type de l'activit)/, 3);
  const iDesc = col(/^(activity description|description de l'activit|description)$/, 4);
  const out = {};
  for (const r of rows.slice(1)) {
    const file = r.find(c => /(^|\/)[^/]+\.(gpx|fit|tcx)(\.gz)?$/i.test(c.trim()));
    if (!file) continue;   // activité saisie à la main, sans trace
    out[file.trim().split('/').pop().toLowerCase()] = {
      name: (r[iName] || '').trim(), type: (r[iType] || '').trim(), description: (r[iDesc] || '').trim(),
    };
  }
  return out;
}

/** Fenêtre de choix des types d'activités à importer. Renvoie un Set de types, ou null si annulé. */
function chooseTypes(counts) {
  const entries = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const total = entries.reduce((a, [, n]) => a + n, 0);
  const m = openModal(`
    <h2>Quelles activités importer ?</h2>
    <p>Ton export contient ${plural(total, 'activité')} avec une trace. Les activités de type randonnée sont cochées d’office ;
       les autres (course, vélo…) peuvent être ajoutées si tu veux les voir aussi.</p>
    <div class="type-list">${entries.map(([t, n], i) => `
      <label class="type-row"><input type="checkbox" data-i="${i}" ${t === UNKNOWN_TYPE || HIKE_LIKE.test(t) ? 'checked' : ''}>
        <span>${t === UNKNOWN_TYPE ? '<i>Non listées dans activities.csv</i>' : esc(t)}</span><span class="n">${nf0.format(n)}</span></label>`).join('')}
    </div>
    <div class="modal-links"><button class="linklike" data-all="1">Tout cocher</button><button class="linklike" data-all="0">Tout décocher</button></div>
    <div class="modal-actions"><button class="btn" id="m-cancel">Annuler</button><button class="btn primary" id="m-ok"></button></div>`);
  const boxes = $$('input[type=checkbox]', m);
  const refresh = () => {
    const n = boxes.reduce((a, b) => a + (b.checked ? entries[+b.dataset.i][1] : 0), 0);
    $('#m-ok').textContent = `Importer ${plural(n, 'activité')}`;
    $('#m-ok').disabled = !n;
  };
  boxes.forEach(b => { b.onchange = refresh; });
  $$('[data-all]', m).forEach(btn => { btn.onclick = () => { boxes.forEach(b => { b.checked = btn.dataset.all === '1'; }); refresh(); }; });
  refresh();
  return new Promise(resolve => {
    $('#m-cancel').onclick = () => { closeModal(); resolve(null); };
    $('#m-ok').onclick = () => { closeModal(); resolve(new Set(boxes.filter(b => b.checked).map(b => entries[+b.dataset.i][0]))); };
  });
}

async function importTracks(allFiles) {
  const tracks = allFiles.filter(isTrack);
  const csv = allFiles.find(isStravaCsv);
  if (!tracks.length && allFiles.some(isImage)) {   // un dossier de photos seul : rattachement automatique
    await uploadAutoPhotos(allFiles.filter(isImage), null);
    return;
  }
  if (!tracks.length) {
    toast(csv ? 'activities.csv seul ne contient pas les traces : importe le dossier complet de l’export.' : 'Aucune trace GPX, FIT ou TCX trouvée.', 6000);
    return;
  }
  let meta = {};
  if (csv) {
    try { meta = readStravaCsv(await csv.text()); } catch (_) { toast('activities.csv illisible : import sans les noms Strava.'); }
  }
  const typeOf = f => (meta[f.name.toLowerCase()] || {}).type || UNKNOWN_TYPE;
  let selected = tracks;
  if (Object.keys(meta).length) {
    const counts = new Map();
    tracks.forEach(f => counts.set(typeOf(f), (counts.get(typeOf(f)) || 0) + 1));
    if (counts.size > 1 || ![...counts.keys()].every(t => t === UNKNOWN_TYPE || HIKE_LIKE.test(t))) {
      const chosen = await chooseTypes(counts);
      if (!chosen) return;
      selected = tracks.filter(f => chosen.has(typeOf(f)));
    }
  }
  // FIT d'abord : c'est le fichier d'origine de la montre (cardio, type d'activité exact)
  const rank = f => /\.fit(\.gz)?$/i.test(f.name) ? 0 : /\.tcx(\.gz)?$/i.test(f.name) ? 1 : 2;
  selected = [...selected].sort((a, b) => rank(a) - rank(b));
  // photos du dossier (media/ d'un export Strava) : rattachées ensuite à leur sortie par date ou position
  const images = allFiles.filter(isImage);
  let report = null;
  if (selected.length) report = await uploadTracks(selected, meta, { finalReport: !images.length });
  if (images.length) await uploadAutoPhotos(images, report);
}

const isImage = f => /\.(jpe?g|png|heic|heif|webp|tiff?)$/i.test(f.name);

/** Envoie des photos que le serveur rattache tout seul à la bonne sortie (heure de prise de vue, sinon GPS). */
async function uploadAutoPhotos(images, tracksReport) {
  const BATCH = 8, results = [];
  openModal(`<h2>Rattachement des photos…</h2>
    ${tracksReport ? `<p>Traces : ${esc(tracksReport.msg)}.</p>` : ''}
    <p id="m-progress-text">0 / ${images.length} photos</p>
    <div class="progress"><div id="m-progress"></div></div>
    <p>Chaque photo est placée sur la sortie pendant laquelle elle a été prise.</p>`);
  try {
    for (let i = 0; i < images.length; i += BATCH) {
      const fd = new FormData();
      images.slice(i, i + BATCH).forEach(f => fd.append('files', f));
      results.push(...await api.upload('/api/photos/auto', fd));
      const done = Math.min(images.length, i + BATCH);
      $('#m-progress').style.width = `${(done / images.length) * 100}%`;
      $('#m-progress-text').textContent = `${done} / ${images.length} photos`;
    }
  } catch (e) { toast('Erreur : ' + e.message, 8000); }
  const ok = results.filter(r => r.status === 'ok'), dup = results.filter(r => r.status === 'duplicate');
  const un = results.filter(r => r.status === 'unmatched'), err = results.filter(r => r.status === 'error');
  const perHike = {};
  ok.forEach(r => { perHike[r.hike_name] = (perHike[r.hike_name] || 0) + 1; });
  const noInfo = un.filter(r => /sans date/.test(r.message)).length;
  const m = openModal(`<h2>Import terminé</h2>
    ${tracksReport ? `<p><b>Traces</b> : ${esc(tracksReport.msg)}.</p>` : ''}
    <p><b>Photos</b> : ${plural(ok.length, 'photo')} ajoutée${ok.length > 1 ? 's' : ''}${dup.length ? ` · ${dup.length} déjà présente${dup.length > 1 ? 's' : ''}` : ''}${un.length ? ` · ${un.length} non rattachée${un.length > 1 ? 's' : ''}` : ''}${err.length ? ` · ${err.length} illisible${err.length > 1 ? 's' : ''}` : ''}.</p>
    ${ok.length ? `<ul class="import-report">${Object.entries(perHike).map(([n, c]) => `<li>${esc(n)} : ${c}</li>`).join('')}</ul>` : ''}
    ${un.length ? `<p class="hint">Non rattachées : ${noInfo ? `${noInfo} sans date ni position (Strava les a peut-être nettoyées) — ajoute-les à la main dans la fiche de la sortie` : ''}${noInfo && un.length - noInfo ? ' ; ' : ''}${un.length - noInfo ? `${un.length - noInfo} prises en dehors de tes sorties importées (course, autre activité…)` : ''}.</p>` : ''}
    ${tracksReport && tracksReport.err.length ? `<ul class="import-report">${tracksReport.err.map(e => `<li><b>${esc(e.file)}</b> : ${esc(e.message || '')}</li>`).join('')}</ul>` : ''}
    <div class="modal-actions"><button class="btn primary" id="m-close">OK</button></div>`);
  $('#m-close', m).onclick = closeModal;
  await loadAll({ fit: false });
  if (state.detail && state.detail.kind === 'hike') selectHike(state.detail.id, { fly: false });
}

async function uploadTracks(files, meta, { finalReport = true } = {}) {
  const BATCH = 20, results = [];
  const showModal = files.length > BATCH;
  if (showModal) {
    openModal(`<h2>Import en cours…</h2><p id="m-progress-text">0 / ${files.length}</p>
      <div class="progress"><div id="m-progress"></div></div><p>Tu peux laisser la page ouverte, ça ne prend que quelques instants.</p>`);
  } else toast(`Import de ${plural(files.length, 'fichier')}…`, 60000);
  try {
    for (let i = 0; i < files.length; i += BATCH) {
      const chunk = files.slice(i, i + BATCH);
      const fd = new FormData();
      const m = {};
      chunk.forEach(f => { fd.append('files', f); const k = f.name.toLowerCase(); if (meta[k]) m[k] = meta[k]; });
      fd.append('meta', JSON.stringify(m));
      results.push(...await api.upload('/api/hikes/import', fd));
      if (showModal) {
        const done = Math.min(files.length, i + BATCH);
        $('#m-progress').style.width = `${(done / files.length) * 100}%`;
        $('#m-progress-text').textContent = `${done} / ${files.length}`;
      }
    }
  } catch (e) {
    if (showModal) closeModal();
    toast('Erreur : ' + e.message, 8000);
    if (results.length) await loadAll();
    return;
  }
  const by = s => results.filter(r => r.status === s);
  const ok = by('imported'), dup = by('duplicate'), skip = by('skipped'), err = by('error');
  let msg = `${plural(ok.length, 'sortie')} importée${ok.length > 1 ? 's' : ''}`;
  if (dup.length) msg += ` · ${dup.length} déjà présente${dup.length > 1 ? 's' : ''}`;
  if (skip.length) msg += ` · ${skip.length} sans trace GPS ignorée${skip.length > 1 ? 's' : ''}`;
  if (err.length) msg += ` · ${err.length} en erreur`;
  if (!finalReport) {   // un rapport commun sera affiché après les photos
    await loadAll({ fit: ok.length > 1 });
    startGeocodePolling();
    return { msg, err };
  }
  if (showModal || err.length) {
    const m = openModal(`<h2>Import terminé</h2><p>${msg}.</p>
      ${err.length ? `<ul class="import-report">${err.map(e => `<li><b>${esc(e.file)}</b> : ${esc(e.message || '')}</li>`).join('')}</ul>` : ''}
      ${ok.length ? '<p>Les noms des communes vont apparaître petit à petit (recherche en tâche de fond).</p>' : ''}
      <div class="modal-actions"><button class="btn primary" id="m-close">OK</button></div>`);
    $('#m-close', m).onclick = closeModal;
  } else {
    toast(msg, 7000);
  }
  await loadAll({ fit: ok.length > 1 });
  if (ok.length === 1) selectHike(ok[0].id);
  startGeocodePolling();
  return { msg, err };
}

/** Récupère les fichiers d'un glisser-déposer, en parcourant les dossiers déposés. */
async function filesFromEntries(entries) {
  const out = [];
  const fileOf = en => new Promise(res => en.file(res, () => res(null)));
  const readAll = dir => new Promise(res => {
    const reader = dir.createReader(), acc = [];
    const next = () => reader.readEntries(batch => { if (!batch.length) res(acc); else { acc.push(...batch); next(); } }, () => res(acc));
    next();
  });
  const walk = async en => {
    if (en.isFile) {
      if (TRACK_RE.test(en.name) || /^activities\.csv$/i.test(en.name) || isImage(en)) { const f = await fileOf(en); if (f) out.push(f); }
    } else if (en.isDirectory) {
      for (const child of await readAll(en)) await walk(child);
    }
  };
  for (const en of entries) await walk(en);
  return out;
}

function handleDroppedFiles(files, { fromFolder = false } = {}) {
  if (files.some(f => isTrack(f) || isStravaCsv(f)) || fromFolder) importTracks(files);
  else if (files.length) uploadPhotos(files);
}

let geoPoll = null;
function startGeocodePolling() {
  if (geoPoll) return;
  geoPoll = setInterval(async () => {
    if (!state.hikes.some(h => h.geocoded === 0 && h.start_lat != null)) { clearInterval(geoPoll); geoPoll = null; return; }
    try {
      await refreshHikes();
      if (state.detail && state.detail.kind === 'hike') {
        const s = state.hikes.find(h => h.id === state.detail.id);
        if (s && (s.commune !== state.detail.commune || s.name !== state.detail.name) && document.activeElement?.closest('#detail') == null) {
          Object.assign(state.detail, s); renderDetail();
        }
      }
    } catch (_) { /* ignore */ }
  }, 4000);
}

/* ---------------------------------------------------------- vues */
function switchView(v) {
  state.view = v;
  $$('.tab').forEach(t => t.classList.toggle('active', t.dataset.view === v));
  for (const k of ['map', 'stats', 'people']) $('#view-' + k).classList.toggle('active', v === k);
  stopFlyover();
  if (v === 'map') requestAnimationFrame(() => map && map.resize());
  else if (v === 'stats') requestAnimationFrame(renderStats);
  else if (v === 'people') renderPeopleView();
}

/* =====================================================================
   STATISTIQUES
   ===================================================================== */
const charts = {};
const getChart = id => charts[id] || (charts[id] = echarts.init(document.getElementById(id)));

const sum = (L, f) => L.reduce((a, h) => a + (f(h) || 0), 0);
const maxBy = (L, f) => L.reduce((best, h) => { const v = f(h); return v != null && !isNaN(v) && (best == null || v > best.v) ? { h, v } : best; }, null);

const METRICS = {
  count: { label: 'Nombre de sorties', val: () => 1, fmt: v => nf0.format(v), countOnly: true },
  distance: { label: 'Distance (km)', val: h => (h.distance_m || 0) / 1000, fmt: v => nf1.format(v) + ' km' },
  gain: { label: 'Dénivelé + (m)', val: h => h.ele_gain, fmt: v => nf0.format(v) + ' m' },
  moving: { label: 'Temps en mouvement (h)', val: h => h.moving_s != null ? h.moving_s / 3600 : null, fmt: v => nf1.format(v) + ' h' },
  duration: { label: 'Durée totale (h)', val: h => h.duration_s != null ? h.duration_s / 3600 : null, fmt: v => nf1.format(v) + ' h' },
  elemax: { label: 'Altitude max (m)', val: h => h.ele_max, fmt: v => nf0.format(v) + ' m' },
  speed: { label: 'Vitesse moyenne (km/h)', val: speedKmh, fmt: v => nf1.format(v) + ' km/h', noSum: true },
  people: { label: 'Nombre de compagnons', val: h => h.people.length, fmt: v => nf1.format(v) },
};

const ym = h => { const d = dt(h); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };
function rangeKeys(keys, step) {
  if (!keys.length) return [];
  const s = [...keys].sort(), out = [];
  let cur = s[0];
  while (cur <= s[s.length - 1] && out.length < 600) { out.push(cur); cur = step(cur); }
  return out;
}
const GROUPS = {
  month: {
    label: 'Mois', keys: h => h.start_time ? [ym(h)] : [],
    order: keys => rangeKeys(keys, k => { let [y, m] = k.split('-').map(Number); m++; if (m > 12) { m = 1; y++; } return `${y}-${String(m).padStart(2, '0')}`; }),
    fmt: k => { const [y, m] = k.split('-'); return `${MONTHS[+m - 1]} ${y}`; },
  },
  year: { label: 'Année', keys: h => h.start_time ? [String(dt(h).getFullYear())] : [], order: keys => rangeKeys(keys, k => String(+k + 1)) },
  season: { label: 'Saison', keys: h => h.start_time ? [seasonOf(dt(h))] : [], order: () => SEASONS },
  monthOfYear: { label: 'Mois de l’année', keys: h => h.start_time ? [String(dt(h).getMonth())] : [], order: () => [...Array(12).keys()].map(String), fmt: k => MONTHS[+k] },
  weekday: { label: 'Jour de la semaine', keys: h => h.start_time ? [String((dt(h).getDay() + 6) % 7)] : [], order: () => [...Array(7).keys()].map(String), fmt: k => WEEKDAYS[+k] },
  person: { label: 'Compagnon', keys: h => h.people.length ? h.people : ['Seul·e'] },
  groupSize: { label: 'Taille du groupe', keys: h => [String(h.people.length + 1)], order: keys => [...keys].sort((a, b) => a - b), fmt: k => k === '1' ? 'Seul·e' : `${k} personnes` },
  region: { label: 'Région', keys: h => [h.region || 'Inconnue'] },
  departement: { label: 'Département', keys: h => [h.departement || 'Inconnu'] },
  massif: { label: 'Massif', keys: h => [h.massif || 'Non renseigné'] },
  type: { label: 'Activité', keys: h => [h.activity_type || '?'] },
  trek: { label: 'Trek', keys: h => [(h.trek_id && (state.treks.find(t => t.id === h.trek_id) || {}).name) || 'Hors trek'] },
  distBand: {
    label: 'Tranche de distance', keys: h => [String(Math.min(5, Math.floor((h.distance_m || 0) / 5000)))],
    order: () => ['0', '1', '2', '3', '4', '5'], fmt: k => ['< 5 km', '5–10 km', '10–15 km', '15–20 km', '20–25 km', '≥ 25 km'][+k],
  },
  gainBand: {
    label: 'Tranche de dénivelé', keys: h => [String(Math.min(6, Math.floor((h.ele_gain || 0) / 250)))],
    order: () => ['0', '1', '2', '3', '4', '5', '6'], fmt: k => ['< 250 m', '250–500 m', '500–750 m', '750–1000 m', '1000–1250 m', '1250–1500 m', '≥ 1500 m'][+k],
  },
  rating: { label: 'Note', keys: h => [h.rating ? String(h.rating) : '0'], order: () => ['0', '1', '2', '3', '4', '5'], fmt: k => k === '0' ? 'Non notée' : '★'.repeat(+k) },
};

function groupData(list, by, metric, agg) {
  const G = GROUPS[by], M = METRICS[metric];
  if (M.countOnly) agg = 'sum';
  if (M.noSum && agg === 'sum') agg = 'avg';
  const buckets = new Map();
  for (const h of list) {
    const v = M.val(h);
    if (v == null || isNaN(v)) continue;
    for (const k of G.keys(h)) { if (!buckets.has(k)) buckets.set(k, []); buckets.get(k).push(v); }
  }
  const reduce = arr => !arr || !arr.length ? 0 : agg === 'sum' ? arr.reduce((a, b) => a + b, 0) : agg === 'avg' ? arr.reduce((a, b) => a + b, 0) / arr.length : Math.max(...arr);
  let keys;
  if (G.order) keys = G.order([...buckets.keys()]);
  else keys = [...buckets.keys()].sort((a, b) => reduce(buckets.get(b)) - reduce(buckets.get(a)));
  return { keys, labels: keys.map(k => G.fmt ? G.fmt(k) : k), values: keys.map(k => +reduce(buckets.get(k)).toFixed(2)), counts: keys.map(k => (buckets.get(k) || []).length), agg };
}

function axisStyle() {
  return { muted: css('--muted'), line: css('--line'), ink: css('--ink'), accent: css('--accent'), panel: css('--panel') };
}

function renderStats() {
  if (state.view !== 'stats') return;
  const L = state.filtered;
  const nf = Object.values(state.filters).filter(v => v !== '').length + (state.search.trim() ? 1 : 0);
  $('#stats-scope').innerHTML = nf
    ? `Statistiques sur <b>${plural(L.length, 'sortie')}</b> correspondant à tes filtres (sur ${state.hikes.length}).`
    : `Statistiques sur l’ensemble de tes <b>${plural(L.length, 'sortie')}</b>. Les filtres à gauche s’appliquent ici aussi.`;

  const top = maxBy(L, h => h.ele_max);
  const S = state.filteredSummits;
  const topSummit = maxBy(S.filter(s => s.kind === 'sommet'), s => s.ele);
  const places = kind => new Set(S.filter(s => s.kind === kind).map(summitPlaceKey)).size;
  const cards = [
    [nf0.format(L.length), 'Sorties'],
    [fmtKm(sum(L, h => h.distance_m)), 'Distance totale'],
    [fmtM(sum(L, h => h.ele_gain)), 'Dénivelé positif cumulé'],
    [fmtHours(sum(L, h => h.moving_s ?? h.duration_s)), 'Temps en mouvement'],
    [top ? fmtM(top.v) : '–', 'Plus haut point atteint (trace)'],
    [nf0.format(new Set(L.filter(h => h.trek_id).map(h => h.trek_id)).size), 'Treks'],
    [nf0.format(places('sommet')), 'Sommets gravis'],
    [nf0.format(places('col')), 'Cols franchis'],
    [nf0.format(places('lieu')), 'Lieux marquants'],
    [topSummit ? `${fmtM(topSummit.v)}` : '–', topSummit ? `Plus haut sommet : ${esc(topSummit.h.name)}` : 'Plus haut sommet'],
    [nf0.format(new Set(L.flatMap(h => h.people)).size), 'Compagnons différents'],
    [nf0.format(sum(L, h => h.photo_count)), 'Photos'],
  ];
  $('#stat-cards').innerHTML = cards.map(([v, l]) => `<div class="card"><div class="v">${v}</div><div class="l">${l}</div></div>`).join('');

  renderGroupChart(L);
  renderCumulChart(L);
  renderScatter(L);
  renderRecords(L);
  renderTable(L);
  Object.values(charts).forEach(c => c.resize());
}

function renderGroupChart(L) {
  const by = $('#g-by').value, metric = $('#g-metric').value;
  const M = METRICS[metric];
  $('#g-agg').disabled = !!M.countOnly;
  const g = groupData(L, by, metric, $('#g-agg').value);
  const s = axisStyle();
  const many = g.labels.length > 14;
  getChart('chart-group').setOption({
    animationDuration: 400,
    grid: { left: 60, right: 16, top: 24, bottom: many ? 70 : 34 },
    tooltip: {
      trigger: 'axis', axisPointer: { type: 'shadow' },
      formatter: p => `${esc(p[0].name)}<br><b>${M.fmt(p[0].value)}</b> <span style="opacity:.7">(${plural(g.counts[p[0].dataIndex], 'sortie')})</span>`,
    },
    xAxis: { type: 'category', data: g.labels, axisLabel: { color: s.muted, rotate: many ? 45 : 0, interval: g.labels.length > 40 ? 'auto' : 0 }, axisLine: { lineStyle: { color: s.line } }, axisTick: { show: false } },
    yAxis: { type: 'value', axisLabel: { color: s.muted, formatter: v => nf0.format(v) }, splitLine: { lineStyle: { color: s.line } } },
    series: [{
      type: 'bar', data: g.values, barMaxWidth: 46,
      itemStyle: { color: s.accent, borderRadius: [5, 5, 0, 0] },
      label: { show: g.labels.length <= 16, position: 'top', color: s.muted, fontSize: 11, formatter: p => p.value ? M.fmt(p.value).replace(/ (km|m|h|km\/h)$/, '') : '' },
    }],
  }, true);
}

function renderCumulChart(L) {
  const metric = $('#c-metric').value;
  const val = metric === 'distance' ? h => (h.distance_m || 0) / 1000 : metric === 'gain' ? h => h.ele_gain || 0 : () => 1;
  const fmt = metric === 'distance' ? v => nf0.format(v) + ' km' : metric === 'gain' ? v => nf0.format(v) + ' m' : v => plural(v, 'sortie');
  const byYear = {};
  L.filter(h => h.start_time).sort((a, b) => a.start_time.localeCompare(b.start_time)).forEach(h => { (byYear[dt(h).getFullYear()] ||= []).push(h); });
  const years = Object.keys(byYear).sort();
  const s = axisStyle();
  const series = years.map((y, i) => {
    let c = 0;
    const data = [[new Date(2000, 0, 1).getTime(), 0]];
    byYear[y].forEach(h => { c += val(h); const d = dt(h); data.push([new Date(2000, d.getMonth(), d.getDate()).getTime(), Math.round(c * 10) / 10, h.id]); });
    const isCurrent = +y === new Date().getFullYear();
    return {
      name: y, type: 'line', step: 'end', data, showSymbol: false, emphasis: { focus: 'series' },
      lineStyle: { width: isCurrent ? 3.5 : 2 }, color: PALETTE[i % PALETTE.length], endLabel: { show: true, formatter: '{a}', color: s.muted },
    };
  });
  getChart('chart-cumul').setOption({
    animationDuration: 400,
    grid: { left: 60, right: 50, top: 20, bottom: 30 },
    tooltip: {
      trigger: 'axis',
      formatter: ps => {
        const d = new Date(ps[0].value[0]);
        return `${d.getDate()} ${MONTHS[d.getMonth()]}<br>` + ps.map(p => `${p.marker}${p.seriesName} : <b>${fmt(p.value[1])}</b>`).join('<br>');
      },
    },
    xAxis: {
      type: 'time', min: new Date(2000, 0, 1).getTime(), max: new Date(2000, 11, 31).getTime(), splitNumber: 12,
      axisLabel: { color: s.muted, formatter: v => MONTHS[new Date(v).getMonth()] }, axisLine: { lineStyle: { color: s.line } }, splitLine: { show: false },
    },
    yAxis: { type: 'value', axisLabel: { color: s.muted, formatter: v => nf0.format(v) }, splitLine: { lineStyle: { color: s.line } } },
    series,
  }, true);
}

function renderScatter(L) {
  const s = axisStyle();
  const byYear = {};
  L.forEach(h => { const y = h.start_time ? String(dt(h).getFullYear()) : '?'; (byYear[y] ||= []).push(h); });
  const years = Object.keys(byYear).sort();
  const c = getChart('chart-scatter');
  c.setOption({
    animationDuration: 400,
    grid: { left: 60, right: 20, top: 30, bottom: 40 },
    legend: { top: 0, right: 0, textStyle: { color: s.muted }, itemWidth: 10, itemHeight: 10 },
    tooltip: {
      trigger: 'item',
      formatter: p => { const h = p.data.h; return `<b>${esc(h.name)}</b><br>${fmtDate(h.start_time)}<br>${fmtKm(h.distance_m)} · ${fmtM(h.ele_gain)} D+ · ${fmtDur(h.moving_s)}`; },
    },
    xAxis: { type: 'value', name: 'km', nameTextStyle: { color: s.muted }, axisLabel: { color: s.muted, formatter: v => nf0.format(v) }, splitLine: { lineStyle: { color: s.line } } },
    yAxis: { type: 'value', name: 'D+ (m)', nameTextStyle: { color: s.muted }, axisLabel: { color: s.muted, formatter: v => nf0.format(v) }, splitLine: { lineStyle: { color: s.line } } },
    series: years.map((y, i) => ({
      name: y, type: 'scatter', color: PALETTE[i % PALETTE.length],
      data: byYear[y].map(h => ({ value: [+((h.distance_m || 0) / 1000).toFixed(2), h.ele_gain || 0], h, symbolSize: Math.max(7, Math.min(28, 5 + ((h.moving_s || h.duration_s || 0) / 3600) * 2.5)) })),
      itemStyle: { opacity: 0.8, borderColor: '#fff', borderWidth: 1 },
    })),
  }, true);
  c.off('click');
  c.on('click', p => { if (p.data && p.data.h) selectHike(p.data.h.id); });
}

function renderRecords(L) {
  const recs = [
    ['Plus longue distance', maxBy(L, h => h.distance_m), v => fmtKm(v)],
    ['Plus gros dénivelé', maxBy(L, h => h.ele_gain), v => fmtM(v)],
    ['Plus haut point', maxBy(L, h => h.ele_max), v => fmtM(v)],
    ['Plus longue durée', maxBy(L, h => h.duration_s), v => fmtDur(v)],
    ['Meilleure vitesse ascensionnelle', maxBy(L.filter(h => (h.ele_gain || 0) >= 300), h => h.moving_s ? h.ele_gain / (h.moving_s / 3600) : null), v => nf0.format(v) + ' m/h'],
    ['Plus rapide (en mouvement)', maxBy(L.filter(h => (h.distance_m || 0) > 3000), speedKmh), v => nf1.format(v) + ' km/h'],
    ['Plus raide (D+ par km)', maxBy(L.filter(h => (h.distance_m || 0) > 2000), h => (h.ele_gain || 0) / (h.distance_m / 1000)), v => nf0.format(v) + ' m/km'],
    ['Plus grand groupe', maxBy(L.filter(h => h.people.length), h => h.people.length + 1), v => `${v} personnes`],
  ].filter(r => r[1]);
  $('#records').innerHTML = recs.length ? recs.map(([l, r, f]) => `
    <div class="record" data-id="${r.h.id}"><div class="l">${l}</div><div class="v">${f(r.v)}</div>
    <div class="n">${esc(r.h.name)} · ${fmtDate(r.h.start_time)}</div></div>`).join('') : '<span class="hint">Pas encore de données.</span>';
  $$('#records .record').forEach(r => { r.onclick = () => selectHike(+r.dataset.id); });
}

const COLS = [
  { k: 'date', label: 'Date', v: h => h.start_time || '', f: h => fmtDate(h.start_time), csv: h => h.start_time ? dt(h).toLocaleDateString('fr-FR') : '' },
  { k: 'name', label: 'Nom', v: h => h.name.toLowerCase(), f: h => esc(h.name), cls: 'name', csv: h => h.name },
  { k: 'type', label: 'Activité', v: h => h.activity_type || '', f: h => esc(h.activity_type || '') },
  { k: 'lieu', label: 'Lieu', v: h => (h.commune || '').toLowerCase(), f: h => esc([h.commune, h.massif].filter(Boolean).join(' · ')), csv: h => h.commune || '' },
  { k: 'region', label: 'Région', v: h => h.region || '', f: h => esc(h.region || '') },
  { k: 'dist', label: 'Distance', num: true, v: h => h.distance_m || 0, f: h => fmtKm(h.distance_m), csv: h => ((h.distance_m || 0) / 1000).toFixed(2) },
  { k: 'gain', label: 'D+', num: true, v: h => h.ele_gain || 0, f: h => fmtM(h.ele_gain), csv: h => h.ele_gain ?? '' },
  { k: 'loss', label: 'D−', num: true, v: h => h.ele_loss || 0, f: h => fmtM(h.ele_loss), csv: h => h.ele_loss ?? '' },
  { k: 'dur', label: 'Durée', num: true, v: h => h.duration_s || 0, f: h => fmtDur(h.duration_s), csv: h => h.duration_s != null ? (h.duration_s / 3600).toFixed(2) : '' },
  { k: 'mov', label: 'En mouv.', num: true, v: h => h.moving_s || 0, f: h => fmtDur(h.moving_s), csv: h => h.moving_s != null ? (h.moving_s / 3600).toFixed(2) : '' },
  { k: 'speed', label: 'Vitesse', num: true, v: h => speedKmh(h) || 0, f: h => speedKmh(h) ? nf1.format(speedKmh(h)) + ' km/h' : '–', csv: h => speedKmh(h) ? speedKmh(h).toFixed(2) : '' },
  { k: 'alt', label: 'Alt. max', num: true, v: h => h.ele_max || 0, f: h => fmtM(h.ele_max), csv: h => h.ele_max ?? '' },
  { k: 'hr', label: 'FC moy.', num: true, v: h => h.avg_hr || 0, f: h => h.avg_hr ? nf0.format(h.avg_hr) : '–', csv: h => h.avg_hr ?? '' },
  { k: 'rating', label: 'Note', num: true, v: h => h.rating || 0, f: h => h.rating ? '★'.repeat(h.rating) : '', csv: h => h.rating ?? '' },
  { k: 'people', label: 'Compagnons', v: h => h.people.join(', ').toLowerCase(), f: h => esc(h.people.join(', ')), csv: h => h.people.join(', ') },
  { k: 'photos', label: 'Photos', num: true, v: h => h.photo_count, f: h => h.photo_count || '' },
];

function sortedForTable(L) {
  const { k, dir } = state.tableSort, col = COLS.find(c => c.k === k);
  return [...L].sort((a, b) => { const x = col.v(a), y = col.v(b); return (x < y ? -1 : x > y ? 1 : 0) * dir; });
}
function renderTable(L) {
  const { k, dir } = state.tableSort;
  const rows = sortedForTable(L);
  $('#hike-table').innerHTML = `
    <thead><tr>${COLS.map(c => `<th data-k="${c.k}" class="${c.num ? 'num' : ''} ${c.k === k ? 'sorted' + (dir > 0 ? ' asc' : '') : ''}">${c.label}</th>`).join('')}</tr></thead>
    <tbody>${rows.map(h => `<tr data-id="${h.id}">${COLS.map(c => `<td class="${c.num ? 'num' : ''} ${c.cls || ''}">${c.f(h)}</td>`).join('')}</tr>`).join('')}</tbody>
    ${rows.length ? `<tfoot><tr><td colspan="5"><b>Total (${rows.length})</b></td>
      <td class="num"><b>${fmtKm(sum(rows, h => h.distance_m))}</b></td><td class="num"><b>${fmtM(sum(rows, h => h.ele_gain))}</b></td>
      <td class="num"><b>${fmtM(sum(rows, h => h.ele_loss))}</b></td><td class="num"><b>${fmtHours(sum(rows, h => h.duration_s))}</b></td>
      <td class="num"><b>${fmtHours(sum(rows, h => h.moving_s))}</b></td><td colspan="6"></td></tr></tfoot>` : ''}`;
  $$('#hike-table th').forEach(th => {
    th.onclick = () => {
      const col = COLS.find(c => c.k === th.dataset.k);
      state.tableSort = { k: col.k, dir: state.tableSort.k === col.k ? -state.tableSort.dir : (col.num || col.k === 'date' ? -1 : 1) };
      renderTable(state.filtered);
    };
  });
  $$('#hike-table tbody tr').forEach(tr => { tr.onclick = () => selectHike(+tr.dataset.id); });
}

function exportCsv() {
  const rows = sortedForTable(state.filtered);
  const cell = v => { const s = String(v ?? ''); return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const num = v => typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v) ? v.replace('.', ',') : v;
  const head = COLS.map(c => c.k === 'dur' || c.k === 'mov' ? c.label + ' (h)' : c.k === 'dist' ? 'Distance (km)' : c.k === 'speed' ? 'Vitesse (km/h)' : c.label);
  const lines = [head.map(cell).join(';'), ...rows.map(h => COLS.map(c => cell(num(String((c.csv || c.v)(h) ?? '')))).join(';'))];
  const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `randonnees_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/* =====================================================================
   INITIALISATION
   ===================================================================== */
function initControls() {
  // onglets
  $$('.tab').forEach(t => { t.onclick = () => switchView(t.dataset.view); });
  // volet de la colonne de gauche
  const syncSidebar = () => {
    document.body.classList.toggle('sidebar-collapsed', state.sidebarCollapsed);
    const b = $('#sidebar-toggle');
    b.textContent = state.sidebarCollapsed ? '»' : '«';
    b.title = state.sidebarCollapsed ? 'Afficher la liste et les filtres' : 'Masquer la liste et les filtres';
    b.setAttribute('aria-label', b.title);
  };
  syncSidebar();
  $('#sidebar-toggle').onclick = () => { state.sidebarCollapsed = !state.sidebarCollapsed; savePrefs(); syncSidebar(); };
  $('.sidebar').addEventListener('transitionend', e => {
    if (e.propertyName !== 'margin-left') return;
    if (map) map.resize();
    Object.values(charts).forEach(c => c.resize());
  });
  // import
  $('#gpx-input').onchange = e => { importTracks([...e.target.files]); e.target.value = ''; };
  $('#folder-input').onchange = e => { importTracks([...e.target.files]); e.target.value = ''; };
  // recherche & filtres
  let st;
  $('#search').oninput = e => { clearTimeout(st); st = setTimeout(() => { state.search = e.target.value; applyFilters(); }, 150); };
  $$('[data-filter]').forEach(el => {
    el.addEventListener(el.tagName === 'SELECT' ? 'change' : 'input', () => { state.filters[el.dataset.filter] = el.value; applyFilters(); });
  });
  $('#reset-filters').onclick = () => {
    state.filters = { ...EMPTY_FILTERS };
    $$('[data-filter]').forEach(el => { el.value = ''; });
    applyFilters({ fit: true });
  };
  $('#hike-list').onclick = onListClick;
  initTrekControls();
  initSummitControls();
  initFlyControls();
  // carte
  $('#basemap').innerHTML = Object.entries(BASEMAPS).map(([k, b]) => `<option value="${k}">${b.label}</option>`).join('');
  $('#basemap').value = state.basemap;
  $('#basemap').onchange = e => setBasemap(e.target.value);
  $('#color-mode').value = state.colorMode;
  $('#color-mode').onchange = e => { state.colorMode = e.target.value; savePrefs(); applyFilters(); };
  $('#fly-stop').onclick = stopFlyover;
  $('#placing-cancel').onclick = cancelPlacing;
  // stats
  $('#g-by').innerHTML = Object.entries(GROUPS).map(([k, g]) => `<option value="${k}">${g.label}</option>`).join('');
  $('#g-by').value = 'month';
  $('#g-metric').innerHTML = Object.entries(METRICS).map(([k, m]) => `<option value="${k}">${m.label}</option>`).join('');
  $('#g-metric').value = 'distance';
  ['#g-by', '#g-metric', '#g-agg'].forEach(s => { $(s).onchange = () => renderGroupChart(state.filtered); });
  $('#c-metric').onchange = () => renderCumulChart(state.filtered);
  $('#export-csv').onclick = exportCsv;
  // clavier
  document.addEventListener('keydown', e => {
    if (state.summitViewer != null && !$('#lightbox').hidden) {
      if (e.key === 'Escape') { $('#lightbox').hidden = true; state.summitViewer = null; }
      if (e.key === 'ArrowLeft') $('.lb-prev')?.click();
      if (e.key === 'ArrowRight') $('.lb-next')?.click();
      return;
    }
    if (state.lightboxIndex != null) {
      if (e.key === 'Escape') closeLightbox();
      if (e.target.tagName !== 'INPUT') {
        if (e.key === 'ArrowLeft') $('.lb-prev')?.click();
        if (e.key === 'ArrowRight') $('.lb-next')?.click();
      }
      return;
    }
    if (fly && e.code === 'Space' && !/INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) { e.preventDefault(); flyTogglePlay(); return; }
    if (e.key === 'Escape') {
      if (!$('#modal').hidden) $('#m-cancel')?.click() || $('#m-close')?.click();
      else if (fly) stopFlyover();
      else if (state.placingPhotoId || state.placingPhotoIds) cancelPlacing();
      else if (state.placingSummit) cancelSummitPlacing();
      else if (state.selecting) setSelecting(false);
    }
  });
  // glisser-déposer global
  let dragDepth = 0;
  const hasFiles = e => e.dataTransfer && [...e.dataTransfer.types].includes('Files');
  window.addEventListener('dragenter', e => { if (!hasFiles(e)) return; dragDepth++; $('#drop-overlay').hidden = false; });
  window.addEventListener('dragleave', () => { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) $('#drop-overlay').hidden = true; });
  window.addEventListener('dragover', e => { if (hasFiles(e)) e.preventDefault(); });
  window.addEventListener('drop', e => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth = 0; $('#drop-overlay').hidden = true;
    $$('.dropzone.over').forEach(d => d.classList.remove('over'));
    // les entrées doivent être lues tout de suite, avant toute attente
    const entries = [...(e.dataTransfer.items || [])].filter(i => i.kind === 'file')
      .map(i => (i.webkitGetAsEntry ? i.webkitGetAsEntry() : null)).filter(Boolean);
    const files = [...e.dataTransfer.files];
    if (entries.some(en => en.isDirectory)) {
      toast('Lecture du dossier…', 60000);
      filesFromEntries(entries).then(f => handleDroppedFiles(f, { fromFolder: true }));
    } else handleDroppedFiles(files);
  });
  // redimensionnement
  window.addEventListener('resize', () => { Object.values(charts).forEach(c => c.resize()); if (profileChart) profileChart.resize(); });
}
// Le démarrage se fait dans main.js, une fois treks.js et summits.js chargés.
