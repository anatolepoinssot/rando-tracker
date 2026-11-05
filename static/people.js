'use strict';
/* =====================================================================
   COMPAGNONS — grille et fiche compagnon (photo, stats par années, lieux, sorties, PDF)
   ===================================================================== */

const avatarHue = name => [...(name || '?')].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 360, 7);
const initialsOf = name => (name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase();
function avatarHtml(p, size = 64) {
  const style = `width:${size}px;height:${size}px;font-size:${Math.round(size * 0.38)}px`;
  if (p.photo_thumb_url) return `<span class="avatar" style="${style}"><img src="${size > 120 ? p.photo_url : p.photo_thumb_url}" alt=""></span>`;
  return `<span class="avatar initials" style="${style};background:hsl(${avatarHue(p.name)} 45% 42%)">${esc(initialsOf(p.name))}</span>`;
}

/** Ouvre la fiche d'un compagnon (par nom ou par id). */
function openPerson(nameOrId) {
  const p = typeof nameOrId === 'number' ? state.people.find(x => x.id === nameOrId) : state.people.find(x => x.name === nameOrId);
  if (!p) return;
  state.personId = p.id;
  state.personYears = new Set();
  switchView('people');
}

function renderPeopleView() {
  if (state.view !== 'people') return;
  if (state.personId && state.people.some(p => p.id === state.personId)) renderPersonProfile();
  else { state.personId = null; renderPeopleGrid(); }
}

/* ---------------------------------------------------------- grille */
function renderPeopleGrid() {
  const box = $('#people-wrap');
  const agg = {};
  for (const h of state.hikes) {
    for (const n of h.people) {
      const a = agg[n] || (agg[n] = { n: 0, dist: 0, gain: 0, last: '' });
      a.n++; a.dist += h.distance_m || 0; a.gain += h.ele_gain || 0;
      if ((h.start_time || '') > a.last) a.last = h.start_time;
    }
  }
  const list = [...state.people].sort((a, b) => ((agg[b.name] || {}).n || 0) - ((agg[a.name] || {}).n || 0) || a.name.localeCompare(b.name, 'fr'));
  box.innerHTML = `
    <div class="people-head"><h2>Compagnons</h2><span class="hint">${plural(list.length, 'personne')} · clique sur une carte pour ouvrir sa fiche</span></div>
    ${list.length ? `<div class="people-grid">${list.map(p => {
      const a = agg[p.name] || { n: 0, dist: 0, gain: 0, last: '' };
      return `<button class="person-card" data-pid="${p.id}">
        ${avatarHtml(p, 72)}
        <span class="pc-name">${esc(p.name)}</span>
        <span class="pc-stats">${plural(a.n, 'sortie')}${a.n ? ` · ${fmtKm(a.dist)} · ${fmtM(a.gain)} D+` : ''}</span>
        ${a.last ? `<span class="pc-last">dernière : ${fmtDate(a.last)}</span>` : ''}
      </button>`;
    }).join('')}</div>` : '<p class="hint">Ajoute des compagnons dans la fiche d’une sortie pour les retrouver ici.</p>'}`;
  $$('.person-card', box).forEach(c => { c.onclick = () => openPerson(+c.dataset.pid); });
}

/* ---------------------------------------------------------- fiche */
async function renderPersonProfile() {
  const id = state.personId, box = $('#people-wrap');
  const years = [...(state.personYears || [])].sort();
  let prof;
  try { prof = await api.get(`/api/people/${id}/profile${years.length ? '?years=' + years.join(',') : ''}`); }
  catch (err) { box.innerHTML = `<p class="hint">Erreur : ${esc(err.message)}</p>`; return; }
  if (state.personId !== id || state.view !== 'people') return;
  const p = prof.person, st = prof.stats;
  const q = years.length ? '?years=' + years.join(',') : '';
  const allSel = !years.length;
  const KL = { sommet: 'Sommet', col: 'Col', lieu: 'Lieu marquant' };
  const pc = st.places;
  box.innerHTML = `
    <button class="linklike back" id="pp-back">← Tous les compagnons</button>
    <div class="pp-head">
      <label class="pp-avatar" title="Changer la photo de profil">
        ${avatarHtml(p, 132)}
        <span class="pp-avatar-edit">${p.photo_url ? 'Changer' : 'Ajouter une photo'}</span>
        <input type="file" id="pp-photo" accept="image/*,.heic,.heif" hidden>
      </label>
      <div class="pp-title">
        <input type="text" class="title-input big" id="pp-name" value="${esc(p.name)}" title="Cliquer pour renommer">
        <div class="hint">${st.first ? (st.first.slice(0, 10) === (st.last || '').slice(0, 10) ? fmtDate(st.first) : `du ${fmtDate(st.first)} au ${fmtDate(st.last)}`) : 'Aucune sortie sur cette période'}</div>
        ${p.photo_url ? '<button class="linklike muted" id="pp-photo-del">Retirer la photo</button>' : ''}
      </div>
      <a class="btn primary pp-pdf" id="pp-pdf" href="/api/people/${p.id}/report.pdf${q}" download>Exporter en PDF</a>
    </div>

    <div class="pp-years">
      <span class="hint">Période :</span>
      <button class="year-chip ${allSel ? 'on' : ''}" data-year="all">Toutes les années</button>
      ${prof.years_available.map(y => `<button class="year-chip ${!allSel && years.includes(y) ? 'on' : ''}" data-year="${y}">${y}</button>`).join('')}
      <span class="hint small">Clique sur plusieurs années pour les cumuler.</span>
    </div>

    <div class="cards pp-cards">
      <div class="card"><div class="v">${nf0.format(st.count)}</div><div class="l">Sorties ensemble</div></div>
      <div class="card"><div class="v">${fmtKm(st.distance_m)}</div><div class="l">Distance</div></div>
      <div class="card"><div class="v">${fmtM(st.ele_gain)}</div><div class="l">Dénivelé positif</div></div>
      <div class="card"><div class="v">${fmtHours(st.moving_s)}</div><div class="l">Temps en mouvement (${fmtDur(st.moving_s)})</div></div>
      <div class="card"><div class="v">${fmtM(st.ele_max)}</div><div class="l">Plus haut point ensemble</div></div>
      <div class="card"><div class="v">${nf0.format(pc.sommet)} / ${nf0.format(pc.col)} / ${nf0.format(pc.lieu)}</div><div class="l">Sommets / cols / lieux</div></div>
    </div>

    ${prof.per_year.length > 1 ? `<div class="panel"><div class="panel-head"><h3>Année par année</h3></div>
      <div class="table-wrap"><table class="pp-table"><thead><tr><th>Année</th><th class="num">Sorties</th><th class="num">Distance</th><th class="num">D+</th><th class="num">En mouvement</th></tr></thead>
      <tbody>${prof.per_year.map(y => `<tr class="static"><td><b>${y.year}</b></td><td class="num">${y.count}</td><td class="num">${y.count ? fmtKm(y.distance_m) : '–'}</td><td class="num">${y.count ? fmtM(y.ele_gain) : '–'}</td><td class="num">${y.count ? fmtDur(y.moving_s) : '–'}</td></tr>`).join('')}</tbody></table></div></div>` : ''}

    <div class="panel"><div class="panel-head"><h3>Sommets, cols et lieux marquants</h3><span class="hint">clic = voir sur la carte</span></div>
      ${prof.places.length ? `<ul class="pp-places">${prof.places.map(x => `
        <li data-summit="${x.id}" class="kind-${x.kind}"><span class="sm-icon"></span>
          <div><b>${esc(x.name)}</b>${x.ele != null ? ` · ${fmtM(x.ele)}` : ''}<br><small>${KL[x.kind] || ''} · ${x.date ? fmtSummitDate(x) : 'date ?'}${x.hike_name ? ' · ' + esc(x.hike_name) : ''}</small></div>
          ${x.photo_thumb_url ? `<img src="${x.photo_thumb_url}" alt="" loading="lazy">` : ''}</li>`).join('')}</ul>`
        : '<p class="hint">Aucun sommet, col ou lieu marquant sur cette période. Ajoute-les dans la vue Sommets (bouton « Détecter » ou « + Ajouter »).</p>'}
    </div>

    <div class="panel"><div class="panel-head"><h3>Sorties ensemble</h3><span class="hint">clic = ouvrir la sortie</span></div>
      ${prof.hikes.length ? `<div class="table-wrap"><table class="pp-table"><thead><tr><th>Date</th><th>Sortie</th><th class="num">Distance</th><th class="num">D+</th><th class="num">Durée</th></tr></thead>
      <tbody>${[...prof.hikes].reverse().map(h => `<tr data-hike="${h.id}"><td>${fmtDate(h.start_time)}</td><td class="name">${esc(h.name)}</td><td class="num">${fmtKm(h.distance_m)}</td><td class="num">${fmtM(h.ele_gain)}</td><td class="num">${fmtDur(h.moving_s ?? h.duration_s)}</td></tr>`).join('')}</tbody></table></div>`
        : '<p class="hint">Aucune sortie sur cette période.</p>'}
    </div>`;

  $('#pp-back').onclick = () => { state.personId = null; renderPeopleView(); };
  $$('.year-chip', box).forEach(b => {
    b.onclick = () => {
      if (b.dataset.year === 'all') state.personYears = new Set();
      else {
        const y = +b.dataset.year;
        if (state.personYears.has(y)) state.personYears.delete(y); else state.personYears.add(y);
        if (state.personYears.size === prof.years_available.length) state.personYears = new Set();   // tout coché = toutes
      }
      renderPersonProfile();
    };
  });
  $('#pp-photo').onchange = async e => {
    const f = e.target.files[0]; e.target.value = '';
    if (!f) return;
    const fd = new FormData(); fd.append('file', f);
    toast('Envoi de la photo…', 20000);
    try { syncPerson(await api.upload(`/api/people/${id}/photo`, fd)); toast('Photo de profil enregistrée', 1500); renderPersonProfile(); }
    catch (err) { toast('Erreur : ' + err.message); }
  };
  if ($('#pp-photo-del')) $('#pp-photo-del').onclick = async () => {
    try { syncPerson(await api.send('DELETE', `/api/people/${id}/photo`)); renderPersonProfile(); } catch (err) { toast('Erreur : ' + err.message); }
  };
  $('#pp-name').onkeydown = e => { if (e.key === 'Enter') e.target.blur(); };
  $('#pp-name').onchange = async e => {
    try {
      syncPerson(await api.send('PATCH', `/api/people/${id}`, { name: e.target.value }));
      await refreshHikes();      // le nom apparaît partout (sorties, sommets, filtres)
      toast('Renommé', 1200);
    } catch (err) { toast('Erreur : ' + err.message); e.target.value = p.name; }
  };
  $$('.pp-places li', box).forEach(li => { li.onclick = () => selectSummit(+li.dataset.summit); });
  $$('tr[data-hike]', box).forEach(tr => { tr.onclick = () => selectHike(+tr.dataset.hike); });
}

function syncPerson(p) {
  const i = state.people.findIndex(x => x.id === p.id);
  if (i >= 0) state.people[i] = { ...state.people[i], ...p };
}
