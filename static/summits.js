'use strict';
/* =====================================================================
   SOMMETS & COLS — « sommets effectués », avec ou sans trace
   ===================================================================== */
let summitMarkers = [];
const KIND_LABEL = { sommet: 'Sommet', col: 'Col', lieu: 'Lieu marquant' };

/** Un même lieu (même nœud OSM, ou même nom au même endroit) gravi plusieurs fois = une seule « place ». */
function summitPlaceKey(s) {
  return s.osm_id || `${(s.name || '').toLowerCase()}|${s.lat != null ? s.lat.toFixed(3) : ''},${s.lon != null ? s.lon.toFixed(3) : ''}`;
}
const summitDate = s => (s.date ? new Date(s.date + 'T12:00:00') : null);
const fmtSummitDate = s => (s.date ? summitDate(s).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' }) : 'date à renseigner');

/** Filtres applicables aux sommets : dates, saison, personne, recherche. */
function passesSummit(s) {
  const f = state.filters, d = summitDate(s);
  if (f.from && (!d || d < new Date(f.from + 'T00:00:00'))) return false;
  if (f.to && (!d || d > new Date(f.to + 'T23:59:59'))) return false;
  if (f.year && (!d || d.getFullYear() !== +f.year)) return false;
  if (f.season && (!d || seasonOf(d) !== f.season)) return false;
  if (f.person === '__solo__' && s.people.length) return false;
  if (f.person && f.person !== '__solo__' && !s.people.includes(f.person)) return false;
  const q = state.search.trim().toLowerCase();
  if (q) {
    const hay = [s.name, s.notes, s.hike_name, KIND_LABEL[s.kind], ...s.people].join(' ').toLowerCase();
    if (!q.split(/\s+/).every(w => hay.includes(w))) return false;
  }
  return true;
}

/* ---------------------------------------------------------- mode Tracés / Sommets */
function setMapMode(mode, { keepDetail = false } = {}) {
  if (state.mapMode === mode) return;
  state.mapMode = mode;
  document.body.classList.toggle('mode-summits', mode === 'summits');
  $$('#mode-toggle button').forEach(b => b.classList.toggle('active', b.dataset.mode === mode));
  if (state.selecting) { state.selecting = false; state.selected.clear(); $('#select-toggle').textContent = 'Sélectionner'; }
  if (!keepDetail) closeDetail();
  applyFilters();
  if (!keepDetail && mode === 'summits' && state.filteredSummits.length) fitToSummits(state.filteredSummits);
}

function fitToSummits(list) {
  const pts = list.filter(s => s.lat != null);
  if (!pts.length || !map) return;
  if (pts.length === 1) { prepareTerrainForFlight(); map.flyTo({ center: [pts[0].lon, pts[0].lat], zoom: 11, pitch: 45, duration: 1200 }); return; }
  const lons = pts.map(s => s.lon), lats = pts.map(s => s.lat);
  flyToBounds([[Math.min(...lons) - .02, Math.min(...lats) - .02], [Math.max(...lons) + .02, Math.max(...lats) + .02]], { pitch: 40, duration: 1200 });
}

/* ---------------------------------------------------------- marqueurs
   Pour ne pas surcharger la carte quand on dézoome :
   - les sommets proches à l'écran (< CLUSTER_PX) sont réunis en une pastille « ▲ 4 » (clic = zoom dessus) ;
   - en dessous de LABEL_ZOOM, un sommet isolé n'affiche que son icône (le nom apparaît au survol). */
const CLUSTER_PX = 56;
const LABEL_ZOOM = 7;

function renderSummitMarkers() {
  summitMarkers.forEach(m => m.remove());
  summitMarkers = [];
  if (!map || state.mapMode !== 'summits') return;
  const places = new Map();
  for (const s of state.filteredSummits) {
    if (s.lat == null || s.lon == null) continue;
    const k = summitPlaceKey(s);
    if (!places.has(k)) places.set(k, []);
    places.get(k).push(s);
  }
  // regroupement par proximité à l'écran (le sommet sélectionné reste toujours à part)
  const groups = [];
  for (const visits of places.values()) {
    const s = visits[0];
    const p = map.project([s.lon, s.lat]);
    const selected = visits.some(v => v.id === state.selectedSummitId);
    const g = selected ? null : groups.find(x => !x.selected && Math.hypot(x.p.x - p.x, x.p.y - p.y) < CLUSTER_PX);
    if (g) g.places.push(visits); else groups.push({ p, selected, places: [visits] });
  }
  const zoom = map.getZoom();
  for (const g of groups) {
    if (g.places.length > 1) { addClusterMarker(g.places); continue; }
    addSummitMarker(g.places[0], { compact: zoom < LABEL_ZOOM && !g.selected });
  }
}

function addClusterMarker(placeList) {
  const all = placeList.flat();
  const lons = all.map(s => s.lon), lats = all.map(s => s.lat);
  const center = [lons.reduce((a, b) => a + b, 0) / lons.length, lats.reduce((a, b) => a + b, 0) / lats.length];
  const el = document.createElement('div');
  el.className = 'summit-cluster';
  el.innerHTML = `<span class="sm-icon"></span>${placeList.length}`;
  el.title = placeList.map(v => v[0].name).slice(0, 12).join(', ') + (placeList.length > 12 ? '…' : '');
  el.addEventListener('click', ev => {
    ev.stopPropagation();
    const pad = .01;
    map.fitBounds([[Math.min(...lons) - pad, Math.min(...lats) - pad], [Math.max(...lons) + pad, Math.max(...lats) + pad]],
      { padding: 80, maxZoom: 14.5, duration: 1200 });
  });
  summitMarkers.push(new maplibregl.Marker({ element: el }).setLngLat(center).addTo(map));
}

function addSummitMarker(visits, { compact = false } = {}) {
  {
    visits.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    const s = visits[0];
    const el = document.createElement('div');
    el.className = `summit-marker kind-${s.kind}${compact ? ' compact' : ''}${visits.some(v => v.id === state.selectedSummitId) ? ' active' : ''}`;
    el.dataset.ids = visits.map(v => v.id).join(',');
    el.innerHTML = `<span class="sm-icon"></span><span class="sm-label">${esc(s.name)}${s.ele != null ? `<small>${fmtM(s.ele)}</small>` : ''}</span>
      ${visits.length > 1 ? `<span class="sm-count" title="${visits.length} passages">×${visits.length}</span>` : ''}`;
    el.title = `${s.name}${s.ele != null ? ' · ' + fmtM(s.ele) : ''} — ${KIND_LABEL[s.kind]} · ${visits.map(fmtSummitDate).join(', ')}`;
    el.addEventListener('click', ev => { ev.stopPropagation(); selectSummit(s.id); });
    summitMarkers.push(new maplibregl.Marker({ element: el, anchor: 'bottom' }).setLngLat([s.lon, s.lat]).addTo(map));
  }
}

/* ---------------------------------------------------------- liste */
function renderSummitList() {
  const S = state.filteredSummits;
  const n = kind => new Set(S.filter(s => s.kind === kind).map(summitPlaceKey)).size;
  $('#summit-summary').textContent = `${plural(n('sommet'), 'sommet')} · ${plural(n('col'), 'col')}${n('lieu') ? ' · ' + plural(n('lieu'), 'lieu') : ''}`;
  if (!S.length) {
    $('#hike-list').innerHTML = `<li class="list-empty">${state.summits.length
      ? 'Aucun sommet ne correspond aux filtres.'
      : 'Aucun sommet pour l’instant.<br>Ajoute-en avec « + Ajouter », ou « Détecter » pour les trouver sur tes traces.'}</li>`;
    return;
  }
  $('#hike-list').classList.remove('selecting');
  $('#hike-list').innerHTML = S.map(s => `
    <li data-summit="${s.id}" class="summit-row kind-${s.kind} ${s.id === state.selectedSummitId ? 'active' : ''}">
      <span class="sm-icon"></span>
      <div class="sr-main">
        <div class="li-title">${esc(s.name)}</div>
        <div class="li-meta">${s.ele != null ? fmtM(s.ele) + ' · ' : ''}${fmtSummitDate(s)}</div>
        <div class="li-meta">${s.hike_name ? esc(s.hike_name) : '<i>sans trace</i>'}${s.people.length ? ` · ${s.people.length} pers.` : ''}</div>
      </div>
      ${s.photo_thumb_url ? `<img class="sr-thumb" src="${s.photo_thumb_url}" alt="" loading="lazy">` : ''}
    </li>`).join('');
}

/* ---------------------------------------------------------- fiche d'un sommet */
function selectSummit(id, { fly: doFly = true } = {}) {
  const s = state.summits.find(x => x.id === id);
  if (!s) return;
  if (state.view !== 'map') switchView('map');
  if (state.mapMode !== 'summits') setMapMode('summits', { keepDetail: true });
  stopFlyover(); cancelPlacing();
  state.selectedSummitId = id; state.selectedId = null; state.selectedTrekId = null;
  state.detail = { ...s, kind: 'summit', skind: s.kind };
  clearPhotoMarkers(); hideCursor();
  if (profileChart) { profileChart.dispose(); profileChart = null; }
  if (mapReady) map.getSource('selected').setData(emptyFC());
  renderSummitDetail();
  renderSummitList();
  renderSummitMarkers();
  if (doFly && s.lat != null && map) {
    prepareTerrainForFlight();
    const w = window.innerWidth > 720 ? $('#detail').offsetWidth + 40 : 0;
    map.flyTo({ center: [s.lon, s.lat], zoom: 13.5, pitch: 55, duration: 1500, offset: [-w / 2, 0], essential: true });
  }
  const li = $(`#hike-list li[data-summit="${id}"]`);
  if (li) li.scrollIntoView({ block: 'nearest' });
}

function renderSummitDetail() {
  const s = state.detail, el = $('#detail');
  el.hidden = false;
  const others = state.summits.filter(x => x.id !== s.id && summitPlaceKey(x) === summitPlaceKey({ ...s, kind: s.skind }))
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  el.innerHTML = `
    <div class="detail-head">
      <input type="text" class="title-input" id="s-name" value="${esc(s.name)}" title="Cliquer pour renommer">
      <button class="icon-btn" id="d-close" title="Fermer">×</button>
    </div>
    <div class="detail-sub">
      <select id="s-kind">${Object.entries(KIND_LABEL).map(([k, l]) => `<option value="${k}" ${s.skind === k ? 'selected' : ''}>${l}</option>`).join('')}</select>
      ${s.hike_id ? `<span>pendant <button class="linklike" id="s-hike">${esc(s.hike_name || 'la sortie')}</button></span>` : '<span class="hint">sans trace</span>'}
    </div>
    <div class="form-grid">
      <label>Date<input type="date" id="s-date" value="${esc(s.date || '')}"></label>
      <label>Altitude (m)<input type="number" id="s-ele" step="1" min="-500" max="9000" value="${s.ele != null ? Math.round(s.ele) : ''}"></label>
    </div>

    <h4>Photo</h4>
    <div id="s-photo"></div>

    <h4>Personnes</h4>
    <div class="chips" id="s-people"></div>
    <input type="text" id="s-person-input" list="people-list" placeholder="Ajouter une personne (Entrée pour valider)">

    <h4>Notes</h4>
    <textarea id="s-notes" placeholder="Voie, conditions, vue, panneau au sommet…">${esc(s.notes || '')}</textarea>

    <h4>Position</h4>
    <div class="pos-line">
      <span class="hint">${s.lat != null ? `${s.lat.toFixed(5)}, ${s.lon.toFixed(5)}` : 'non placé'}</span>
      <button class="btn small" id="s-move">${s.lat != null ? 'Déplacer sur la carte' : 'Placer sur la carte'}</button>
    </div>

    ${others.length ? `<h4>Autres passages ici</h4>
      <div class="summit-chips">${others.map(o => `<button class="summit-chip kind-${o.kind}" data-summit="${o.id}"><span class="sm-icon"></span>${fmtSummitDate(o)}</button>`).join('')}</div>` : ''}

    <div class="danger-zone"><button class="btn small danger" id="s-delete">Supprimer ${s.skind === 'col' ? 'ce col' : s.skind === 'lieu' ? 'ce lieu' : 'ce sommet'}</button></div>`;

  $('#d-close').onclick = closeDetail;
  el.onscroll = () => $('.detail-head', el).classList.toggle('scrolled', el.scrollTop > 2);
  $('#s-name').onkeydown = e => { if (e.key === 'Enter') e.target.blur(); };
  $('#s-name').onchange = e => patchSummit(s.id, { name: e.target.value });
  $('#s-kind').onchange = e => patchSummit(s.id, { kind: e.target.value }, { rerender: true });
  $('#s-date').onchange = e => patchSummit(s.id, { date: e.target.value || null });
  $('#s-ele').onchange = e => patchSummit(s.id, { ele: e.target.value === '' ? null : +e.target.value });
  $('#s-notes').onchange = e => patchSummit(s.id, { notes: e.target.value });
  if ($('#s-hike')) $('#s-hike').onclick = () => selectHike(s.hike_id);
  $('#s-move').onclick = () => startSummitPlacing({ mode: 'move', id: s.id });
  $$('[data-summit]', el).forEach(b => { b.onclick = () => selectSummit(+b.dataset.summit); });
  $('#s-person-input').onkeydown = e => {
    if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addSummitPerson(e.target.value); e.target.value = ''; }
  };
  $('#s-person-input').onchange = e => {
    if (state.people.some(p => p.name === e.target.value)) { addSummitPerson(e.target.value); e.target.value = ''; }
  };
  $('#s-delete').onclick = async () => {
    if (!confirm(`Supprimer « ${s.name} » (${fmtSummitDate(s)}) ?`)) return;
    try {
      await api.send('DELETE', `/api/summits/${s.id}`);
      closeDetail();
      await refreshHikes();
      toast('Supprimé');
    } catch (err) { toast('Erreur : ' + err.message); }
  };
  renderSummitPeople();
  renderSummitPhoto();
}

function syncSummit(updated) {
  const i = state.summits.findIndex(x => x.id === updated.id);
  if (i >= 0) state.summits[i] = updated; else state.summits.push(updated);
  if (state.detail && state.detail.kind === 'summit' && state.detail.id === updated.id) state.detail = { ...updated, kind: 'summit', skind: updated.kind };
  state.filteredSummits = state.summits.filter(passesSummit);
  if (state.mapMode === 'summits') { renderSummitList(); renderSummitMarkers(); }
}

async function patchSummit(id, fields, { rerender = false } = {}) {
  try {
    const s = await api.send('PATCH', `/api/summits/${id}`, fields);
    syncSummit(s);
    if (rerender) renderSummitDetail();
    toast('Enregistré', 1200);
  } catch (err) {
    toast('Erreur : ' + err.message);
    if (state.detail && state.detail.kind === 'summit') renderSummitDetail();   // remet la valeur précédente
  }
}

function renderSummitPeople() {
  const s = state.detail;
  $('#s-people').innerHTML = s.people.length
    ? s.people.map(n => `<span class="chip"><button class="chip-name" data-person="${esc(n)}" title="Ouvrir la fiche de ${esc(n)}">${esc(n)}</button><button data-n="${esc(n)}" title="Retirer">×</button></span>`).join('')
    : '<span class="hint">Personne pour l’instant.</span>';
  $$('#s-people .chip button[data-n]').forEach(b => { b.onclick = () => saveSummitPeople(s.people.filter(n => n !== b.dataset.n)); });
  $$('#s-people [data-person]').forEach(b => { b.onclick = () => openPerson(b.dataset.person); });
}
function addSummitPerson(name) {
  name = name.replace(/,/g, ' ').trim();
  if (!name || !state.detail) return;
  if (state.detail.people.some(n => n.toLowerCase() === name.toLowerCase())) return;
  saveSummitPeople([...state.detail.people, name]);
}
async function saveSummitPeople(names) {
  try {
    const s = await api.send('PUT', `/api/summits/${state.detail.id}/people`, { names });
    state.people = await api.get('/api/people');
    populateFilterOptions();
    syncSummit(s);
    renderSummitPeople();
  } catch (err) { toast('Erreur : ' + err.message); }
}

/* ---------------------------------------------------------- photos d'un sommet (plusieurs) */
function renderSummitPhoto() {
  const s = state.detail, box = $('#s-photo');
  const ph = s.photos || [];
  box.innerHTML = `
    ${ph.length ? `<div class="gallery" id="s-gallery">${ph.map((p, i) => `
      <div class="th" data-i="${i}"><img src="${p.thumb_url}" alt="" loading="lazy"></div>`).join('')}</div>` : ''}
    <label class="dropzone" id="s-drop">${ph.length ? 'Ajouter des photos' : 'Glisse tes photos ici ou clique pour les choisir'}
      <br><small>plusieurs à la fois possible</small>
      <input type="file" id="s-photo-input" accept="image/*,.heic,.heif" multiple hidden></label>
    ${s.hike_id ? '<button class="btn small" id="s-photo-pick">Choisir parmi les photos de la sortie</button>' : ''}
    <div class="gallery pick" id="s-pick" hidden></div>`;
  $$('#s-gallery .th', box).forEach(t => { t.onclick = () => openSummitViewer(+t.dataset.i); });
  const dz = $('#s-drop');
  dz.ondragover = e => { e.preventDefault(); dz.classList.add('over'); };
  dz.ondragleave = () => dz.classList.remove('over');
  $('#s-photo-input').onchange = e => { uploadSummitPhotos([...e.target.files]); e.target.value = ''; };
  if ($('#s-photo-pick')) $('#s-photo-pick').onclick = showHikePhotoPicker;
}

async function uploadSummitPhotos(files) {
  files = files.filter(f => /^image\//.test(f.type) || /\.(heic|heif|jpe?g|png|webp)$/i.test(f.name));
  if (!files.length) return;
  const fd = new FormData();
  files.forEach(f => fd.append('files', f));
  toast(`Envoi de ${plural(files.length, 'photo')}…`, 60000);
  try {
    const s = await api.upload(`/api/summits/${state.detail.id}/photos`, fd);
    syncSummit(s);
    renderSummitPhoto();
    toast(s.errors && s.errors.length ? `Ajoutées, sauf : ${s.errors.join(' ; ')}` : `${plural(files.length, 'photo')} ajoutée${files.length > 1 ? 's' : ''}`, 3000);
  } catch (err) { toast('Erreur : ' + err.message); }
}
const uploadSummitPhoto = f => uploadSummitPhotos([f]);   // compatibilité

async function showHikePhotoPicker() {
  const s = state.detail, box = $('#s-pick');
  if (!box.hidden) { box.hidden = true; return; }
  let photos = [];
  try { photos = (await api.get(`/api/hikes/${s.hike_id}`)).photos; } catch (err) { toast('Erreur : ' + err.message); return; }
  if (!photos.length) { toast('Cette sortie n’a pas encore de photo.'); return; }
  // les photos prises le plus près du sommet en premier
  if (s.lat != null) {
    const dist = p => (p.lat == null ? Infinity : (p.lat - s.lat) ** 2 + ((p.lon - s.lon) * Math.cos(s.lat * Math.PI / 180)) ** 2);
    photos.sort((a, b) => dist(a) - dist(b));
  }
  box.hidden = false;
  box.innerHTML = photos.map(p => `<div class="th" data-pid="${p.id}" title="Ajouter au sommet"><img src="${p.thumb_url}" alt="" loading="lazy"></div>`).join('')
    + '<p class="hint" style="grid-column:1/-1">Clique sur chaque photo à ajouter.</p>';
  rebindPicker(box, s.id);
}
function rebindPicker(box, summitId) {
  $$('[data-pid]', box).forEach(t => {
    t.onclick = async () => {
      if (t.classList.contains('added')) return;
      try {
        syncSummit(await api.send('POST', `/api/summits/${summitId}/photo/from/${t.dataset.pid}`));
        t.classList.add('added');
        const keep = box.innerHTML;
        renderSummitPhoto();
        const nb = $('#s-pick'); nb.hidden = false; nb.innerHTML = keep;
        rebindPicker(nb, summitId);
        toast('Photo ajoutée', 1200);
      } catch (err) { toast('Erreur : ' + err.message); }
    };
  });
}

/** Visionneuse des photos d'un sommet (navigation, original, suppression). */
function openSummitViewer(i) {
  const s = state.detail, ph = s.photos || [], p = ph[i], lb = $('#lightbox');
  if (!p) { lb.hidden = true; return; }
  lb.hidden = false;
  lb.innerHTML = `<button class="icon-btn lb-close" title="Fermer (Échap)">×</button>
    ${ph.length > 1 ? '<button class="icon-btn lb-nav lb-prev" title="Précédente (←)">‹</button><button class="icon-btn lb-nav lb-next" title="Suivante (→)">›</button>' : ''}
    <img class="lb-img" src="${p.url}" alt="">
    <div class="lb-bar"><div class="lb-meta"><span>${esc(s.name)} · ${i + 1} / ${ph.length}</span></div>
      <div class="lb-actions"><a class="btn small" href="${p.original_url}" target="_blank" rel="noopener">Original</a>
        <button class="btn small" id="lb-sdel">Retirer du sommet</button></div></div>`;
  const close = () => { lb.hidden = true; state.summitViewer = null; };
  state.summitViewer = i;
  $('.lb-close', lb).onclick = close;
  lb.onclick = e => { if (e.target === lb) close(); };
  if (ph.length > 1) {
    $('.lb-prev', lb).onclick = () => openSummitViewer((i - 1 + ph.length) % ph.length);
    $('.lb-next', lb).onclick = () => openSummitViewer((i + 1) % ph.length);
  }
  $('#lb-sdel').onclick = async () => {
    if (!confirm('Retirer cette photo du sommet ?')) return;
    try {
      syncSummit(await api.send('DELETE', `/api/summit-photos/${p.id}`));
      renderSummitPhoto();
      if (state.detail.photos.length) openSummitViewer(Math.min(i, state.detail.photos.length - 1)); else close();
    } catch (err) { toast('Erreur : ' + err.message); }
  };
}

/* ---------------------------------------------------------- placer un sommet sur la carte */
function startSummitPlacing(p) {
  if (state.view !== 'map') switchView('map');
  if (state.mapMode !== 'summits') setMapMode('summits', { keepDetail: p.mode === 'move' });
  state.placingSummit = p;
  $('#summit-hint-text').textContent = p.mode === 'move'
    ? 'Clique sur la carte à la nouvelle position'
    : 'Clique sur la carte à l’emplacement du sommet ou du col';
  $('#summit-hint').hidden = false;
}
function cancelSummitPlacing() {
  state.placingSummit = null;
  const h = $('#summit-hint');
  if (h) h.hidden = true;
  if (map) map.getCanvas().style.cursor = '';
}

/** Altitude du relief (sans l'exagération 3D), si le relief est chargé à cet endroit. */
function groundElevation(lngLat) {
  try {
    if (map && map.terrain && map.terrain.exaggeration > 0.05) {
      const v = map.terrain.getElevationForLngLatZoom(maplibregl.LngLat.convert(lngLat), map.transform.tileZoom);
      if (v != null && Number.isFinite(v) && v !== 0) return Math.round(v / map.terrain.exaggeration);
    }
  } catch (_) { /* ignore */ }
  return null;
}

async function placeSummitAt(lngLat) {
  const p = state.placingSummit;
  cancelSummitPlacing();
  const ele = groundElevation(lngLat);
  try {
    if (p.mode === 'move') {
      const fields = { lat: lngLat.lat, lon: lngLat.lng };
      const cur = state.summits.find(s => s.id === p.id);
      if (cur && cur.ele == null && ele != null) fields.ele = ele;
      syncSummit(await api.send('PATCH', `/api/summits/${p.id}`, fields));
      selectSummit(p.id, { fly: false });
      toast('Position enregistrée', 1500);
    } else {
      const s = await api.send('POST', '/api/summits', { name: '', kind: 'sommet', lat: lngLat.lat, lon: lngLat.lng, ele });
      syncSummit(s);
      selectSummit(s.id, { fly: false });
      const name = $('#s-name');
      if (name) { name.select(); name.focus(); }
      toast('Donne-lui un nom, une date, et le tour est joué', 4000);
    }
  } catch (err) { toast('Erreur : ' + err.message); }
}

/** Après une création par recherche : si l'altitude manque, on la lit sur le relief une fois la carte arrivée. */
function fillEleWhenIdle(id) {
  if (!map) return;
  map.once('idle', () => {
    const s = state.summits.find(x => x.id === id);
    if (!s || s.ele != null || s.lat == null) return;
    const ele = groundElevation({ lng: s.lon, lat: s.lat });
    if (ele != null) patchSummit(id, { ele }, { rerender: state.detail && state.detail.id === id && state.detail.kind === 'summit' });
  });
}

/* ---------------------------------------------------------- ajout : recherche par nom */
function openAddSummit() {
  const m = openModal(`
    <h2>Ajouter un sommet, un col ou un lieu marquant</h2>
    <p>Cherche-le par son nom dans OpenStreetMap (sommet, col, lac, cascade, refuge…), ou place-le directement sur la carte.</p>
    <form class="search-row" id="as-form"><input type="search" id="as-q" placeholder="Ex. : Puy de Sancy, Col du Galibier…" autocomplete="off">
      <button class="btn primary" type="submit">Chercher</button></form>
    <ul class="as-results" id="as-results"></ul>
    <div class="modal-actions"><button class="btn" id="as-map">Placer sur la carte</button><button class="btn ghost" id="m-cancel">Annuler</button></div>`);
  $('#as-q', m).focus();
  $('#m-cancel', m).onclick = closeModal;
  $('#as-map', m).onclick = () => { closeModal(); startSummitPlacing({ mode: 'new' }); };
  $('#as-form', m).onsubmit = async e => {
    e.preventDefault();
    const q = $('#as-q', m).value.trim();
    if (q.length < 2) return;
    const out = $('#as-results', m);
    out.innerHTML = '<li class="hint">Recherche…</li>';
    let res;
    try { res = await api.get(`/api/summits/search?q=${encodeURIComponent(q)}`); } catch (err) { out.innerHTML = `<li class="hint">${esc(err.message)}</li>`; return; }
    if (!res.length) { out.innerHTML = '<li class="hint">Aucun résultat. Essaie un autre nom, ou place-le sur la carte.</li>'; return; }
    out.innerHTML = res.map((r, i) => `
      <li data-i="${i}" class="kind-${r.kind}"><span class="sm-icon"></span>
        <div><b>${esc(r.name)}</b>${r.ele != null ? ` · ${fmtM(r.ele)}` : ''}<br><small>${KIND_LABEL[r.kind] || 'Lieu'}${r.where ? ' · ' + esc(r.where) : ''}</small></div></li>`).join('');
    $$('li[data-i]', out).forEach(li => {
      li.onclick = async () => {
        const r = res[+li.dataset.i];
        try {
          const s = await api.send('POST', '/api/summits', { name: r.name, kind: r.kind, lat: r.lat, lon: r.lon, ele: r.ele, osm_id: r.osm_id });
          closeModal();
          syncSummit(s);
          selectSummit(s.id);
          if (s.ele == null) fillEleWhenIdle(s.id);
          toast('Ajouté — renseigne la date, les personnes et une photo', 4000);
          setTimeout(() => $('#s-date') && $('#s-date').focus(), 300);
        } catch (err) { toast('Erreur : ' + err.message); }
      };
    });
  };
}

/* ---------------------------------------------------------- détection sur les traces */
async function runDetection(hikeIds) {
  if (!hikeIds.length) { toast('Aucune sortie à analyser.'); return; }
  let cancelled = false;
  const m = openModal(`<h2>Recherche des sommets et cols…</h2>
    <p id="m-progress-text">0 / ${plural(hikeIds.length, 'sortie')}</p>
    <div class="progress"><div id="m-progress"></div></div>
    <p class="hint">Données OpenStreetMap — quelques secondes par sortie.</p>
    <div class="modal-actions"><button class="btn" id="m-cancel">Annuler</button></div>`);
  $('#m-cancel', m).onclick = () => { cancelled = true; closeModal(); };
  const results = [];
  let failures = 0;
  for (let i = 0; i < hikeIds.length; i++) {
    if (cancelled) return;
    try {
      const r = await api.get(`/api/hikes/${hikeIds[i]}/summit-candidates`);
      if (!r.osm_ok) failures++;
      results.push(r);
    } catch (_) { failures++; }
    if (cancelled) return;
    $('#m-progress').style.width = `${((i + 1) / hikeIds.length) * 100}%`;
    $('#m-progress-text').textContent = `${i + 1} / ${plural(hikeIds.length, 'sortie')}`;
  }
  showDetectionReview(results, failures);
}

function showDetectionReview(results, failures) {
  const items = [];
  const groups = results
    .map(r => ({ name: r.hike_name, ks: r.candidates.map(c => items.push({ ...c, hike_name: r.hike_name }) - 1) }))
    .filter(g => g.ks.length);
  const fresh = items.filter(c => !c.already);
  const m = openModal(`
    <h2>Sommets et cols sur ${results.length > 1 ? 'tes traces' : 'la trace'}</h2>
    <p>Coche ceux par lesquels tu es passé. Les compagnons de chaque sortie y seront associés, et tu pourras ajouter une photo ensuite.</p>
    ${failures ? `<p class="hint warn">OpenStreetMap n’a pas répondu pour ${plural(failures, 'sortie')} (connexion ?) : seul le point culminant est proposé pour celles-là.</p>` : ''}
    ${groups.length ? groups.map(g => `
      <h3 class="rv-hike">${esc(g.name)}</h3>
      <div class="type-list">${g.ks.map(k => {
        const c = items[k];
        return `<label class="type-row cand kind-${c.kind} ${c.already ? 'done' : ''}">
          <input type="checkbox" data-k="${k}" ${c.already ? 'disabled checked' : (c.name ? 'checked' : '')}>
          <span class="sm-icon"></span>
          ${c.name ? `<span>${esc(c.name)}</span>` : `<input type="text" class="cand-name" data-k="${k}" placeholder="Point culminant — donne-lui un nom">`}
          <span class="n">${c.ele != null ? fmtM(c.ele) : ''}${c.culminant ? ' · point culminant' : ''}${c.already ? ' · déjà ajouté' : ''}</span>
        </label>`;
      }).join('')}</div>`).join('') : '<p>Aucun sommet ni col trouvé.</p>'}
    <div class="modal-actions"><button class="btn" id="m-cancel">${fresh.length ? 'Annuler' : 'Fermer'}</button>
      ${fresh.length ? '<button class="btn primary" id="m-ok"></button>' : ''}</div>`);
  const boxes = $$('input[type=checkbox]:not(:disabled)', m);
  const refresh = () => {
    if (!$('#m-ok', m)) return;
    const n = boxes.filter(b => b.checked).length;
    $('#m-ok', m).textContent = n ? `Ajouter ${n}` : 'Rien à ajouter';
    $('#m-ok', m).disabled = !n;
  };
  boxes.forEach(b => { b.onchange = refresh; });
  $$('.cand-name', m).forEach(inp => {
    inp.oninput = () => { const b = $(`input[type=checkbox][data-k="${inp.dataset.k}"]`, m); if (b && !b.disabled) { b.checked = !!inp.value.trim(); refresh(); } };
  });
  refresh();
  $('#m-cancel', m).onclick = closeModal;
  if ($('#m-ok', m)) {
    $('#m-ok', m).onclick = async () => {
      const chosen = boxes.filter(b => b.checked).map(b => {
        const c = items[+b.dataset.k];
        const nameInput = $(`.cand-name[data-k="${b.dataset.k}"]`, m);
        return { name: c.name || (nameInput ? nameInput.value.trim() : ''), kind: c.kind, lat: c.lat, lon: c.lon, ele: c.ele, date: c.date, hike_id: c.hike_id, osm_id: c.osm_id };
      });
      try {
        const r = await api.send('POST', '/api/summits/batch', chosen);
        closeModal();
        await refreshHikes();
        toast(r.created ? `${r.created} sommet${r.created > 1 ? 's' : ''} / col${r.created > 1 ? 's' : ''} ajouté${r.created > 1 ? 's' : ''}` : 'Déjà tous ajoutés', 4000);
        if (state.detail && state.detail.kind === 'hike') renderDetail();
        else if (state.detail && state.detail.kind === 'trek') renderTrekDetail();
      } catch (err) { toast('Erreur : ' + err.message); }
    };
  }
}

function initSummitControls() {
  $$('#mode-toggle button').forEach(b => { b.onclick = () => setMapMode(b.dataset.mode); });
  // les regroupements dépendent du zoom : on les recalcule à chaque fin de zoom
  const waitMap = () => { if (map) map.on('zoomend', () => { if (state.mapMode === 'summits') renderSummitMarkers(); }); else setTimeout(waitMap, 100); };
  waitMap();
  $('#summit-add').onclick = openAddSummit;
  $('#summit-detect').onclick = () => {
    const ids = state.filtered.map(h => h.id);
    if (ids.length > 25 && !confirm(`Analyser ${ids.length} sorties ? Cela peut prendre quelques minutes.`)) return;
    runDetection(ids);
  };
  $('#summit-hint-cancel').onclick = cancelSummitPlacing;
}
