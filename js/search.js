// ---------- Tab: Cerca ----------
// La barra sta nell'header: scrivendo si passa alla vista risultati, svuotandola si torna alla scheda di prima.
let SEARCH_Q = '', SEARCH_HTML = '', PREV_TAB = 'library';
function renderSearchShell(){
  const title = SEARCH_FILTER
    ? `${SEARCH_FILTER.kind === 'tag' ? 'Tag' : 'Genere'}: ${escapeHtml(SEARCH_FILTER.kind === 'genre' ? (IT.genre[SEARCH_FILTER.value] || SEARCH_FILTER.value) : SEARCH_FILTER.value)}`
    : SEARCH_Q.startsWith('#') ? 'Tag e generi' : `Risultati per “${escapeHtml(SEARCH_Q)}”`;
  return `<div class="panel-title">${title}</div><div id="searchResults">${SEARCH_HTML}</div>`;
}
function renderSearchResults(items){
  if (!items.length) return emptyState('Nessun risultato.');
  return `<div class="grid">${items.map(it => `
    <div class="card simple-card"${it.inLibrary ? '' : ` data-id="${it.id}" data-swipe="add" data-not-released="${it.status === 'NOT_YET_RELEASED'}"`}>
      ${it.inLibrary ? '' : '<div class="swipe-bg swipe-bg-add"><span>✓ Aggiungi</span></div>'}
      <div class="card-content">
      <div class="cover-row clickable" role="button" tabindex="0" onclick="openDetails(${it.id})">
        ${coverImg(it.cover, animeTitle(it))}
        <div class="meta">
          <h3>${escapeHtml(animeTitle(it))}</h3>
          <div class="sub">${[IT.format[it.format] || it.format, it.year, it.episodes ? `${it.episodes} ${W().unitAbbr}` : null].filter(Boolean).join(' · ')}</div>
          ${it.avg ? `<span class="score-badge">★ ${it.avg}%</span>` : ''}
        </div>
      </div>
      <div class="actions-row" style="border-top:1px solid var(--border);">
        ${it.inLibrary
          ? libraryStatusPill(it.libraryStatus, it.libraryProgress, it.episodes)
          : `<button class="pill positive" onclick="doAdd(${it.id}, this, ${it.status === 'NOT_YET_RELEASED'})">Aggiungi</button>`}
      </div>
      </div>
    </div>
  `).join('')}</div>`;
}
const LIST_LABELS = {
  CURRENT:   { label:'In corso',   color:'var(--accent)' },
  REPEATING: { label:'In rewatch', color:'var(--accent)' },
  COMPLETED: { label:'Completato', color:'var(--teal)' },
  PAUSED:    { label:'In pausa',   color:'var(--muted)' },
  DROPPED:   { label:'Droppato',   color:'var(--red)' },
  PLANNING:  { label:'Da vedere',  color:'var(--muted)' }
};
const LIST_LABELS_MANGA = { CURRENT:'In lettura', REPEATING:'In rilettura', PLANNING:'Da leggere' };
const listLabel = st => (isManga() && LIST_LABELS_MANGA[st]) || (LIST_LABELS[st] ? LIST_LABELS[st].label : 'Già in lista');
function libraryStatusPill(status, progress, episodes){
  const s = LIST_LABELS[status] || { label:'Già in lista', color:'var(--muted)' };
  const showProgress = progress && status !== 'COMPLETED' && status !== 'PLANNING';
  const prog = showProgress ? ` · ${W().unitAbbr} ${progress}${episodes ? '/' + episodes : ''}` : '';
  return `<span class="pill" style="cursor:default;color:${s.color};border-color:${s.color};">✓ ${listLabel(status)}${prog}</span>`;
}
// cuore condiviso da doAdd (pulsante) e dal gesture controller (swipe): fa la add e allinea cache/stato,
// ritorna lo status assegnato oppure null se la chiamata è fallita (mostra già il toast d'errore)
async function addToLibrary(mediaId, notYetReleased){
  const status = notYetReleased ? 'PLANNING' : 'CURRENT';
  try{
    await api('/add', { method:'POST', body: JSON.stringify({ mediaId, status }) });
    showToast(notYetReleased ? `Non è ancora uscito: aggiunto a "${listLabel('PLANNING')}".` : 'Aggiunta alla libreria.', 'ok');
    delete cache.library;
    delete cache.planning;
    delete ENTRY_OVERRIDE[mediaId];
    if (cache.recs) cache.recs.items = cache.recs.items.filter(x => x.id !== mediaId);
    const fi = SEARCH_FILTER && SEARCH_FILTER.items.find(x => x.id === mediaId);
    if (fi) Object.assign(fi, { inLibrary: true, libraryStatus: status, libraryProgress: 0 });
    const si = SEASONAL_VIEW.items.find(x => x.id === mediaId);
    if (si) Object.assign(si, { inLibrary: true, libraryStatus: status, libraryProgress: 0 });
    return status;
  }catch(err){
    showToast('Errore: ' + err.message, 'error');
    return null;
  }
}
// dopo aver aggiornato il DOM (pulsante o card), riallinea la copia salvata dell'HTML della ricerca
function syncSearchHtml(){
  if (ACTIVE_TAB === 'search' && $('#searchResults')) SEARCH_HTML = $('#searchResults').innerHTML;
}
async function doAdd(mediaId, btn, notYetReleased){
  btn.disabled = true; btn.textContent = 'Aggiungo…';
  const status = await addToLibrary(mediaId, notYetReleased);
  if (status) btn.outerHTML = libraryStatusPill(status, 0, null);
  else { btn.disabled = false; btn.textContent = 'Aggiungi'; }
  syncSearchHtml();
}

// ---------- Ricerca per tag / genere (dati pubblici letti direttamente da AniList) ----------
let SEARCH_FILTER = null;      // { kind:'tag'|'genre', value, sort, page, items, hasNext }
let TAG_INDEX = null;          // tutti i tag e generi AniList, caricati alla prima ricerca con "#"
const FILTER_SORTS = [['POPULARITY_DESC', 'Più popolari'], ['SCORE_DESC', 'Più votati'], ['START_DATE_DESC', 'Più recenti']];
const filterQuery = kind => `query($v:[String], $page:Int, $sort:[MediaSort]){ Page(page:$page, perPage:24){ pageInfo{ hasNextPage }
  media(type:${mediaType()}, isAdult:false, ${kind === 'tag' ? 'tag_in' : 'genre_in'}:$v, sort:$sort){
    id title{english romaji native} coverImage{medium} format episodes seasonYear averageScore status } } }`;
const norm = t => String(t || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();

async function anilistPublic(query, variables){
  const res = await fetch('https://graphql.anilist.co', {
    method:'POST', headers:{ 'Content-Type':'application/json', 'Accept':'application/json' },
    body: JSON.stringify({ query, variables: variables || {} })
  });
  if (res.status === 429) throw new Error('troppe richieste ad AniList, riprova tra un minuto');
  const j = await res.json();
  if (!j.data) throw new Error((j.errors && j.errors[0] && j.errors[0].message) || 'HTTP ' + res.status);
  return j.data;
}

function enterSearchView(){
  if (ACTIVE_TAB === 'search') return;
  PREV_TAB = ACTIVE_TAB;
  ACTIVE_TAB = 'search';
  $$('#tabs button[data-tab]').forEach(b => b.classList.remove('active'));
  const moreBtn = $('#tabsMoreToggle');
  if (moreBtn) moreBtn.classList.remove('active');
  closeTabsSheet();
}

// ---------- Barra in basso mobile: 4 schede fisse + "Altro" apre le rimanenti in un foglio a comparsa ----------
function openTabsSheet(){
  $('#tabs').classList.add('sheet-open');
  $('#tabsMoreToggle').setAttribute('aria-expanded', 'true');
}
function closeTabsSheet(){
  $('#tabs').classList.remove('sheet-open');
  $('#tabsMoreToggle').setAttribute('aria-expanded', 'false');
}
$('#tabsMoreToggle').addEventListener('click', () => {
  $('#tabs').classList.contains('sheet-open') ? closeTabsSheet() : openTabsSheet();
});
$('#tabsSheetBackdrop').addEventListener('click', closeTabsSheet);

// stato in lista di ogni serie, dalle liste già caricate (+ modifiche fatte da questa pagina)
function listStatusMap(){
  const map = {};
  for (const [t, status] of Object.entries(LIST_TABS)){
    if (!cache[t]) continue;
    for (const it of cache[t].items) map[it.id] = { status, progress: it.progress || 0 };
  }
  for (const [id, e] of Object.entries(ENTRY_OVERRIDE)) { if (e) map[id] = e; else delete map[id]; }
  return map;
}

function searchByEl(el){ searchBy(el.dataset.kind, el.dataset.value); }
function searchBy(kind, value){
  closeDetails();
  const input = $('#searchInput');
  input.value = '#' + (kind === 'genre' ? (IT.genre[value] || value) : value);
  $('#headerSearch').classList.add('has-text');
  clearTimeout(searchDebounce);
  enterSearchView();
  SEARCH_Q = input.value.trim();
  SEARCH_FILTER = { kind, value, sort: 'POPULARITY_DESC', page: 0, items: [], hasNext: false };
  scrollContentTop();
  runFilter();
}
function setFilterSort(sort){
  if (!SEARCH_FILTER || SEARCH_FILTER.sort === sort) return;
  SEARCH_FILTER.sort = sort;
  runFilter();
}

async function runFilter(more = false){
  const f = SEARCH_FILTER;
  if (!f) return;
  if (!more){
    f.page = 0; f.items = [];
    SEARCH_HTML = '<div class="loading">Cerco…</div>';
    if (ACTIVE_TAB === 'search') renderTab();
  }
  try{
    const [data] = await Promise.all([
      anilistPublic(filterQuery(f.kind), { v: [f.value], page: f.page + 1, sort: [f.sort] }),
      ensureLists(Object.keys(LIST_TABS)).catch(() => {})
    ]);
    if (SEARCH_FILTER !== f) return;                  // nel frattempo è partita un'altra ricerca
    f.page++;
    f.hasNext = data.Page.pageInfo.hasNextPage;
    const st = listStatusMap();
    f.items = f.items.concat(data.Page.media.map(m => ({
      id: m.id, title: animeTitle(m), titles: m.title, cover: m.coverImage && m.coverImage.medium,
      format: m.format, episodes: m.episodes, year: m.seasonYear, avg: m.averageScore, status: m.status,
      inLibrary: Boolean(st[m.id]), libraryStatus: st[m.id] && st[m.id].status, libraryProgress: st[m.id] && st[m.id].progress
    })));
    SEARCH_HTML = renderFilterResults(f);
  }catch(err){
    if (SEARCH_FILTER !== f) return;
    SEARCH_HTML = emptyState('Errore nella ricerca: ' + err.message);
  }
  if (ACTIVE_TAB === 'search') renderTab();
}

function renderFilterResults(f){
  const sorts = FILTER_SORTS.map(([k, l]) => `<button class="chip ${f.sort === k ? 'active' : ''}" onclick="setFilterSort('${k}')">${l}</button>`).join('');
  return `<div class="recs-filter">${sorts}</div>
    ${f.items.length ? renderSearchResults(f.items) : emptyState('Nessun anime con questo tag.')}
    ${f.hasNext ? `<div style="text-align:center;margin-top:18px;"><button class="btn secondary" onclick="this.disabled=true;this.textContent='Carico…';runFilter(true)">Carica altri</button></div>` : ''}`;
}

async function loadTagIndex(){
  if (TAG_INDEX) return TAG_INDEX;
  const d = await anilistPublic('{ GenreCollection MediaTagCollection { name category isAdult } }');
  TAG_INDEX = d.GenreCollection.filter(g => g !== 'Hentai').map(g => ({ kind: 'genre', name: g, label: IT.genre[g] || g }))
    .concat(d.MediaTagCollection.filter(t => !t.isAdult).map(t => ({ kind: 'tag', name: t.name, label: t.name, category: t.category })));
  return TAG_INDEX;
}
function tagMatches(q){
  const n = norm(q);
  const score = x => { const a = norm(x.label), b = norm(x.name); return (a.startsWith(n) || b.startsWith(n) ? 0 : 1) + (x.kind === 'genre' ? 0 : 0.5); };
  return TAG_INDEX.filter(x => !n || norm(x.label).includes(n) || norm(x.name).includes(n))
    .sort((a, b) => score(a) - score(b) || a.label.localeCompare(b.label)).slice(0, 60);
}
function renderTagSuggestions(q){
  const list = tagMatches(q);
  if (!list.length) return emptyState('Nessun tag o genere contiene “' + q + '”.');
  const chip = x => `<button class="chip ${x.kind === 'genre' ? 'genre' : ''}" data-kind="${x.kind}" data-value="${escapeAttr(x.name)}" onclick="searchByEl(this)">${escapeHtml(x.label)}${x.category ? `<small>${escapeHtml(x.category.split('-')[0])}</small>` : ''}</button>`;
  const genres = list.filter(x => x.kind === 'genre'), tags = list.filter(x => x.kind === 'tag');
  return `${q ? '' : '<p class="hint" style="color:var(--muted);font-size:13px;margin:0 0 14px;">Scrivi dopo il # per filtrare, oppure scegli qui.</p>'}
    ${genres.length ? `<div class="tag-group"><div class="lbl">Generi</div><div class="chips">${genres.map(chip).join('')}</div></div>` : ''}
    ${tags.length ? `<div class="tag-group"><div class="lbl">Tag</div><div class="chips">${tags.map(chip).join('')}</div></div>` : ''}`;
}

let searchDebounce;
function bindSearch(){
  const input = $('#searchInput');
  input.addEventListener('input', () => {
    clearTimeout(searchDebounce);
    const q = input.value.trim();
    $('#headerSearch').classList.toggle('has-text', !!input.value);
    if (!q){
      SEARCH_Q = '';
      if (ACTIVE_TAB === 'search') loadTab(PREV_TAB);
      return;
    }
    enterSearchView();
    if (q.startsWith('#')){
      const name = q.slice(1).trim();
      // stesso tag già aperto (es. ricarica dopo aver chiuso una scheda): aggiorna i risultati
      if (SEARCH_FILTER && name.toLowerCase() === SEARCH_FILTER.value.toLowerCase()){ SEARCH_Q = q; runFilter(); return; }
      SEARCH_FILTER = null;
      SEARCH_Q = q;
      SEARCH_HTML = '<div class="loading">Carico i tag…</div>';
      renderTab();
      searchDebounce = setTimeout(async () => {
        try{
          await loadTagIndex();
          if (q !== SEARCH_Q) return;
          SEARCH_HTML = renderTagSuggestions(name);
        }catch(err){
          if (q !== SEARCH_Q) return;
          SEARCH_HTML = emptyState('Impossibile caricare i tag: ' + err.message);
        }
        if (ACTIVE_TAB === 'search') renderTab();
      }, 150);
      return;
    }
    SEARCH_FILTER = null;
    SEARCH_Q = q;
    SEARCH_HTML = '<div class="loading">Cerco…</div>';
    renderTab();
    searchDebounce = setTimeout(async () => {
      try{
        const r = await api('/search?q=' + encodeURIComponent(q));
        if (q !== SEARCH_Q) return;                    // nel frattempo l'utente ha scritto altro
        SEARCH_HTML = renderSearchResults(r.items);
      }catch(err){
        if (q !== SEARCH_Q) return;
        SEARCH_HTML = emptyState('Errore nella ricerca: ' + err.message);
      }
      if (ACTIVE_TAB === 'search') renderTab();
    }, 400);
  });
  // Invio su "#nome": apre il tag/genere uguale, o il primo suggerito
  input.addEventListener('keydown', e => {
    if (e.key !== 'Enter' || !input.value.trim().startsWith('#') || !TAG_INDEX) return;
    const name = norm(input.value.trim().slice(1));
    const hit = TAG_INDEX.find(x => norm(x.name) === name || norm(x.label) === name) || tagMatches(name)[0];
    if (hit){ e.preventDefault(); searchBy(hit.kind, hit.name); input.blur(); }
  });
  $('#searchClear').addEventListener('click', () => {
    input.value = '';
    input.dispatchEvent(new Event('input'));
    input.focus();
  });
  document.addEventListener('keydown', e => {
    const typing = /INPUT|TEXTAREA/.test(document.activeElement.tagName);
    if (e.key === '/' && !typing && $('#headerSearch').style.display !== 'none'){ e.preventDefault(); input.focus(); }
    if (e.key === 'Escape' && document.activeElement === input && input.value){ $('#searchClear').click(); }
  });
}
bindSearch();

