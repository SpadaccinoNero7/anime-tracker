// ---------- Tab: In corso (library) ----------
function renderLibrary(items){
  if (!CONFIG.baseUrl) return emptyState('Configura l\'indirizzo delle API per iniziare.', '<button class="btn" onclick="openSettings(true)">Apri impostazioni</button>');
  if (!items.length) return emptyState(W().emptyLibrary);
  return `<div class="grid">${renderGrouped(items, libraryCard)}</div>`;
}

function libraryCard(it){
  // contatore principale: i volumi per i manga che li hanno, altrimenti episodi/capitoli
  const vol = perVolumi(it);
  const cap = vol ? it.volumes : it.cap;
  const prog = vol ? (it.progressVolumes || 0) : it.progress;
  const campo = vol ? ",'volumes'" : '';
  const quanti = vol ? volumeUnits : units;
  const pct = cap ? Math.min(100, Math.round((prog / cap) * 100)) : 0;
  const atCap = cap != null && prog >= cap;
  // unità già uscite e non ancora viste; se sei in pari, quando esce la prossima
  const behind = cap != null ? cap - prog : 0;
  const nextAt = it.nextAiringAt ? new Date(it.nextAiringAt * 1000) : null;
  const nextTxt = nextAt ? `Ep. ${it.nextEpisode} ${nextAt.toLocaleDateString('it-IT', { weekday:'short', day:'numeric', month:'short' })}, ${nextAt.toLocaleTimeString('it-IT', { hour:'2-digit', minute:'2-digit' })}` : '';
  return `
  <div class="card" data-id="${it.id}" data-swipe="remove">
    <div class="swipe-bg swipe-bg-remove"><span>✕ Rimuovi</span></div>
    <div class="card-content">
    <div class="cover-row clickable" role="button" tabindex="0" onclick="openDetails(${it.id})">
      ${coverImg(it.cover, animeTitle(it))}
      <div class="meta">
        <h3>${escapeHtml(animeTitle(it))}</h3>
        <div class="sub">${cap != null ? (vol ? `fino al volume ${cap}` : `${W().upTo} ${cap}`) : (it.episodes ? units(it.episodes) : 'in corso')}</div>
        ${behind > 0 ? `<span class="behind-badge">${quanti(behind)} ${W().toSee}</span>`
          : nextTxt ? `<div class="next-ep">In pari · prossimo: ${escapeHtml(nextTxt)}</div>` : ''}
      </div>
    </div>
    <div class="progress-wrap">
      <div class="bar"><i style="width:${pct}%"></i></div>
      <div class="prow">
        <span class="count">${vol ? 'volumi ' : ''}${prog}${cap != null ? ' / ' + cap : ''}</span>
        <div class="steps">
          <button class="step" ${prog<=0?'disabled':''} onclick="doProgress(${it.id},'dec'${campo})">−</button>
          <button class="step" ${atCap?'disabled':''} onclick="doProgress(${it.id},'inc'${campo})">+</button>
        </div>
      </div>
      ${isManga() ? (() => {
        // l'altro contatore, sempre raggiungibile: se sopra ci sono i volumi qui ci sono i capitoli, e viceversa
        const p2 = vol ? it.progress : (it.progressVolumes || 0);
        const cap2 = vol ? it.cap : it.volumes;
        const campo2 = vol ? ",'chapters'" : ",'volumes'";
        return `
      <div class="prow secondary">
        <span class="count">${vol ? 'capitoli' : 'volumi'} ${p2}${cap2 != null ? ' / ' + cap2 : ''}</span>
        <div class="steps">
          <button class="step" ${p2<=0?'disabled':''} onclick="doProgress(${it.id},'dec'${campo2})">−</button>
          <button class="step" ${cap2 != null && p2 >= cap2 ? 'disabled' : ''} onclick="doProgress(${it.id},'inc'${campo2})">+</button>
        </div>
      </div>`; })() : ''}
    </div>
    <div class="actions-row">
      ${!atCap && cap != null ? `<button class="pill" onclick="doProgress(${it.id},'max'${campo})">Segna al massimo</button>` : ''}
      <button class="pill" onclick="doStatus(${it.id},'PAUSED')">Pausa</button>
      <button class="pill danger" onclick="doStatus(${it.id},'DROPPED')">Droppa</button>
      ${it.nextAiringAt ? '' : `<button class="pill positive" onclick="doStatus(${it.id},'COMPLETED')">Completa</button>`}
    </div>
    </div>
  </div>`;
}

// ---------- Salvataggio differito ----------
// Le modifiche (episodi, stato) si vedono subito; al server parte una sola richiesta per serie,
// SYNC_DELAY ms dopo l'ultimo click, con il valore finale ("episodio 7", non +1 +1 -1 +1).
// Chiudendo la scheda dettagli o cambiando tab si invia subito quello che è in sospeso.
const SYNC_DELAY = 200;
const PENDING = {};      // mediaId -> { want:{status?, progress?, score?, notes?}, total, timer, inflight }
let SYNC_ERROR = false;

function hasPending(){ return Object.keys(PENDING).length > 0; }

function queueChange(id, change, total){
  const p = PENDING[id] || (PENDING[id] = { want:null, total:null, timer:null, inflight:null });
  p.want = Object.assign(p.want || {}, change);
  if (total) p.total = total;
  clearTimeout(p.timer);
  p.timer = setTimeout(() => { p.timer = null; flushSync(id); }, SYNC_DELAY);
  SYNC_ERROR = false;
  updateSyncBadge();
}

function flushSync(id){
  const p = PENDING[id];
  if (!p) return Promise.resolve();
  if (p.timer){ clearTimeout(p.timer); p.timer = null; }
  if (p.inflight) return p.inflight;          // finito l'invio in corso, riparte da solo se serve
  if (!p.want){ delete PENDING[id]; updateSyncBadge(); return Promise.resolve(); }
  const want = p.want;
  p.want = null;
  p.inflight = (async () => {
    try{
      if (want.status) await api('/status', { method:'POST', body: JSON.stringify({ mediaId: id, status: want.status }) });
      if (want.progress != null) await api('/progress', { method:'POST', body: JSON.stringify({ mediaId: id, action:'set', value: want.progress }) });
      if (want.progressVolumes != null) await api('/progress', { method:'POST', body: JSON.stringify({ mediaId: id, action:'set', value: want.progressVolumes, field:'volumes' }) });
      if (want.score != null || want.notes != null){
        const body = { mediaId: id };
        if (want.score != null) body.score = want.score;
        if (want.notes != null) body.notes = want.notes;
        const r = await api('/score', { method:'POST', body: JSON.stringify(body) });
        if (!r.ok) throw new Error(r.error || 'voto non salvato');
      }
      if (!p.want) delete ENTRY_OVERRIDE[id];
      // arrivato all'ultimo episodio (o all'ultimo volume) AniList può completare la serie da solo: rileggi lo stato vero
      const finito = want.progress != null ? want.progress : want.progressVolumes;
      if (finito != null && p.total && finito >= p.total && !p.want) reloadEntry(id);
    }catch(err){
      SYNC_ERROR = true;
      p.want = null;
      if (p.timer){ clearTimeout(p.timer); p.timer = null; }
      delete ENTRY_OVERRIDE[id];
      showToast('Salvataggio non riuscito (' + err.message + '): ricarico i dati.', 'error');
      reloadEntry(id);
    }
  })();
  return p.inflight.then(() => {
    p.inflight = null;
    if (p.want && !p.timer) return flushSync(id);   // modifiche arrivate durante l'invio
    if (!p.want && !p.timer) delete PENDING[id];
    updateSyncBadge();
  });
}

async function flushAll(){
  for (let i = 0; i < 5 && hasPending(); i++){
    await Promise.all(Object.keys(PENDING).map(id => flushSync(Number(id))));
  }
}

// dopo un errore o un completamento automatico: rilegge lo stato e aggiorna quello che è a schermo
function reloadEntry(id){
  invalidateLists();
  if (DETAIL && DETAIL.id === id){
    DETAIL_DIRTY = true;
    getEntry(id).then(e => { if (DETAIL && DETAIL.id === id){ DETAIL.entry = e; renderMyList(); } }).catch(() => {});
  } else if (!DETAIL) refreshActive();
}

function refreshActive(){
  if (ACTIVE_TAB === 'search') $('#searchInput').dispatchEvent(new Event('input'));
  else loadTab(ACTIVE_TAB, true, true);
}

function updateSyncBadge(){
  const b = $('#syncBadge');
  clearTimeout(updateSyncBadge._t);
  if (hasPending()){ b.textContent = 'Salvataggio…'; b.className = 'sync-badge show'; return; }
  if (SYNC_ERROR || !b.classList.contains('show')){ b.className = 'sync-badge'; return; }
  b.textContent = '✓ Salvato'; b.className = 'sync-badge show ok';
  updateSyncBadge._t = setTimeout(() => { if (!hasPending()) b.className = 'sync-badge'; }, 1500);
}

window.addEventListener('beforeunload', e => {
  if (!hasPending()) return;
  flushAll();
  e.preventDefault(); e.returnValue = '';
});
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushAll(); });

// ---------- Azioni dalle card ----------
function doProgress(mediaId, action, field){
  const item = cache.library && cache.library.items.find(x => x.id === mediaId);
  if (!item) return;
  const vol = field === 'volumes';
  const cap = vol ? item.volumes : item.cap;
  const attuale = vol ? (item.progressVolumes || 0) : item.progress;
  let v = attuale;
  if (action === 'inc') v = cap != null ? Math.min(v + 1, cap) : v + 1;
  else if (action === 'dec') v = Math.max(0, v - 1);
  else if (action === 'max' && cap != null) v = cap;
  if (v === attuale) return;
  const nuovo = vol ? { progressVolumes:v } : { progress:v };
  // avanzando di un volume salgono anche i capitoli, se l'impostazione è attiva e i totali si conoscono
  if (vol){
    const stima = capitoliDaVolumi(item.chapters != null ? item.chapters : item.cap, item.volumes, v, item.progress);
    if (stima != null) nuovo.progress = stima;
  }
  if (vol) item.progressVolumes = v;
  if (nuovo.progress != null) item.progress = nuovo.progress;
  ENTRY_OVERRIDE[mediaId] = { status:'CURRENT', progress:item.progress, progressVolumes:item.progressVolumes || 0 };
  ['upcoming','stats'].forEach(t => delete cache[t]);
  queueChange(mediaId, nuovo, vol ? item.volumes : item.episodes);
  renderTab();
}

function doStatus(mediaId, status){
  const list = cache[ACTIVE_TAB] && cache[ACTIVE_TAB].items;
  let item = null;
  if (list){
    const i = list.findIndex(x => x.id === mediaId);
    if (i >= 0) item = list.splice(i, 1)[0];
  }
  // le altre liste si ricaricano quando le apri (dopo che il salvataggio è partito)
  Object.keys(LIST_TABS).concat(['recs','upcoming','stats']).forEach(t => { if (t !== ACTIVE_TAB) delete cache[t]; });
  const progress = status === 'COMPLETED' && item && item.episodes ? item.episodes : (item && item.progress) || 0;
  ENTRY_OVERRIDE[mediaId] = { status, progress };
  queueChange(mediaId, { status });
  const labels = { PAUSED:'Messa in pausa.', DROPPED:'Droppata.', COMPLETED:'Segnata come completata.', CURRENT:'Spostata in In corso.' };
  showToast(labels[status] || 'Aggiornata.', 'ok');
  renderTab();
}

// ---------- Tab: Da vedere ----------
const planningAiring = st => st === 'NOT_YET_RELEASED' ? 'Non ancora uscito'
  : st === 'RELEASING' ? (isManga() ? 'In pubblicazione' : 'In trasmissione') : null;
function planningCard(it){
  return `
    <div class="card simple-card" data-id="${it.id}" data-swipe="remove">
      <div class="swipe-bg swipe-bg-remove"><span>✕ Rimuovi</span></div>
      <div class="card-content">
      <div class="cover-row clickable" role="button" tabindex="0" onclick="openDetails(${it.id})">
        ${coverImg(it.cover, animeTitle(it))}
        <div class="meta">
          <h3>${escapeHtml(animeTitle(it))}</h3>
          <div class="sub">${[IT.format[it.format] || it.format, it.year, it.episodes ? `${it.episodes} ${W().unitAbbr}` : null].filter(Boolean).join(' · ')}</div>
          ${it.avg ? `<span class="score-badge">★ ${it.avg}%</span>` : ''}
          ${planningAiring(it.mediaStatus) ? `<div class="because">${planningAiring(it.mediaStatus)}${it.nextAiringAt && it.mediaStatus === 'NOT_YET_RELEASED' ? ' · dal ' + new Date(it.nextAiringAt * 1000).toLocaleDateString('it-IT', { day:'numeric', month:'short' }) : ''}</div>` : ''}
        </div>
      </div>
      <div class="actions-row" style="border-top:1px solid var(--border);">
        ${it.mediaStatus === 'NOT_YET_RELEASED'
          ? `<button class="pill" onclick="openDetails(${it.id})">Dettagli</button>`
          : `<button class="pill positive" onclick="doStatus(${it.id},'CURRENT')">${W().start}</button>
             <button class="pill" onclick="doStatus(${it.id},'COMPLETED')">${W().doneShort}</button>`}
      </div>
      </div>
    </div>`;
}
function renderPlanning(items){
  if (!items.length) return emptyState(W().emptyPlanning);
  return `<div class="grid">${renderGrouped(items, planningCard)}</div>`;
}

// ---------- Tabs: paused / dropped / completed ----------
function simpleCard(it, opts){
  return `
    <div class="card simple-card" data-id="${it.id}" data-swipe="remove">
      <div class="swipe-bg swipe-bg-remove"><span>✕ Rimuovi</span></div>
      <div class="card-content">
      <div class="cover-row clickable" role="button" tabindex="0" onclick="openDetails(${it.id})">
        ${coverImg(it.cover, animeTitle(it))}
        <div class="meta">
          <h3>${escapeHtml(animeTitle(it))}</h3>
          <div class="sub">${perVolumi(it) && it.volumes != null ? volumeUnits(it.volumes) : (it.episodes ? units(it.episodes) : '')}${it.progress != null && !opts.hideProgress
            ? ` · ${W().seen} ${perVolumi(it) ? (it.progressVolumes || 0) : it.progress}` : ''}</div>
          ${it.score ? `<span class="score-badge" title="Il tuo voto">★ ${fmtScore(it.score)}/10</span>` : ''}
        </div>
      </div>
      ${opts.resumable ? `<div class="actions-row" style="border-top:1px solid var(--border);"><button class="pill positive" onclick="doStatus(${it.id},'CURRENT')">Riprendi</button></div>` : ''}
      </div>
    </div>`;
}
function renderSimpleList(items, opts={}){
  if (!items.length) return emptyState(opts.emptyMsg || 'Nessuna serie qui.');
  return `<div class="grid">${renderGrouped(items, it => simpleCard(it, opts))}</div>`;
}

