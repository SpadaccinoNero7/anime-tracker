// ---------- Ordina e filtra le liste ----------
// Scelte ricordate per scheda in localStorage (solo comodità: se non c'è si riparte dai valori predefiniti).
const LIST_SORTS = {
  library:   [['updated','Aggiornate di recente'], ['behind','Più episodi da recuperare'], ['next','Prossima uscita'], ['pct','Più avanti'], ['title','Titolo']],
  planning:  [['added','Aggiunte di recente'], ['avg','Voto medio AniList'], ['year','Anno di uscita'], ['title','Titolo']],
  completed: [['finished','Finite di recente'], ['score','Il tuo voto'], ['title','Titolo']],
  paused:    [['updated','Aggiornate di recente'], ['pct','Più avanti'], ['title','Titolo']],
  dropped:   [['updated','Aggiornate di recente'], ['pct','Più avanti'], ['title','Titolo']]
};
// gli ordinamenti offerti nella modalità attiva: un manga non ha una "prossima uscita" da AniList,
// e dove si parla di episodi si parla di capitoli
function listSorts(tab){
  const sorts = LIST_SORTS[tab] || [];
  if (!isManga()) return sorts;
  return sorts.filter(([k]) => k !== 'next').map(([k, t]) => [k, t.replace('episodi', 'capitoli')]);
}
const LIST_VIEW_KEY = 'animeListView';
let LIST_VIEW = {};
try { LIST_VIEW = JSON.parse(localStorage.getItem(LIST_VIEW_KEY)) || {}; } catch (e) { LIST_VIEW = {}; }
LIST_VIEW = Object.assign({}, LIST_VIEW);

function listView(tab){
  const v = LIST_VIEW[tab] || (LIST_VIEW[tab] = {});
  // anche quando l'ordinamento salvato non vale in questa modalità (es. "prossima uscita" sui manga)
  if (!listSorts(tab).some(s => s[0] === v.sort)) v.sort = listSorts(tab)[0][0];
  return v;
}

function setListView(tab, key, value){
  const v = listView(tab);
  if (value === '' || value == null || value === false) delete v[key]; else v[key] = value;
  if (key !== 'page') delete v.page;   // un filtro o un ordinamento diverso cambia i risultati: si riparte dalla prima pagina
  if (key !== 'q' && key !== 'page'){ try { localStorage.setItem(LIST_VIEW_KEY, JSON.stringify(LIST_VIEW, (k, x) => (k === 'q' || k === 'page') ? undefined : x)); } catch (e) {} }
  if (ACTIVE_TAB !== tab) return;
  if (key === 'q' || key === 'page') renderListBody(tab);  // mentre scrivi (o si cambia pagina) non ridisegna la barra
  else renderTab();
}

// pagina corrente di una lista: cambia solo il corpo (non la barra filtri) e scorre in cima ai risultati
function goToListPage(tab, page){
  setListView(tab, 'page', page);
  const el = $('#content');
  if (el) el.scrollIntoView({ block:'start', behavior:'smooth' });
}

function resetListView(tab){ LIST_VIEW[tab] = {}; setListView(tab, 'sort', LIST_SORTS[tab][0][0]); }

// ---------- Raggruppa per franchise (stagioni collegate) ----------
// Le "cartelle" uniscono le stagioni di una stessa serie usando le relazioni prequel/sequel di AniList,
// così in liste come "Completati" non ci si perde tra dieci righe della stessa serie.
const RELATIONS_QUERY = `query($ids:[Int]){ Page(perPage:50){ media(id_in:$ids){ id relations{edges{relationType node{id type}}} } } }`;
const RELATIONS_CACHE = {};             // mediaId -> [{ id, t }] legami stagione (anime/manga come la lista), t = tipo di relazione
let relationsFetch = Promise.resolve();

// PREQUEL/SEQUEL = stagioni vere e proprie; SIDE_STORY/PARENT = storie parallele nello stesso franchise
// (es. Horimiya ↔ Horimiya: The Missing Pieces). Non ALTERNATIVE/SPIN_OFF: spesso sono opere troppo diverse
// (altra continuity, tono comico, ecc.) per stare nella stessa cartella.
const SEASON_RELATION_TYPES = new Set(['PREQUEL', 'SEQUEL', 'SIDE_STORY', 'PARENT']);
function seasonLinks(m){
  return ((m.relations && m.relations.edges) || [])
    .filter(e => SEASON_RELATION_TYPES.has(e.relationType) && e.node && e.node.type === mediaType())
    .map(e => ({ id: e.node.id, t: e.relationType }));
}

// scarica le relazioni mancanti (in blocchi da 50) e le mette in cache; non fallisce mai:
// una serie di cui non si sa nulla resta semplicemente non raggruppata
async function fetchRelations(ids){
  const missing = [...new Set(ids)].filter(id => !(id in RELATIONS_CACHE));
  for (let i = 0; i < missing.length; i += 50){
    const chunk = missing.slice(i, i + 50);
    try{
      const data = await anilistPublic(RELATIONS_QUERY, { ids: chunk });
      const got = new Set();
      for (const m of (data.Page.media || [])){ got.add(m.id); RELATIONS_CACHE[m.id] = seasonLinks(m); }
      chunk.forEach(id => { if (!got.has(id)) RELATIONS_CACHE[id] = []; });
    }catch(e){ chunk.forEach(id => { if (!(id in RELATIONS_CACHE)) RELATIONS_CACHE[id] = []; }); }
  }
}

// Scarica anche le stagioni "di passaggio" che non sono in lista (es. la S2 mai vista tra S1 e S3),
// altrimenti la catena prequel/sequel si spezza e S1 e S3 finiscono in cartelle diverse.
// Si segue solo PREQUEL/SEQUEL, per non allargarsi a mezzo franchise; massimo 6 salti.
async function fetchRelationsDeep(ids){
  let frontier = ids;
  for (let hop = 0; hop < 6 && frontier.length; hop++){
    await fetchRelations(frontier);
    const next = new Set();
    frontier.forEach(id => (RELATIONS_CACHE[id] || []).forEach(l => {
      if ((l.t === 'PREQUEL' || l.t === 'SEQUEL') && !(l.id in RELATIONS_CACHE)) next.add(l.id);
    }));
    frontier = [...next];
  }
}

// una volta arrivate le relazioni mancanti, ridisegna la scheda (se è ancora quella aperta)
function ensureRelationsFor(tab, items){
  const ids = items.map(it => it.id);
  if (ids.every(id => id in RELATIONS_CACHE)) return;
  relationsFetch = relationsFetch.then(() => fetchRelationsDeep(ids)).then(() => {
    if (ACTIVE_TAB === tab && cache[tab]) renderListBody(tab);
  });
}

// unione per insiemi su tutto il grafo noto (anche i nodi fuori lista fanno da ponte);
// restituisce i gruppi di item della lista, nell'ordine della lista
function franchiseGroups(items){
  const parent = {};
  const find = x => (parent[x] === undefined ? x : parent[x] === x ? x : (parent[x] = find(parent[x])));
  const union = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent[ra] = rb; };
  Object.keys(RELATIONS_CACHE).forEach(k => { parent[k] = Number(k); });
  Object.keys(RELATIONS_CACHE).forEach(k => RELATIONS_CACHE[k].forEach(l => {
    if (parent[l.id] === undefined) parent[l.id] = l.id;
    union(Number(k), l.id);
  }));
  // Map e non oggetto: con chiavi numeriche Object.values rimetterebbe i gruppi in ordine di id, perdendo l'ordinamento scelto
  const groups = new Map();
  items.forEach(it => { const r = find(it.id); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(it); });
  return [...groups.values()];
}

// posizione di ogni stagione nella catena: numero di prequel a monte (anche fuori lista)
function seasonDepth(id, seen = new Set()){
  if (seen.has(id)) return 0;
  seen.add(id);
  let d = 0;
  for (const l of (RELATIONS_CACHE[id] || [])){
    if (l.t === 'PREQUEL') d = Math.max(d, 1 + seasonDepth(l.id, seen));
    else if (l.t === 'PARENT' || l.t === 'SIDE_STORY') d = Math.max(d, 0);
  }
  return d;
}
function sortSeasons(group){
  return group.slice().sort((a, b) => seasonDepth(a.id) - seasonDepth(b.id)
    || (a.year || 9999) - (b.year || 9999) || a._i - b._i);
}

const EXPANDED_GROUPS = new Set();
function toggleGroup(key){
  if (EXPANDED_GROUPS.has(key)) EXPANDED_GROUPS.delete(key); else EXPANDED_GROUPS.add(key);
  renderListBody(ACTIVE_TAB);
}

// disegna gli item raggruppati: le serie singole restano normali card, i gruppi diventano una "cartella"
// che si apre mostrando tutte le stagioni (cardFn genera l'html di una singola card)
function renderGrouped(items, cardFn){
  if (VIEW.groupSeasons === false) return items.map(cardFn).join('');
  return items.map(group => {
    if (!Array.isArray(group)) return cardFn(group);
    if (group.length === 1) return cardFn(group[0]);
    const sorted = sortSeasons(group);
    const key = String(Math.min(...group.map(it => it.id)));
    const open = EXPANDED_GROUPS.has(key);
    return `
    <div class="card folder-card${open ? ' open' : ''}">
      <div class="cover-row clickable" role="button" tabindex="0" aria-expanded="${open}" onclick="toggleGroup('${key}')">
        <div class="folder-stack">${sorted.slice(0, 3).map(it => coverImg(it.cover, animeTitle(it))).join('')}</div>
        <div class="meta">
          <h3>${escapeHtml(animeTitle(sorted[0]))}</h3>
          <div class="sub">${sorted.length} ${isManga() ? 'opere collegate' : 'stagioni'}</div>
        </div>
        <span class="folder-caret">${open ? '▲' : '▼'}</span>
      </div>
      ${open ? `<div class="folder-items">${sorted.map(cardFn).join('')}</div>` : ''}
    </div>`;
  }).join('');
}

function viewItems(tab, items){
  const v = listView(tab);
  const norm = s => (s || '').toLocaleLowerCase('it').normalize('NFD').replace(/[̀-ͯ]/g, '');
  const q = norm(v.q).trim();
  let out = items.map((it, i) => Object.assign({ _i: i }, it));
  if (q) out = out.filter(it => norm(animeTitle(it)).includes(q));
  if (tab === 'library' && v.behind) out = out.filter(it => it.cap != null && it.cap > it.progress);
  if (tab === 'planning' && v.aired === 'out') out = out.filter(it => it.mediaStatus !== 'NOT_YET_RELEASED');
  if (tab === 'planning' && v.aired === 'soon') out = out.filter(it => it.mediaStatus === 'NOT_YET_RELEASED');
  if (tab === 'completed' && v.year) out = out.filter(it => v.year === 'none' ? !it.year : String(it.year) === v.year);
  if (tab === 'completed' && v.score){
    const s = v.score;
    out = out.filter(it => s === 'none' ? !it.score : s === 'low' ? it.score && it.score < 60 : it.score >= Number(s));
  }
  const behind = it => it.cap != null ? Math.max(0, it.cap - it.progress) : 0;
  const pct = it => { const t = it.episodes || it.cap; return t ? (it.progress || 0) / t : 0; };
  const desc = f => (a, b) => (f(b) || 0) - (f(a) || 0) || a._i - b._i;
  const cmp = {
    updated: desc(it => it.updatedAt),
    behind: desc(behind),
    next: (a, b) => (a.nextAiringAt || Infinity) - (b.nextAiringAt || Infinity) || a._i - b._i,
    pct: desc(pct),
    added: (a, b) => a._i - b._i,
    avg: desc(it => it.avg),
    year: desc(it => it.year),
    score: desc(it => it.score),
    finished: (a, b) => (b.completedAt || '').localeCompare(a.completedAt || '') || (b.updatedAt || 0) - (a.updatedAt || 0),
    title: (a, b) => animeTitle(a).localeCompare(animeTitle(b), 'it', { sensitivity:'base' })
  }[v.sort];
  return out.sort(cmp);
}

function listToolbar(tab, items){
  const v = listView(tab);
  const opt = (val, text, cur) => `<option value="${escapeAttr(val)}" ${String(cur || '') === val ? 'selected' : ''}>${escapeHtml(text)}</option>`;
  const sel = (key, label, options) => `<select aria-label="${label}" onchange="setListView('${tab}','${key}',this.value)">${options}</select>`;
  let html = `<div class="list-tools">
    <input type="search" placeholder="Filtra per titolo…" value="${escapeAttr(v.q || '')}" oninput="setListView('${tab}','q',this.value)" aria-label="Filtra per titolo">
    ${sel('sort', 'Ordina', listSorts(tab).map(([k, t]) => opt(k, t, v.sort)).join(''))}`;
  if (tab === 'library')
    html += `<button class="pill${v.behind ? ' active' : ''}" onclick="setListView('library','behind',${!v.behind})">Solo con ${W().units} ${W().toSee}</button>`;
  if (tab === 'planning')
    html += sel('aired', 'Uscita', opt('', 'Tutte', v.aired) + opt('out', 'Già uscite', v.aired) + opt('soon', 'Non ancora uscite', v.aired));
  if (tab === 'completed'){
    const years = [...new Set(items.map(it => it.year).filter(Boolean))].sort((a, b) => b - a);
    html += sel('year', 'Anno', opt('', 'Tutti gli anni', v.year) + years.map(y => opt(String(y), 'Finite nel ' + y, v.year)).join('')
      + (items.some(it => !it.year) ? opt('none', 'Senza data', v.year) : ''));
    html += sel('score', 'Voto', opt('', 'Qualsiasi voto', v.score) + ['90', '80', '70'].map(s => opt(s, 'Da ' + s / 10 + ' in su', v.score)).join('')
      + opt('low', 'Sotto il 6', v.score) + opt('none', 'Senza voto', v.score));
  }
  return html + `<span class="count" id="listCount"></span></div>`;
}

function pagerHtml(tab, page, pages){
  if (pages <= 1) return '';
  return `<div class="pager">
    <button class="pill"${page <= 0 ? ' disabled' : ''} onclick="goToListPage('${tab}',${page - 1})">‹ Precedenti</button>
    <span class="pager-info">Pagina ${page + 1} di ${pages}</span>
    <button class="pill"${page >= pages - 1 ? ' disabled' : ''} onclick="goToListPage('${tab}',${page + 1})">Successive ›</button>
  </div>`;
}

function renderListBody(tab){
  const body = $('#listBody'), data = cache[tab];
  if (!body || !data || !data.items) return;   // risposta incompleta o cache cambiata sotto (es. cambio modalità)
  if (VIEW.groupSeasons !== false) ensureRelationsFor(tab, data.items);
  const items = viewItems(tab, data.items);
  $('#listCount').textContent = items.length === data.items.length ? `${items.length} serie` : `${items.length} di ${data.items.length}`;
  if (!items.length){
    body.innerHTML = emptyState('Nessuna serie corrisponde ai filtri.', `<button class="pill" onclick="resetListView('${tab}')">Togli i filtri</button>`);
    return;
  }
  const v = listView(tab);
  const size = listPageSize();   // oltre questa soglia una lista si legge male: si spezza in pagine
  // si raggruppa PRIMA di impaginare, così una cartella non viene spezzata tra due pagine
  const units = VIEW.groupSeasons === false ? items : franchiseGroups(items).map(g => g.length === 1 ? g[0] : g);
  const pages = Math.max(1, Math.ceil(units.length / size));
  const page = Math.min(v.page || 0, pages - 1);
  const pageItems = units.slice(page * size, (page + 1) * size);
  const grid = tab === 'library' ? renderLibrary(pageItems)
    : tab === 'planning' ? renderPlanning(pageItems)
    : tab === 'paused' ? renderSimpleList(pageItems, { resumable:true })
    : tab === 'dropped' ? renderSimpleList(pageItems, { resumable:true })
    : renderSimpleList(pageItems, { hideProgress:true });
  body.innerHTML = grid + pagerHtml(tab, page, pages);
}

