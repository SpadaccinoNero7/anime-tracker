// ---------- Modalità: anime oppure manga ----------
// La dashboard mostra un mondo per volta. Cambiare modalità: cambia le parole ("episodi" → "capitoli"),
// nasconde le schede che hanno senso solo per gli anime (calendario, news, notifiche Telegram, classifiche)
// e aggiunge `?type=MANGA` alle chiamate all'API, che risponde con la lista corrispondente su AniList.
const MODE_KEY = 'animeDashboardMode';
let MODE = 'anime';
try { if (localStorage.getItem(MODE_KEY) === 'manga') MODE = 'manga'; } catch (e) {}
cache = CACHES[MODE];
const isManga = () => MODE === 'manga';
const mediaType = () => isManga() ? 'MANGA' : 'ANIME';

// le parole che cambiano tra le due modalità (W() dà quelle della modalità attiva)
const WORDS = {
  anime: { unit:'episodio', units:'episodi', unitAbbr:'ep', seen:'visti', seenUnits:'Episodi visti', toSee:'da vedere',
           upTo:'fino all\'episodio', start:'Inizia a guardarlo', doneShort:'Già visto', done:'Già visto (completato)',
           longest:'Serie più lunghe completate',
           emptyLibrary:'Non stai seguendo ancora nessuna serie. Cercala nella scheda "Cerca".',
           emptyPlanning:'La lista "Da vedere" è vuota. Aggiungi qualcosa dalla ricerca o da "Per te".',
           emptyCompleted:'Nessuna serie completata ancora.', emptyDropped:'Nessuna serie droppata.' },
  manga: { unit:'capitolo', units:'capitoli', unitAbbr:'cap', seen:'letti', seenUnits:'Capitoli letti', toSee:'da leggere',
           upTo:'fino al capitolo', start:'Inizia a leggerlo', doneShort:'Già letto', done:'Già letto (completato)',
           longest:'Opere più lunghe completate',
           emptyLibrary:'Non stai leggendo ancora niente. Cercalo nella scheda "Cerca".',
           emptyPlanning:'La lista "Da leggere" è vuota. Aggiungi qualcosa dalla ricerca o da "Per te".',
           emptyCompleted:'Nessun manga completato ancora.', emptyDropped:'Nessun manga droppato.' }
};
const W = () => WORDS[MODE];
// "3 episodi" / "1 capitolo"
const units = n => `${n} ${n === 1 ? W().unit : W().units}`;
const volumeUnits = n => `${n} ${n === 1 ? 'volume' : 'volumi'}`;
// Nei manga il contatore principale sono i volumi: è più facile ricordare "sono al volume 12" che il
// numero del capitolo. Vale però solo dove i volumi hanno senso — se l'opera non li dichiara (succede
// spesso con quelle ancora in pubblicazione) e non ne hai segnato nessuno, restano primi i capitoli.
const perVolumi = it => isManga() && (it.volumes != null || (it.progressVolumes || 0) > 0);

// Capitoli corrispondenti a un volume. AniList non dice quanti capitoli contiene ciascun volume, quindi
// l'unica cosa possibile è spartirli in parti uguali: è una stima, non un dato (i volumi veri non hanno
// tutti lo stesso numero di capitoli). I capitoli seguono i volumi in entrambi i sensi — tolto un volume
// scendono — così i due contatori non si separano mai; il prezzo è che toccando i volumi la stima
// sostituisce un eventuale numero di capitoli messo a mano. Serve che l'opera dichiari entrambi i totali.
function capitoliDaVolumi(totCapitoli, totVolumi, volumiLetti, capitoliAttuali){
  if (VIEW.volumeChapters === false || !totCapitoli || !totVolumi) return null;
  const stima = Math.min(totCapitoli, Math.round(volumiLetti * totCapitoli / totVolumi));
  return stima !== (capitoliAttuali || 0) ? stima : null;
}

function setMode(m){
  if (m !== 'anime' && m !== 'manga') return;
  if (MODE === m) return;
  flushAll();                                   // le modifiche in sospeso vanno salvate prima di cambiare mondo
  closeDetails();
  MODE = m;
  try { localStorage.setItem(MODE_KEY, m); } catch (e) {}
  cache = CACHES[MODE];
  FRIENDS = null; FRIENDS_LOADING = null; RECS_GENRE = '';
  SEARCH_FILTER = null; SEARCH_Q = ''; SEARCH_HTML = '';
  Object.keys(ENTRY_OVERRIDE).forEach(k => delete ENTRY_OVERRIDE[k]);
  const input = $('#searchInput');
  if (input) input.value = '';
  $('#headerSearch').classList.remove('has-text');
  applyModeUI();
  const vis = visibleTabs();
  loadTab(vis.includes(ACTIVE_TAB) ? ACTIVE_TAB : vis[0]);
  setTimeout(prefetchTabCounts, 1500);
}

// etichette, schede visibili e testi che dipendono dalla modalità
function applyModeUI(){
  document.documentElement.dataset.mode = MODE;
  $$('#modeSwitch button').forEach(b => b.classList.toggle('active', b.dataset.mode === MODE));
  const input = $('#searchInput');
  if (input) input.placeholder = isManga() ? 'Cerca un manga… (# per tag e generi)' : 'Cerca un anime… (# per tag e generi)';
  const h1 = $('.brand h1');
  if (h1) h1.textContent = isManga() ? 'Libreria Manga' : 'Libreria Anime';
  const manga = $('#setMangaGroup');
  if (manga) manga.style.display = isManga() ? '' : 'none';   // impostazioni che valgono solo per i manga
  const news = $('#setNewsGroup');
  if (news) news.style.display = isManga() ? 'none' : '';     // la scheda News c'è solo per gli anime
  applyTabPrefs();
}

// Titolo di una serie nella lingua scelta: accetta sia gli item della dashboard
// ({ title:'...', titles:{english,romaji,native} }) sia un media AniList ({ title:{...} }).
// Se i titoli alternativi non ci sono (server non ancora aggiornato) resta quello che arriva.
function animeTitle(x){
  if (!x) return '';
  const t = x.titles || (x.title && typeof x.title === 'object' ? x.title : null);
  const fallback = typeof x.title === 'string' ? x.title : '';
  if (!t) return fallback;
  const pick = VIEW.titleLang === 'romaji' ? [t.romaji, t.english, t.native]
             : VIEW.titleLang === 'native' ? [t.native, t.romaji, t.english]
             : [t.english, t.romaji, t.native];
  return pick.find(Boolean) || fallback;
}

// Schede: l'ordine è quello dei pulsanti nell'HTML, la rotellina decide quali si vedono e da quale si parte.
const TAB_LABELS = { library:'In corso', planning:'Da vedere', upcoming:'In uscita', seasonal:'Classifiche',
  recs:'Per te', news:'News', friends:'Amici', stats:'Statistiche', paused:'In pausa', dropped:'Droppati',
  completed:'Completati', telegram:'Collegamenti' };
// in modalità manga alcune schede non hanno senso (calendario, news, notifiche, classifiche stagionali)
const MANGA_TABS = ['library', 'planning', 'recs', 'friends', 'stats', 'paused', 'dropped', 'completed'];
const TAB_LABELS_MANGA = { library:'In lettura', planning:'Da leggere', completed:'Letti', dropped:'Abbandonati' };
const tabLabel = t => (isManga() && TAB_LABELS_MANGA[t]) || TAB_LABELS[t] || t;
const DEFAULT_TAB_ORDER = $$('#tabs button[data-tab]').map(b => b.dataset.tab);   // ordine scritto nell'HTML
// ordine scelto dall'utente; le schede non presenti nell'elenco salvato (nuove) vanno in coda
const allTabs = () => {
  const saved = (VIEW.tabOrder || []).filter(t => DEFAULT_TAB_ORDER.includes(t));
  return saved.concat(DEFAULT_TAB_ORDER.filter(t => !saved.includes(t)));
};
const modeTabs = () => allTabs().filter(t => !isManga() || MANGA_TABS.includes(t));
function visibleTabs(){
  const vis = modeTabs().filter(t => !VIEW.hiddenTabs.includes(t));
  return vis.length ? vis : modeTabs();         // nasconderle tutte lascerebbe la pagina vuota
}
function startTab(){ const vis = visibleTabs(); return vis.includes(VIEW.startTab) ? VIEW.startTab : vis[0]; }
function applyTabPrefs(){
  const vis = visibleTabs();
  // le prime 4 visibili stanno nella barra fissa (mobile), le altre sotto "Altro"; su desktop l'ordine è lo stesso
  const primary = $('#tabs .tabs-primary'), more = $('#tabsMore');
  allTabs().slice().sort((a, b) => (vis.includes(b) ? 1 : 0) - (vis.includes(a) ? 1 : 0)).forEach((t, i) => {
    const b = $(`#tabs button[data-tab="${t}"]`);
    if (!b) return;
    (vis.indexOf(t) >= 0 && vis.indexOf(t) < 4 ? primary : more).appendChild(b);   // allTabs() è già nell'ordine scelto
  });
  // la barra laterale desktop ordina con regole CSS `order` fisse: con un ordine scelto le scavalca inline
  const custom = VIEW.tabOrder.length > 0, pos = allTabs();
  $$('#tabs button[data-tab]').forEach(b => {
    b.style.order = custom ? pos.indexOf(b.dataset.tab) + 1 : '';
    b.style.display = vis.includes(b.dataset.tab) ? '' : 'none';
    b.textContent = tabLabel(b.dataset.tab);
  });
  updateTabCounts();                            // rimette i contatori sui pulsanti (il testo è appena stato riscritto)
  // all’avvio ci pensa init() a caricare la scheda giusta: qui si cambia solo se si sta già guardando una scheda ora nascosta
  if (!FIRST_LOAD && SESSION_TOKEN && ACTIVE_TAB !== 'search' && !vis.includes(ACTIVE_TAB)) loadTab(vis[0]);
}
function listPageSize(){ return VIEW.pageSize > 0 ? VIEW.pageSize : Infinity; }

// dopo un cambio di preferenza ridisegna quello che si sta guardando, scheda dettagli compresa
function rerenderForPrefs(){
  if (ACTIVE_TAB === 'search'){
    const input = $('#searchInput');
    if (input && input.value) input.dispatchEvent(new Event('input'));
  } else renderTab();
  if (DETAIL){ $('#detailBox').innerHTML = renderDetails(DETAIL.m); renderTrama(DETAIL.id); renderMyList(); renderDetailFriends(DETAIL.id); }
}

function showToast(msg, kind=''){
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'toast show ' + kind;
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => { t.className = 'toast ' + kind; }, 3200);
}

// La rotellina è di tutti (aspetto e schede); la sezione "Avanzate" con URL e chiave delle API
// la vedono solo gli amministratori (username AniList, senza distinzione maiuscole).
// È solo un blocco dell'interfaccia: le funzioni "admin" che agiranno sul server vanno controllate anche in n8n.
const ADMIN_USERS = ['SpadaccinoNero7'];
let IS_ADMIN = false;
function setAdmin(name){
  IS_ADMIN = ADMIN_USERS.some(u => u.toLowerCase() === String(name || '').toLowerCase());
  syncAdvanced();
}
// force: la configurazione di base manca, va mostrata anche a chi non ha ancora fatto login
function syncAdvanced(force){
  const el = $('#setAdvanced');
  if (el) el.style.display = (IS_ADMIN || force === true) ? '' : 'none';
}

function fillStartTab(){
  const vis = visibleTabs(), cur = startTab();
  $('#setStartTab').innerHTML = vis.map(t =>
    `<option value="${t}" ${t === cur ? 'selected' : ''}>${escapeHtml(tabLabel(t))}</option>`).join('');
}
function fillTabList(){
  const list = modeTabs();
  $('#setTabList').innerHTML = list.map((t, i) =>
    `<div class="tab-toggle-row">
      <label class="tab-toggle"><input type="checkbox" data-tab="${t}" ${VIEW.hiddenTabs.includes(t) ? '' : 'checked'}><span>${escapeHtml(tabLabel(t))}</span></label>
      <button type="button" class="tab-move" data-move="-1" data-tab="${t}" aria-label="Sposta ${escapeHtml(tabLabel(t))} prima" ${i === 0 ? 'disabled' : ''}>▲</button>
      <button type="button" class="tab-move" data-move="1" data-tab="${t}" aria-label="Sposta ${escapeHtml(tabLabel(t))} dopo" ${i === list.length - 1 ? 'disabled' : ''}>▼</button>
    </div>`).join('');
}
function fillSettings(){
  $('#setTheme').value = THEME_PREF;
  $('#setTitleLang').value = VIEW.titleLang;
  $('#setGroup').checked = VIEW.groupSeasons !== false;
  $('#setVolumeChapters').checked = VIEW.volumeChapters !== false;
  $('#setShowYen').checked = VIEW.showYen !== false;
  $('#setPageSize').value = String(VIEW.pageSize);
  fillStartTab();
  fillTabList();
  $('#cfgBaseUrl').value = CONFIG.baseUrl;
  $('#cfgHeaderName').value = CONFIG.headerName || 'X-Api-Key';
  $('#cfgApiKey').value = CONFIG.apiKey;
  $('#cfgClientId').value = CONFIG.clientId || '';
}
function openSettings(force){
  syncAdvanced(force);
  if (force === true) $('#setAdvanced').open = true;
  fillSettings();
  $('#modalBack').classList.add('show');
}
function closeSettings(){ $('#modalBack').classList.remove('show'); }

$('#settingsBtn').addEventListener('click', () => openSettings());
$('#modalBack').addEventListener('click', e => { if (e.target === $('#modalBack')) closeSettings(); });
$('#setClose').addEventListener('click', closeSettings);

// Ogni scelta vale subito (niente "Salva"): l'effetto si vede con la rotellina ancora aperta.
$('#setTheme').addEventListener('change', e => setTheme(e.target.value));
$('#setTitleLang').addEventListener('change', e => { VIEW.titleLang = e.target.value; saveView(); rerenderForPrefs(); });
$('#setGroup').addEventListener('change', e => { VIEW.groupSeasons = e.target.checked; saveView(); rerenderForPrefs(); });
$('#setVolumeChapters').addEventListener('change', e => { VIEW.volumeChapters = e.target.checked; saveView(); });
$('#setShowYen').addEventListener('change', e => { VIEW.showYen = e.target.checked; saveView(); if (ACTIVE_TAB === 'news') renderTab(); });
$('#setPageSize').addEventListener('change', e => { VIEW.pageSize = Number(e.target.value) || 0; saveView(); rerenderForPrefs(); });
$('#setStartTab').addEventListener('change', e => { VIEW.startTab = e.target.value; saveView(); });
$('#setTabList').addEventListener('click', e => {
  const btn = e.target.closest('button[data-move]');
  if (!btn) return;
  const order = allTabs(), tab = btn.dataset.tab;
  // si scambia con la vicina tra quelle della modalità corrente (in manga alcune schede non ci sono)
  const shown = modeTabs(), j = shown.indexOf(tab) + Number(btn.dataset.move);
  if (j < 0 || j >= shown.length) return;
  const a = order.indexOf(tab), b = order.indexOf(shown[j]);
  order[a] = shown[j]; order[b] = tab;
  VIEW.tabOrder = order;
  saveView();
  applyTabPrefs();
  fillTabList();
  fillStartTab();
  const again = $(`#setTabList button[data-tab="${tab}"][data-move="${btn.dataset.move}"]`);
  (again && !again.disabled ? again : $(`#setTabList button[data-tab="${tab}"]:not([disabled])`))?.focus();
});
$('#setTabList').addEventListener('change', e => {
  const cb = e.target.closest('input[data-tab]');
  if (!cb) return;
  const tab = cb.dataset.tab;
  const hidden = VIEW.hiddenTabs.filter(t => t !== tab);
  if (!cb.checked){
    if (!allTabs().some(t => t !== tab && !hidden.includes(t))){
      cb.checked = true;
      showToast('Almeno una scheda deve restare visibile.', 'error');
      return;
    }
    hidden.push(tab);
  }
  VIEW.hiddenTabs = hidden;
  saveView();
  applyTabPrefs();
  fillStartTab();                      // la scheda iniziale non può essere una nascosta
});
$('#setReset').addEventListener('click', () => {
  VIEW = Object.assign({}, VIEW_DEFAULTS, { hiddenTabs: [], tabOrder: [] });
  saveView();
  setTheme('auto');
  applyTabPrefs();
  fillSettings();
  rerenderForPrefs();
  showToast('Impostazioni ripristinate.', 'ok');
});

$('#cfgSave').addEventListener('click', () => {
  CONFIG = {
    baseUrl: $('#cfgBaseUrl').value.trim().replace(/\/+$/,''),
    headerName: $('#cfgHeaderName').value.trim() || 'X-Api-Key',
    apiKey: $('#cfgApiKey').value.trim(),
    clientId: $('#cfgClientId').value.trim()
  };
  localStorage.setItem(STORE_KEY, JSON.stringify(CONFIG));
  closeSettings();
  FIRST_LOAD = true;
  Object.keys(cache).forEach(k => delete cache[k]);
  init();
});

$('#cfgTest').addEventListener('click', async () => {
  const tmp = {
    baseUrl: $('#cfgBaseUrl').value.trim().replace(/\/+$/,''),
    headerName: $('#cfgHeaderName').value.trim() || 'X-Api-Key',
    apiKey: $('#cfgApiKey').value.trim()
  };
  try {
    const res = await fetch(tmp.baseUrl + '/library', { headers: { [tmp.headerName]: tmp.apiKey } });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    await res.json();
    showToast('Connessione riuscita.', 'ok');
  } catch (err) {
    showToast('Connessione fallita: ' + err.message, 'error');
  }
});

async function api(path, opts={}){
  if (!CONFIG.baseUrl) { const e = new Error('Configura prima l\'indirizzo delle API.'); e.needsConfig = true; throw e; }
  const headers = Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {});
  headers[CONFIG.headerName || 'X-Api-Key'] = CONFIG.apiKey;
  // la modalità viaggia come parametro: l'API legge la lista anime o quella manga dello stesso account
  if (isManga()) path += (path.includes('?') ? '&' : '?') + 'type=MANGA';
  if (SESSION_TOKEN) headers['Authorization'] = 'Bearer ' + SESSION_TOKEN;
  const res = await fetch(CONFIG.baseUrl + path, Object.assign({}, opts, { headers }));
  if (res.status === 401) { handleUnauthenticated(); throw new Error('Sessione scaduta, effettua di nuovo il login.'); }
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return res.json();
}

function handleUnauthenticated(){
  SESSION_TOKEN = '';
  localStorage.removeItem(SESSION_KEY);
  // dentro Telegram si rientra da soli (una volta sola, per non girare in tondo)
  if (TG && !TG_RELOGIN_DONE){ TG_RELOGIN_DONE = true; init(); return; }
  showLoginGate('La sessione è scaduta o non è più valida. Accedi di nuovo.');
}

// Login dalla Mini App: n8n controlla la firma dell'initData e trova l'utente dalla chat col bot
let TG_RELOGIN_DONE = false;
const TG_LOGIN_ERRORS = {
  not_linked: 'Questo account Telegram non è collegato al bot: apri la dashboard dal browser, entra con AniList e collega Telegram dalla scheda Collegamenti.',
  relogin: 'Serve un nuovo accesso con AniList: apri la dashboard dal browser ed entra una volta con AniList.',
  not_allowed: 'Il tuo account AniList non è autorizzato a usare questa dashboard.',
  expired: 'Accesso scaduto: chiudi e riapri la dashboard dal bot.',
  bad_signature: 'Accesso da Telegram non valido: chiudi e riapri la dashboard dal bot.'
};
async function telegramLogin(){
  let j = {};
  try {
    const res = await fetch(CONFIG.baseUrl + '/telegram/webapp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', [CONFIG.headerName || 'X-Api-Key']: CONFIG.apiKey },
      body: JSON.stringify({ initData: TG.initData })
    });
    j = await res.json().catch(() => ({}));
  } catch (e) { j = {}; }
  if (j.session){
    SESSION_TOKEN = j.session;
    localStorage.setItem(SESSION_KEY, j.session);
    return true;
  }
  showLoginGate(TG_LOGIN_ERRORS[j.error] || 'Accesso da Telegram non riuscito, riprova tra poco.');
  return false;
}

function showLoginGate(msg){
  $('#loginGate').style.display = 'flex';
  $('#tabs').style.display = 'none';
  $('#content').style.display = 'none';
  $('#userBadge').style.display = 'none';
  setAdmin(null);
  $('#headerSearch').style.display = 'none';
  $('#modeSwitch').style.display = 'none';
  if (msg) $('#loginGateMsg').textContent = msg;
}

function showApp(){
  $('#loginGate').style.display = 'none';
  $('#tabs').style.display = '';
  $('#content').style.display = '';
  $('#headerSearch').style.display = '';
  $('#modeSwitch').style.display = '';
}

function renderUserBadge(name, avatar){
  $('#userBadge').style.display = 'flex';
  $('#userName').textContent = name || '';
  $('#userAvatar').src = avatar || '';
  $('#userAvatar').style.display = avatar ? '' : 'none';
}

function loginWithAniList(){
  if (!CONFIG.baseUrl || !CONFIG.clientId) { openSettings(true); showToast('Configura prima URL base e Client ID nelle impostazioni.', 'error'); return; }
  const redirectUri = CONFIG.baseUrl + '/auth/callback';
  const nonce = generateOauthNonce();
  try { sessionStorage.setItem('oauthNonce', nonce); } catch (e) {}
  const state = encodeURIComponent(JSON.stringify({ r: location.href.split('#')[0], n: nonce }));
  const url = 'https://anilist.co/api/v2/oauth/authorize'
    + '?client_id=' + encodeURIComponent(CONFIG.clientId)
    + '&redirect_uri=' + encodeURIComponent(redirectUri)
    + '&response_type=code'
    + '&state=' + state;
  location.href = url;
}

// Login con Discord: vale per chi ha già collegato Discord dalla scheda Collegamenti.
// Il redirect verso Discord lo costruisce n8n (/discord/start), il ritorno è lo stesso #session=…&nonce=… di AniList.
function loginWithDiscord(){
  if (!CONFIG.baseUrl) { openSettings(true); showToast('Configura prima l\'URL base nelle impostazioni.', 'error'); return; }
  const nonce = generateOauthNonce();
  try { sessionStorage.setItem('oauthNonce', nonce); } catch (e) {}
  location.href = CONFIG.baseUrl + '/discord/start?n=' + encodeURIComponent(nonce)
    + '&r=' + encodeURIComponent(location.href.split('#')[0]);
}

function generateOauthNonce(){
  try {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
  } catch (e) {
    return String(Date.now()) + Math.random().toString(36).slice(2);
  }
}

async function logout(){
  try { await api('/logout', { method: 'POST' }); } catch (err) { /* ignora errori di rete in logout */ }
  SESSION_TOKEN = '';
  localStorage.removeItem(SESSION_KEY);
  Object.keys(cache).forEach(k => delete cache[k]);
  FRIENDS = null;
  showLoginGate('Hai effettuato il logout.');
}

$('#loginBtn').addEventListener('click', loginWithAniList);
$('#discordLoginBtn').addEventListener('click', loginWithDiscord);
// true solo dopo aver messo live gli endpoint /discord/* (WORKFLOWS/AMICI/add_discord_link.py)
const DISCORD_LOGIN = true;
$('#discordLoginBtn').style.display = DISCORD_LOGIN ? '' : 'none';
$('#logoutBtn').addEventListener('click', logout);

async function init(){
  if (!CONFIG.baseUrl) { openSettings(true); showLoginGate('Configura prima l\'indirizzo delle API dalle impostazioni.'); return; }
  if (!SESSION_TOKEN && TG && !(await telegramLogin())) return;
  if (!SESSION_TOKEN) { showLoginGate(LOGIN_SECURITY_ERROR ? 'Controllo di sicurezza del login fallito, riprova ad accedere.' : undefined); return; }
  try {
    const info = await api('/session');
    if (info.loggedIn) {
      showApp();
      renderUserBadge(info.name, info.avatar);
      setAdmin(info.name);
      crResumeImport();   // import Crunchyroll lasciato a metà (pagina ricaricata)
      await pullView();   // preferenze dal server prima di scegliere la scheda iniziale (max 2,5 s)
      if (DISCORD_JUST_LINKED){
        showToast('Discord collegato: ti abbiamo aggiunto al server.', 'ok');
        loadTab(isManga() ? startTab() : 'telegram');
        DISCORD_JUST_LINKED = false;
      } else {
        loadTab(FIRST_LOAD ? startTab() : (ACTIVE_TAB || startTab()));
      }
      FIRST_LOAD = false;
      openPendingAnime();
      acceptPendingInvite();
      setTimeout(prefetchTabCounts, 1500);   // dopo la scheda iniziale: i numeri sulle altre liste
      refreshScoreFormat();   // in background: se cambia non blocca l'avvio, si aggiorna al prossimo voto
    } else {
      handleUnauthenticated();
    }
  } catch (err) {
    if (!err.message.includes('scaduta')) showLoginGate('Errore di verifica sessione: ' + err.message);
  }
}

function coverImg(cover, title){
  if (cover) return `<img class="cover" src="${escapeAttr(cover)}" alt="" loading="lazy" decoding="async">`;
  return `<div class="cover empty">${escapeHtml((title||'').slice(0,2).toUpperCase())}</div>`;
}
function escapeHtml(s){ return (s||'').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function escapeAttr(s){ return escapeHtml(s); }
// voto personale: AniList lo dà in centesimi (POINT_100), qui si mostra su 10
function fmtScore(s){ return (Math.round(s / 5) / 2).toLocaleString('it-IT'); }

// Stile di voto scelto su AniList (mediaListOptions.scoreFormat): adatta SOLO il controllo con cui
// l'utente assegna il proprio voto (renderMyList/scoreWidgetHtml), così l'esperienza è la stessa a cui
// è abituato su AniList. Il resto della dashboard (statistiche, confronto con gli amici, filtri) resta
// sempre su 10 con fmtScore: mescolare formati diversi tra utenti/contesti renderebbe i confronti confusi.
const SCORE_FORMATS = {
  POINT_100:        { max: 100, step: 1,   toDisplay: r => r,                        toRaw: v => Math.round(v) },
  POINT_10_DECIMAL: { max: 10,  step: 0.1, toDisplay: r => Math.round(r) / 10,       toRaw: v => Math.round(v * 10) },
  POINT_10:         { max: 10,  step: 1,   toDisplay: r => Math.round(r / 10),       toRaw: v => Math.round(v) * 10 },
  POINT_5:          { max: 5,   step: 0.5, toDisplay: r => Math.round(r / 10) / 2,   toRaw: v => Math.round(v * 2) * 10 },
  POINT_3:          { max: 3,   step: 1,   toDisplay: r => (r <= 0 ? 0 : r <= 45 ? 1 : r <= 70 ? 2 : 3), toRaw: v => [0, 35, 60, 100][v] || 0 },
};
function scoreFmt(){ return SCORE_FORMATS[SCORE_FORMAT] || SCORE_FORMATS.POINT_10_DECIMAL; }

// Chiesto al server (non bloccante: se fallisce resta il formato di prima/quello di default)
async function refreshScoreFormat(){
  try {
    const r = await api('/score-format');
    if (r && r.scoreFormat && SCORE_FORMATS[r.scoreFormat] && r.scoreFormat !== SCORE_FORMAT){
      SCORE_FORMAT = r.scoreFormat;
      localStorage.setItem(SCORE_FORMAT_KEY, SCORE_FORMAT);
      if (DETAIL) renderMyList();   // scheda già aperta: aggiorna subito il controllo del voto
    }
  } catch (e) { /* non critico */ }
}

function emptyState(msg, cta){
  return `<div class="empty-state">${escapeHtml(msg)}${cta ? `<div>${cta}</div>` : ''}</div>`;
}

// placeholder animato mostrato mentre una scheda carica, al posto di un testo "Carico…" a schermo vuoto
function skeletonGrid(n = 8){
  const card = `
    <div class="skel-card">
      <div class="cover-row">
        <div class="skel-block skel-cover"></div>
        <div class="skel-meta">
          <div class="skel-block skel-line w60"></div>
          <div class="skel-block skel-line w40"></div>
        </div>
      </div>
      <div class="skel-block skel-bar"></div>
    </div>`;
  return `<div class="grid" aria-hidden="true">${card.repeat(n)}</div><span class="sr-only" role="status">Caricamento…</span>`;
}

