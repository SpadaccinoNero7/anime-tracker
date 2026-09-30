// ---------- Tab machinery ----------
const TAB_ENDPOINTS = {
  library: '/library',
  planning: '/planning',
  upcoming: '/upcoming',
  stats: '/stats',
  paused: '/paused',
  dropped: '/dropped',
  completed: '/completed',
  telegram: '/telegram',
  news: '/news'
};

// contatori sui pulsanti delle liste: quante serie contiene (dalla cache) e, su "In corso", quante hanno episodi nuovi
const COUNT_TABS = ['library', 'planning', 'paused', 'dropped', 'completed'];
const fmtCount = n => n > 999 ? '999+' : String(n);
function updateTabCounts(){
  for (const tab of COUNT_TABS){
    const b = $(`#tabs button[data-tab="${tab}"]`);
    const data = cache[tab];
    if (!b || !data || !Array.isArray(data.items)) continue;
    let html = escapeHtml(tabLabel(tab)) + ` <span class="tab-count total" title="${data.items.length} in lista">${fmtCount(data.items.length)}</span>`;
    if (tab === 'library'){
      const n = data.items.reduce((s, it) => s + (it.cap != null && it.cap > it.progress ? 1 : 0), 0);
      const titolo = isManga() ? 'Opere con capitoli nuovi' : 'Serie con nuovi episodi';
      if (n) html += `<span class="tab-count" title="${titolo}: ${n}">${fmtCount(n)}</span>`;
    }
    b.innerHTML = html;
  }
}

// dopo il login carica in sottofondo le liste non ancora aperte, solo per mostrare i contatori
// (una alla volta, per non caricare n8n/AniList; i dati restano in cache e servono anche ad aprire la scheda)
let countsPrefetch = null;
function prefetchTabCounts(){
  if (countsPrefetch) return countsPrefetch;
  const target = cache, mode = MODE;
  countsPrefetch = (async () => {
    for (const tab of COUNT_TABS.filter(t => visibleTabs().includes(t))){
      if (target[tab] || MODE !== mode) continue;
      try { const data = await api(TAB_ENDPOINTS[tab]); if (!target[tab]) target[tab] = data; } catch (e) { continue; }
      if (cache === target) updateTabCounts();
    }
  })().finally(() => { countsPrefetch = null; });
  return countsPrefetch;
}

function renderTab(){
  updateTabCounts();
  const el = $('#content');
  if (ACTIVE_TAB === 'search'){ el.innerHTML = renderSearchShell(); return; }
  if (ACTIVE_TAB === 'seasonal'){ el.innerHTML = renderSeasonal(); return; }
  const data = cache[ACTIVE_TAB];
  if (!data){ el.innerHTML = '<div class="loading">Carico…</div>'; return; }
  // liste non vuote: barra ordina/filtra sopra (le liste vuote mostrano il loro messaggio qui sotto)
  if (LIST_SORTS[ACTIVE_TAB] && data.items && data.items.length){
    el.innerHTML = listToolbar(ACTIVE_TAB, data.items) + '<div id="listBody"></div>';
    renderListBody(ACTIVE_TAB);
    return;
  }
  if (ACTIVE_TAB === 'library') el.innerHTML = renderLibrary(data.items);
  else if (ACTIVE_TAB === 'recs') el.innerHTML = renderRecs(data);
  else if (ACTIVE_TAB === 'planning') el.innerHTML = renderPlanning(data.items);
  else if (ACTIVE_TAB === 'upcoming') el.innerHTML = renderUpcoming(data);
  else if (ACTIVE_TAB === 'stats') el.innerHTML = renderStats(data);
  else if (ACTIVE_TAB === 'paused') el.innerHTML = renderSimpleList(data.items, { resumable:true });
  else if (ACTIVE_TAB === 'dropped') el.innerHTML = renderSimpleList(data.items, { resumable:true, emptyMsg:W().emptyDropped });
  else if (ACTIVE_TAB === 'completed') el.innerHTML = renderSimpleList(data.items, { hideProgress:true, emptyMsg:W().emptyCompleted });
  else if (ACTIVE_TAB === 'telegram') el.innerHTML = renderTelegram(data);
  else if (ACTIVE_TAB === 'friends') el.innerHTML = renderFriends(data);
  else if (ACTIVE_TAB === 'news') el.innerHTML = renderNews(data);
}

// l'header resta fisso: quando si cambia davvero scheda (non un refresh silenzioso della stessa) si riparte dall'alto
function scrollContentTop(){
  const body = $('#appBody');
  if (body) body.scrollTop = 0; else window.scrollTo(0, 0);
}

async function loadTab(tab, force=false, silent=false){
  if (ACTIVE_TAB !== tab) scrollContentTop();
  ACTIVE_TAB = tab;
  $$('#tabs button[data-tab]').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  const moreBtn = $('#tabsMoreToggle');
  if (moreBtn) moreBtn.classList.toggle('active', !!$(`#tabsMore button[data-tab="${tab}"]`));
  closeTabsSheet();
  if (tab === 'search'){ renderTab(); return; }
  // cambiando scheda a mano si esce dalla ricerca
  if ($('#searchInput').value){ $('#searchInput').value = ''; SEARCH_Q = ''; $('#headerSearch').classList.remove('has-text'); }
  // Classifiche: stato proprio (filtri stagione/anno/ordinamento), non passa dalla cache generica
  if (tab === 'seasonal'){ if (!SEASONAL_VIEW.items.length && !SEASONAL_VIEW.loading) runSeasonal(); else renderTab(); return; }
  if (!CONFIG.baseUrl){ cache[tab] = null; renderTab(); return; }
  // il link di collegamento cambia a ogni richiesta: la scheda Telegram non usa la cache
  if (cache[tab] && !force && tab !== 'telegram'){ renderTab(); return; }
  if (!silent) $('#content').innerHTML = skeletonGrid();
  try{
    if (hasPending()) await flushAll();            // prima salva, poi rileggi (altrimenti dati vecchi)
    const data = tab === 'recs' ? await loadRecs() : tab === 'telegram' ? await loadTelegram()
      : tab === 'upcoming' ? await loadUpcoming() : tab === 'friends' ? await loadFriends() : await api(TAB_ENDPOINTS[tab]);
    cache[tab] = data;
    if (ACTIVE_TAB === tab) renderTab();
  }catch(err){
    if (ACTIVE_TAB === tab && !silent) $('#content').innerHTML = emptyState('Errore nel caricamento: ' + err.message);
  }
}

$$('#tabs button[data-tab]').forEach(b => b.addEventListener('click', () => loadTab(b.dataset.tab)));

applyModeUI();      // etichette e schede della modalità salvata (chiama applyTabPrefs)
init();

// PWA: installabile da "Aggiungi a schermata Home" su Android/iOS (vedi manifest.json)
if ('serviceWorker' in navigator){
  window.addEventListener('load', () => { navigator.serviceWorker.register('service-worker.js').catch(() => {}); });
}
