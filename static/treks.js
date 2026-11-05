'use strict';
/* =====================================================================
   TREKS — plusieurs sorties réunies (étapes d'une itinérance)
   ===================================================================== */

/** Étapes d'un trek, dans l'ordre chronologique. */
function trekStages(trekId, list = state.hikes) {
  return list.filter(h => h.trek_id === trekId)
    .sort((a, b) => (a.start_time || '').localeCompare(b.start_time || ''));
}

function unionBbox(list) {
  const bb = list.map(h => h.bbox).filter(Boolean);
  if (!bb.length) return null;
  return [Math.min(...bb.map(b => b[0])), Math.min(...bb.map(b => b[1])), Math.max(...bb.map(b => b[2])), Math.max(...bb.map(b => b[3]))];
}

function trekTotals(stages) {
  const s = f => stages.reduce((a, h) => a + (f(h) || 0), 0);
  const days = new Set(stages.filter(h => h.start_time).map(h => new Date(h.start_time).toDateString())).size;
  const maxes = stages.map(h => h.ele_max).filter(v => v != null);
  return {
    distance_m: s(h => h.distance_m), ele_gain: s(h => h.ele_gain), ele_loss: s(h => h.ele_loss),
    moving_s: s(h => h.moving_s), duration_s: s(h => h.duration_s),
    ele_max: maxes.length ? Math.max(...maxes) : null, photo_count: s(h => h.photo_count),
    days: days || stages.length, start: stages[0] && stages[0].start_time,
    end: stages.length ? (stages[stages.length - 1].end_time || stages[stages.length - 1].start_time) : null,
    people: [...new Set(stages.flatMap(h => h.people))].sort((a, b) => a.localeCompare(b, 'fr')),
    bbox: unionBbox(stages),
  };
}

/** « 23 → 25 juil. 2026 », ou deux dates complètes si mois/années différents. */
function fmtRange(a, b) {
  if (!a) return 'Date inconnue';
  const d1 = new Date(a), d2 = new Date(b || a);
  if (d1.toDateString() === d2.toDateString()) return fmtDate(a);
  if (d1.getFullYear() === d2.getFullYear() && d1.getMonth() === d2.getMonth()) {
    return `${d1.getDate()} → ${d2.getDate()} ${MONTHS[d1.getMonth()]} ${d1.getFullYear()}`;
  }
  return `${fmtDate(a)} → ${fmtDate(b)}`;
}

/** Nom proposé : le début commun des noms (« Ala-Kul Lake - … J1/J2/J3 » → « Ala-Kul Lake »). */
function defaultTrekName(hikes) {
  const names = hikes.map(h => h.name || '');
  let p = names[0] || '';
  for (const n of names) while (p && !n.startsWith(p)) p = p.slice(0, -1);
  p = p.replace(/[\s\-–—:,(/]*(j|jour|étape|etape|day|part)?\s*\d*\s*$/i, '').replace(/[\s\-–—:,(/]+$/, '').trim();
  if (p.length >= 4) return p;
  const first = [...hikes].sort((a, b) => (a.start_time || '').localeCompare(b.start_time || ''))[0];
  const place = first.massif || first.region || first.commune || first.country;
  return place ? `Trek ${place}` : `Trek du ${fmtDate(first.start_time)}`;
}

/* ---------------------------------------------------------- liste */
function trekRowHtml(trek, stagesInList) {
  const stages = [...stagesInList].sort((a, b) => (a.start_time || '').localeCompare(b.start_time || ''));
  const all = trekStages(trek.id);
  const t = trekTotals(stages);
  const open = state.expandedTreks.has(trek.id);
  const allChecked = state.selecting && stages.every(h => state.selected.has(h.id));
  const cls = ['trek-row', state.selectedTrekId === trek.id ? 'active' : '', allChecked ? 'checked' : ''].join(' ');
  const place = [...new Set(stages.map(h => h.region || h.country).filter(Boolean))].slice(0, 2).join(', ');
  let html = `
    <li data-trek="${trek.id}" class="${cls}" style="--c:${state.colors[stages[0].id] || ''}">
      ${state.selecting ? '<span class="check" aria-hidden="true"></span>' : ''}
      <button class="trek-chevron" data-expand="${trek.id}" title="${open ? 'Replier' : 'Voir les étapes'}">${open ? '▾' : '▸'}</button>
      <div class="li-title"><span class="trek-badge">Trek</span>${esc(trek.name)}</div>
      <div class="li-meta">${fmtRange(t.start, t.end)} · ${plural(all.length, 'étape')}${stages.length < all.length ? ` (${stages.length} affichée${stages.length > 1 ? 's' : ''})` : ''}${place ? ' · ' + esc(place) : ''}</div>
      <div class="li-stats">
        <span>${fmtKm(t.distance_m)}</span><span>${fmtM(t.ele_gain)} D+</span><span>${fmtDur(t.moving_s || t.duration_s)}</span>
        ${t.photo_count ? `<span class="pill">${plural(t.photo_count, 'photo')}</span>` : ''}
      </div>
    </li>`;
  if (open) html += stages.map(h => hikeRowHtml(h, { stage: all.findIndex(x => x.id === h.id) + 1 })).join('');
  return html;
}

function onListClick(e) {
  if (state.mapMode === 'summits') {
    const li = e.target.closest('li[data-summit]');
    if (li) selectSummit(+li.dataset.summit);
    return;
  }
  const exp = e.target.closest('[data-expand]');
  if (exp) {
    const id = +exp.dataset.expand;
    if (state.expandedTreks.has(id)) state.expandedTreks.delete(id); else state.expandedTreks.add(id);
    renderList();
    return;
  }
  const trekLi = e.target.closest('li[data-trek]');
  if (trekLi) {
    const id = +trekLi.dataset.trek;
    if (state.selecting) {
      const stages = trekStages(id);
      const all = stages.every(h => state.selected.has(h.id));
      stages.forEach(h => (all ? state.selected.delete(h.id) : state.selected.add(h.id)));
      renderList();
    } else selectTrek(id);
    return;
  }
  const li = e.target.closest('li[data-id]');
  if (!li) return;
  const id = +li.dataset.id;
  if (state.selecting) {
    if (state.selected.has(id)) state.selected.delete(id); else state.selected.add(id);
    renderList();
  } else selectHike(id);
}

/* ---------------------------------------------------------- sélection multiple */
function setSelecting(on) {
  state.selecting = on;
  if (!on) state.selected.clear();
  $('#select-toggle').textContent = on ? 'Terminer' : 'Sélectionner';
  renderList();
}

function renderSelectBar() {
  const bar = $('#select-bar');
  if (!state.selecting || state.mapMode !== 'tracks') { bar.hidden = true; return; }
  const sel = [...state.selected].map(id => state.hikes.find(h => h.id === id)).filter(Boolean);
  const treks = [...new Set(sel.map(h => h.trek_id).filter(Boolean))];
  const allInOneTrek = sel.length && treks.length === 1 && sel.every(h => h.trek_id === treks[0]);
  let action = '';
  if (allInOneTrek) {
    action = `<button class="btn small" id="sel-remove">Retirer du trek</button>`;
  } else if (treks.length === 1 && sel.length >= 2) {
    const t = state.treks.find(x => x.id === treks[0]);
    action = `<button class="btn small primary" id="sel-group">Ajouter au trek « ${esc(t ? t.name : '')} »</button>`;
  } else {
    action = `<button class="btn small primary" id="sel-group" ${sel.length < 2 ? 'disabled' : ''}>Réunir en trek</button>`;
  }
  bar.hidden = false;
  bar.innerHTML = `<span>${sel.length ? plural(sel.length, 'sortie') + ' sélectionnée' + (sel.length > 1 ? 's' : '') : 'Clique sur les sorties à réunir'}</span>
    <div class="sel-actions">${action}<button class="btn small ghost" id="sel-cancel">Annuler</button></div>`;
  $('#sel-cancel').onclick = () => setSelecting(false);
  if ($('#sel-group')) $('#sel-group').onclick = groupSelected;
  if ($('#sel-remove')) $('#sel-remove').onclick = () => { removeFromTrek(treks[0], sel.map(h => h.id)); setSelecting(false); };
}

async function groupSelected() {
  const sel = [...state.selected].map(id => state.hikes.find(h => h.id === id)).filter(Boolean);
  const trekIds = [...new Set(sel.map(h => h.trek_id).filter(Boolean))];
  try {
    let trekId;
    if (trekIds.length === 1 && sel.some(h => !h.trek_id)) {
      trekId = trekIds[0];
      await api.send('POST', `/api/treks/${trekId}/add`, { hike_ids: sel.map(h => h.id) });
      toast('Étapes ajoutées au trek');
    } else {
      const t = await api.send('POST', '/api/treks', { name: defaultTrekName(sel), hike_ids: sel.map(h => h.id) });
      trekId = t.id;
      toast(`Trek « ${t.name} » créé — tu peux le renommer dans sa fiche`, 5000);
    }
    setSelecting(false);
    await refreshHikes();
    state.expandedTreks.add(trekId);
    selectTrek(trekId);
  } catch (err) { toast('Erreur : ' + err.message); }
}

async function removeFromTrek(trekId, hikeIds) {
  try {
    const r = await api.send('POST', `/api/treks/${trekId}/remove`, { hike_ids: hikeIds });
    await refreshHikes();
    if (r.trek_deleted) toast('Le trek n’avait plus d’étape : il a été dissous');
    else toast(hikeIds.length > 1 ? 'Étapes retirées du trek' : 'Étape retirée du trek');
    if (state.detail && state.detail.kind === 'trek' && !r.trek_deleted) selectTrek(trekId, { fly: false });
    else if (state.detail && state.detail.kind === 'hike') selectHike(state.detail.id, { fly: false });
    else if (r.trek_deleted) closeDetail();
  } catch (err) { toast('Erreur : ' + err.message); }
}

/* ---------------------------------------------------------- fiche d'un trek */
async function selectTrek(id, { fly: doFly = true } = {}) {
  if (state.view !== 'map') switchView('map');
  if (state.mapMode !== 'tracks') setMapMode('tracks', { keepDetail: true });
  stopFlyover();
  const trek = state.treks.find(t => t.id === id);
  if (!trek) return;
  state.selectedTrekId = id; state.selectedId = null; state.selectedSummitId = null; state.multiPick = null;
  renderList();
  const stages = trekStages(id);
  let details;
  try { details = await Promise.all(stages.map(h => api.get(`/api/hikes/${h.id}`))); } catch (err) { toast('Erreur : ' + err.message); return; }
  if (state.selectedTrekId !== id) return;
  // trace continue : les distances de chaque étape sont mises bout à bout
  const track = [], stageStarts = [], photos = [];
  let offset = 0;
  for (const d of details) {
    stageStarts.push(offset);
    for (const p of d.track) track.push([p[0], p[1], p[2], p[3] + offset, p[4]]);
    if (d.track.length) offset += d.track[d.track.length - 1][3];
    photos.push(...d.photos);
  }
  state.detail = { kind: 'trek', id, trek, stages: details, track, stageStarts, photos, totals: trekTotals(stages) };
  setSelectedLines(details.map(d => d.track));
  renderTrekDetail();
  renderPhotoMarkers();
  const b = state.detail.totals.bbox;
  if (doFly && b) {
    const rightPad = window.innerWidth > 720 ? $('#detail').offsetWidth + 40 : 60;
    flyToBounds([[b[0], b[1]], [b[2], b[3]]], { pitch: 55, rightPad });
  }
  const li = $(`#hike-list li[data-trek="${id}"]`);
  if (li) li.scrollIntoView({ block: 'nearest' });
}

function renderTrekDetail() {
  const d = state.detail, el = $('#detail'), t = d.totals;
  el.hidden = false;
  const kmPerDay = t.days ? t.distance_m / t.days : null;
  const stats = [
    ['Distance', fmtKm(t.distance_m)], ['Dénivelé +', fmtM(t.ele_gain)], ['Dénivelé −', fmtM(t.ele_loss)],
    ['Jours', nf0.format(t.days)], ['En mouvement', fmtDur(t.moving_s)], ['Altitude max', fmtM(t.ele_max)],
    ['Moy. / jour', kmPerDay ? fmtKm(kmPerDay) : '–'], ['D+ moy. / jour', t.days ? fmtM(t.ele_gain / t.days) : '–'],
    ['Photos', nf0.format(t.photo_count)],
  ];
  const stageIds = new Set(d.stages.map(s => s.id));
  const summits = state.summits.filter(s => stageIds.has(s.hike_id)).sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  el.innerHTML = `
    <div class="detail-head">
      <input type="text" class="title-input" id="t-name" value="${esc(d.trek.name)}" title="Cliquer pour renommer">
      <button class="icon-btn" id="d-close" title="Fermer">×</button>
    </div>
    <div class="detail-sub"><span class="trek-badge">Trek</span><span>${fmtRange(t.start, t.end)} · ${plural(d.stages.length, 'étape')}</span></div>
    <div class="stat-grid">${stats.map(([l, v]) => `<div class="stat"><div class="v">${v}</div><div class="l">${l}</div></div>`).join('')}</div>
    <div class="detail-actions">
      <button class="btn primary small" id="t-fly">▶ Survol 3D du trek</button>
      <button class="btn small" id="t-recenter">Recentrer</button>
    </div>

    <h4>Profil altimétrique</h4>
    <div class="profile" id="d-profile"></div>

    <h4>Étapes</h4>
    <ol class="stage-list">${d.stages.map((s, i) => `
      <li data-stage="${s.id}">
        <span class="stage-n">J${i + 1}</span>
        <div class="stage-main"><b>${esc(s.name)}</b><span>${fmtDate(s.start_time)} · ${fmtKm(s.distance_m)} · ${fmtM(s.ele_gain)} D+</span></div>
        <button class="icon-btn small" data-unstage="${s.id}" title="Retirer cette étape du trek">×</button>
      </li>`).join('')}</ol>
    <p class="hint">Pour ajouter des étapes : « Sélectionner » dans la liste, coche le trek et les sorties à ajouter.</p>

    <h4>Compagnons</h4>
    <div class="chips">${t.people.length ? t.people.map(n => `<button class="chip readonly chip-name" data-person="${esc(n)}" title="Ouvrir la fiche">${esc(n)}</button>`).join('') : '<span class="hint">Personne — à renseigner dans chaque étape.</span>'}</div>

    <h4>Sommets & cols</h4>
    <div class="summit-chips">${summits.length ? summits.map(s => `
      <button class="summit-chip kind-${s.kind}" data-summit="${s.id}"><span class="sm-icon"></span>${esc(s.name)}${s.ele != null ? ` <b>${fmtM(s.ele)}</b>` : ''}</button>`).join('')
      : '<span class="hint">Aucun pour l’instant.</span>'}</div>
    <button class="btn small" id="t-detect">Détecter les sommets et cols du trek</button>

    <h4>Photos <span id="d-photo-count"></span></h4>
    <div class="gallery" id="d-gallery"></div>
    <p class="hint">Les photos s’ajoutent dans la fiche de chaque étape.</p>

    <h4>Notes du trek</h4>
    <textarea id="t-notes" placeholder="Itinéraire, refuges, logistique, souvenirs…">${esc(d.trek.notes || '')}</textarea>

    <div class="danger-zone"><button class="btn small danger" id="t-dissolve">Dissoudre le trek</button>
      <span class="hint">(les sorties sont conservées)</span></div>`;

  $('#d-close').onclick = closeDetail;
  el.onscroll = () => $('.detail-head', el).classList.toggle('scrolled', el.scrollTop > 2);
  $('#t-name').onkeydown = e => { if (e.key === 'Enter') e.target.blur(); };
  $('#t-name').onchange = e => patchTrek(d.id, { name: e.target.value });
  $('#t-notes').onchange = e => patchTrek(d.id, { notes: e.target.value });
  $('#t-fly').onclick = () => startFlyover(d.track, d.photos);
  $('#t-recenter').onclick = () => {
    const b = t.bbox;
    if (b) flyToBounds([[b[0], b[1]], [b[2], b[3]]], { pitch: 55, rightPad: $('#detail').offsetWidth + 40 });
  };
  $$('[data-stage]', el).forEach(li => { li.onclick = e => { if (!e.target.closest('[data-unstage]')) selectHike(+li.dataset.stage); }; });
  $$('[data-unstage]', el).forEach(b => { b.onclick = () => removeFromTrek(d.id, [+b.dataset.unstage]); });
  $$('[data-summit]', el).forEach(b => { b.onclick = () => selectSummit(+b.dataset.summit); });
  $$('[data-person]', el).forEach(b => { b.onclick = () => openPerson(b.dataset.person); });
  $('#t-detect').onclick = () => runDetection(d.stages.map(s => s.id));
  $('#t-dissolve').onclick = async () => {
    if (!confirm(`Dissoudre le trek « ${d.trek.name} » ? Ses ${d.stages.length} sorties redeviennent indépendantes.`)) return;
    try {
      await api.send('DELETE', `/api/treks/${d.id}`);
      closeDetail();
      await refreshHikes();
      toast('Trek dissous');
    } catch (err) { toast('Erreur : ' + err.message); }
  };
  renderGallery();
  renderProfile();
}

async function patchTrek(id, fields) {
  try {
    const t = await api.send('PATCH', `/api/treks/${id}`, fields);
    const i = state.treks.findIndex(x => x.id === id);
    if (i >= 0) state.treks[i] = t;
    if (state.detail && state.detail.kind === 'trek' && state.detail.id === id) state.detail.trek = t;
    renderList();
    toast('Enregistré', 1200);
  } catch (err) { toast('Erreur : ' + err.message); }
}

function initTrekControls() {
  $('#select-toggle').onclick = () => setSelecting(!state.selecting);
}
