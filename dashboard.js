const STORE_KEY = 'animeDashboardConfig';
const SESSION_KEY = 'animeDashboardSession';
// Valori predefiniti: chi apre la pagina deve solo fare "Accedi con AniList".
// Le impostazioni (ingranaggio) restano utili solo per sovrascriverli.
const DEFAULT_CONFIG = {
  baseUrl: 'https://homelab.tailec9b6a.ts.net/webhook/anime-dashboard',
  headerName: 'X-Api-Key',
  apiKey: '52WMytE00EkCy99rA9c9DI2m1QwRVXeQYpODIOxf',
  clientId: '51712'
};
const savedConfig = JSON.parse(localStorage.getItem(STORE_KEY) || 'null') || {};
let CONFIG = Object.assign({}, DEFAULT_CONFIG);
Object.keys(savedConfig).forEach(k => { if (savedConfig[k]) CONFIG[k] = savedConfig[k]; });
// Telegram Mini App (pulsante "Apri" del bot amici): initData firmato da Telegram -> login senza OAuth.
// Fuori da Telegram lo script c'è lo stesso, ma initData è vuoto e TG resta null.
const TG = (window.Telegram && window.Telegram.WebApp && window.Telegram.WebApp.initData) ? window.Telegram.WebApp : null;
if (TG){
  document.documentElement.classList.add('in-telegram');
  try { TG.ready(); TG.expand(); } catch (e) {}
}
// Dopo il login il callback n8n rimanda qui con #session=<token>&nonce=<nonce>
let LOGIN_SECURITY_ERROR = false;
const hashLoginParams = new URLSearchParams(location.hash.slice(1));
const hashSession = hashLoginParams.get('session');
if (hashSession) {
  const hashNonce = hashLoginParams.get('nonce') || '';
  let storedNonce = '';
  try { storedNonce = sessionStorage.getItem('oauthNonce') || ''; sessionStorage.removeItem('oauthNonce'); } catch (e) {}
  if (storedNonce && hashNonce === storedNonce) {
    localStorage.setItem(SESSION_KEY, hashSession);
  } else {
    // Login non avviato da questa scheda (nonce mancante o diverso): scarta la sessione per sicurezza (anti-CSRF)
    localStorage.removeItem(SESSION_KEY);
    fetch(CONFIG.baseUrl + '/logout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', [CONFIG.headerName || 'X-Api-Key']: CONFIG.apiKey, 'Authorization': 'Bearer ' + hashSession }
    }).catch(() => {});
    LOGIN_SECURITY_ERROR = true;
  }
  history.replaceState(null, '', location.pathname + location.search);
}
// Link "Dettagli" delle notifiche Telegram: #anime=<id> apre la scheda (anche dopo un eventuale login)
// Nella Mini App Telegram si usa ?anime=<id>: l'hash lo occupa Telegram (#tgWebAppData=…)
function takeAnimeHash(){
  const q = new URLSearchParams(location.search);
  const id = Number(new URLSearchParams(location.hash.slice(1)).get('anime')) || Number(q.get('anime'));
  if (!id) return;
  try { sessionStorage.setItem('openAnime', String(id)); } catch (e) { PENDING_ANIME = id; }
  q.delete('anime');
  history.replaceState(null, '', location.pathname + (q.toString() ? '?' + q : ''));
}
let PENDING_ANIME = null;
function openPendingAnime(){
  let id = PENDING_ANIME;
  try { id = Number(sessionStorage.getItem('openAnime')) || id; sessionStorage.removeItem('openAnime'); } catch (e) {}
  PENDING_ANIME = null;
  if (id) openDetails(id);
}
takeAnimeHash();
// link d'invito di un amico (?amico=CODICE): si ricorda e la richiesta parte dopo il login
(function(){
  const q = new URLSearchParams(location.search);
  const c = q.get('amico');
  if (!c) return;
  try { sessionStorage.setItem('friendInvite', c); } catch (e) {}
  q.delete('amico');
  history.replaceState(null, '', location.pathname + (q.toString() ? '?' + q : '') + location.hash);
})();
// Ritorno dal collegamento Discord (callback n8n → #discord=linked): all'avvio si apre la scheda Collegamenti
let DISCORD_JUST_LINKED = false;
if (new URLSearchParams(location.hash.slice(1)).get('discord') === 'linked') {
  DISCORD_JUST_LINKED = true;
  history.replaceState(null, '', location.pathname + location.search);
}
window.addEventListener('hashchange', () => { takeAnimeHash(); if (SESSION_TOKEN) openPendingAnime(); });
let SESSION_TOKEN = localStorage.getItem(SESSION_KEY) || '';
// stile di voto scelto su AniList (mediaListOptions.scoreFormat): letto una volta al login (/score-format)
// e tenuto in cache locale così l'interfaccia è già giusta anche prima che risponda il server.
const SCORE_FORMAT_KEY = 'animeScoreFormat';
let SCORE_FORMAT = localStorage.getItem(SCORE_FORMAT_KEY) || 'POINT_10_DECIMAL';
let ACTIVE_TAB = 'library';
let FIRST_LOAD = true;      // il primo caricamento parte dalla scheda scelta nelle impostazioni
const CACHES = { anime: {}, manga: {} };   // una cache per modalità: passando da una all'altra non si ricarica tutto
let cache = CACHES.anime;                  // riassegnata da setMode()

const $ = (sel, root=document) => root.querySelector(sel);
const $$ = (sel, root=document) => Array.from(root.querySelectorAll(sel));

// Tema: 'auto' segue il sistema (lo <script> nel <head> imposta già data-theme prima del primo paint),
// 'light'/'dark' lo forzano. Il pulsante nell'header resta la scorciatoia: usandolo si esce da 'auto'.
const THEME_KEY = 'animeDashboardTheme';
let THEME_PREF = 'auto';
try { const saved = localStorage.getItem(THEME_KEY); if (saved === 'light' || saved === 'dark') THEME_PREF = saved; } catch (e) {}
// dentro Telegram "automatico" segue il tema dell'app Telegram, non quello del sistema
const systemTheme = () => (TG && (TG.colorScheme === 'light' || TG.colorScheme === 'dark')) ? TG.colorScheme
  : (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
function activeTheme(){ return THEME_PREF === 'auto' ? systemTheme() : THEME_PREF; }
function applyTheme(){
  const theme = activeTheme();
  document.documentElement.dataset.theme = theme;
  const btn = $('#themeBtn');
  if (btn){
    btn.textContent = theme === 'light' ? '🌙' : '☀️';
    btn.title = (theme === 'light' ? 'Passa al tema scuro' : 'Passa al tema chiaro') + (THEME_PREF === 'auto' ? ' (ora automatico)' : '');
  }
  const metaTheme = document.querySelector('meta[name="theme-color"]');
  if (metaTheme) metaTheme.setAttribute('content', theme === 'light' ? '#f4f5f7' : '#0f1115');
}
function setTheme(pref){
  THEME_PREF = ['auto', 'light', 'dark'].includes(pref) ? pref : 'auto';
  try { localStorage.setItem(THEME_KEY, THEME_PREF); } catch (e) {}
  applyTheme();
}
applyTheme();
$('#themeBtn').addEventListener('click', () => setTheme(activeTheme() === 'light' ? 'dark' : 'light'));
try { matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => { if (THEME_PREF === 'auto') applyTheme(); }); } catch (e) {}
if (TG) try { TG.onEvent('themeChanged', () => { if (THEME_PREF === 'auto') applyTheme(); }); } catch (e) {}

// ---------- Preferenze di visualizzazione (rotellina) ----------
// Aspetto e schede: restano su questo browser (localStorage), non passano dal server.
const VIEW_KEY = 'animeDashboardView';
const VIEW_DEFAULTS = { titleLang:'english', groupSeasons:true, pageSize:30, startTab:'library', hiddenTabs:[], volumeChapters:true, showYen:true };
let VIEW = Object.assign({}, VIEW_DEFAULTS);
try { Object.assign(VIEW, JSON.parse(localStorage.getItem(VIEW_KEY)) || {}); } catch (e) {}
if (!Array.isArray(VIEW.hiddenTabs)) VIEW.hiddenTabs = [];
function saveView(){ try { localStorage.setItem(VIEW_KEY, JSON.stringify(VIEW)); } catch (e) {} }

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
const allTabs = () => $$('#tabs button[data-tab]').map(b => b.dataset.tab);
const modeTabs = () => allTabs().filter(t => !isManga() || MANGA_TABS.includes(t));
function visibleTabs(){
  const vis = modeTabs().filter(t => !VIEW.hiddenTabs.includes(t));
  return vis.length ? vis : modeTabs();         // nasconderle tutte lascerebbe la pagina vuota
}
function startTab(){ const vis = visibleTabs(); return vis.includes(VIEW.startTab) ? VIEW.startTab : vis[0]; }
function applyTabPrefs(){
  const vis = visibleTabs();
  $$('#tabs button[data-tab]').forEach(b => {
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
function fillSettings(){
  $('#setTheme').value = THEME_PREF;
  $('#setTitleLang').value = VIEW.titleLang;
  $('#setGroup').checked = VIEW.groupSeasons !== false;
  $('#setVolumeChapters').checked = VIEW.volumeChapters !== false;
  $('#setShowYen').checked = VIEW.showYen !== false;
  $('#setPageSize').value = String(VIEW.pageSize);
  fillStartTab();
  $('#setTabList').innerHTML = modeTabs().map(t =>
    `<label class="tab-toggle"><input type="checkbox" data-tab="${t}" ${VIEW.hiddenTabs.includes(t) ? '' : 'checked'}><span>${escapeHtml(tabLabel(t))}</span></label>`).join('');
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
  VIEW = Object.assign({}, VIEW_DEFAULTS, { hiddenTabs: [] });
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

// ---------- Tab: In uscita ----------
// Calendario: episodi delle serie "In corso" e "Da vedere" letti direttamente da AniList (airingSchedules),
// settimana da lunedì a domenica nell'ora locale. Se AniList non risponde usa i prossimi episodi di /upcoming.
const CAL_QUERY = `query($ids:[Int],$from:Int,$to:Int,$page:Int){ Page(page:$page, perPage:50){ pageInfo{ hasNextPage }
  airingSchedules(mediaId_in:$ids, airingAt_greater:$from, airingAt_lesser:$to, sort:TIME){
    episode airingAt media{ id title{ english romaji native } }
  } } }`;
let CAL_WEEK = 0;                 // 0 = questa settimana, -1 la scorsa, +1 la prossima…
const calCache = {};              // offset -> { events, fallback }

function weekStart(offset){
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - (d.getDay() + 6) % 7 + offset * 7);
  return d;
}

async function loadUpcoming(){
  const [data] = await Promise.all([api('/upcoming'), ensureLists(['library', 'planning'])]);
  Object.keys(calCache).forEach(k => delete calCache[k]);
  await loadCalendar(CAL_WEEK, data);
  return data;
}

async function loadCalendar(offset, data){
  if (calCache[offset]) return calCache[offset];
  const lib = (cache.library && cache.library.items) || [];
  const plan = ((cache.planning && cache.planning.items) || []).filter(x => x.nextAiringAt || x.mediaStatus === 'RELEASING');
  const ids = lib.map(x => x.id).concat(plan.map(x => x.id));
  const from = Math.floor(weekStart(offset) / 1000), to = Math.floor(weekStart(offset + 1) / 1000);
  let events = [], fallback = false;
  try{
    for (let page = 1; page <= 4 && ids.length; page++){
      const res = await fetch('https://graphql.anilist.co', {
        method:'POST', headers:{ 'Content-Type':'application/json', 'Accept':'application/json' },
        body: JSON.stringify({ query: CAL_QUERY, variables: { ids, from: from - 1, to, page } })
      });
      const j = await res.json();
      if (!j.data) throw new Error((j.errors && j.errors[0] && j.errors[0].message) || 'HTTP ' + res.status);
      events = events.concat(j.data.Page.airingSchedules.map(a => ({
        id: a.media.id, title: animeTitle(a.media), titles: a.media.title, episode: a.episode, airingAt: a.airingAt })));
      if (!j.data.Page.pageInfo.hasNextPage) break;
    }
  }catch(err){
    // solo i prossimi episodi delle serie in corso, già calcolati dal server
    fallback = true;
    const sched = (data || cache.upcoming || {}).scheduled || [];
    events = sched.filter(x => x.airingAt >= from && x.airingAt < to);
  }
  return (calCache[offset] = { events, fallback });
}

async function calGo(delta){
  CAL_WEEK = delta === 0 ? 0 : Math.max(-4, Math.min(8, CAL_WEEK + delta));
  if (!calCache[CAL_WEEK]){
    if ($('#calBox')) $('#calBox').classList.add('busy');
    await loadCalendar(CAL_WEEK);
  }
  if (ACTIVE_TAB === 'upcoming' && $('#calBox')){ $('#calBox').classList.remove('busy'); $('#calBox').innerHTML = renderCalendar(); }
}

function renderCalendar(){
  const cal = calCache[CAL_WEEK];
  if (!cal) return '<div class="loading">Carico il calendario…</div>';
  const start = weekStart(CAL_WEEK), now = Date.now() / 1000;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const progress = {}, planning = new Set();
  ((cache.library && cache.library.items) || []).forEach(x => progress[x.id] = x.progress);
  ((cache.planning && cache.planning.items) || []).forEach(x => planning.add(x.id));
  const days = [];
  for (let i = 0; i < 7; i++){ const d = new Date(start); d.setDate(d.getDate() + i); days.push(d); }
  const end = days[6];
  const fmt = (d, o) => d.toLocaleDateString('it-IT', o);
  const label = { 0:'Questa settimana', 1:'Prossima settimana', '-1':'Settimana scorsa' }[CAL_WEEK] || '';
  const range = `${fmt(start, start.getMonth() === end.getMonth() ? { day:'numeric' } : { day:'numeric', month:'short' })}–${fmt(end, { day:'numeric', month:'short' })}`;

  const cols = days.map(d => {
    const next = new Date(d); next.setDate(next.getDate() + 1);
    const evs = cal.events.filter(e => e.airingAt * 1000 >= d && e.airingAt * 1000 < next).sort((a, b) => a.airingAt - b.airingAt);
    const cls = ['cal-day', +d === +today ? 'today' : '', d < today ? 'past' : '', evs.length ? '' : 'empty'].join(' ');
    const items = evs.map(e => {
      const time = new Date(e.airingAt * 1000).toLocaleTimeString('it-IT', { hour:'2-digit', minute:'2-digit' });
      const isPlan = planning.has(e.id) && progress[e.id] == null;
      const aired = e.airingAt <= now;
      const state = isPlan ? ' · da vedere'
        : !aired ? ''
        : (progress[e.id] || 0) >= e.episode ? ' · <span class="ok">✓ visto</span>' : ' · <span class="todo">da recuperare</span>';
      const evTitle = animeTitle(e);
      return `<button class="cal-ev${isPlan ? ' plan' : ''}" onclick="openDetails(${e.id})" title="${escapeAttr(evTitle)}">
        <div class="t">${escapeHtml(evTitle)}</div>
        <div class="s">${time} · <b>Ep. ${e.episode}</b>${state}</div>
      </button>`;
    }).join('');
    return `<div class="${cls}"><div class="dh">${fmt(d, { weekday:'short', day:'numeric' })}</div>
      <div class="evs">${items || '<div class="none">—</div>'}</div></div>`;
  }).join('');

  return `
    <div class="cal-nav">
      <button class="step" onclick="calGo(-1)" ${CAL_WEEK <= -4 ? 'disabled' : ''} aria-label="Settimana precedente">‹</button>
      <div class="range">${label ? label + ' · ' : ''}${range}</div>
      ${CAL_WEEK !== 0 ? '<button class="pill" onclick="calGo(0)">Oggi</button>' : ''}
      <button class="step" onclick="calGo(1)" ${CAL_WEEK >= 8 ? 'disabled' : ''} aria-label="Settimana successiva">›</button>
    </div>
    <div class="cal">${cols}</div>
    <div class="cal-legend">${cal.fallback
      ? 'AniList non risponde: mostro solo il prossimo episodio delle serie in corso.'
      : 'Orari nel tuo fuso. Bordo tratteggiato = serie in "Da vedere".'}</div>`;
}

function renderUpcoming(data){
  const { available, scheduled } = data;
  let html = '';
  html += `<div class="panel-title">Calendario</div><div id="calBox">${renderCalendar()}</div>`;
  html += `<div class="panel-title">Disponibili ora</div>`;
  html += available.length
    ? available.map(it => `
      <div class="upcoming-item clickable" role="button" tabindex="0" onclick="openDetails(${it.id})">
        <span class="live-dot"></span>
        ${coverImg(it.cover, animeTitle(it))}
        <div class="meta"><h3 style="font-size:13.5px;margin:0;">${escapeHtml(animeTitle(it))}</h3></div>
        <span class="when">${it.behind} ep${it.behind>1?'i':'io'} da recuperare</span>
      </div>`).join('')
    : emptyState('Sei aggiornato su tutto.');
  // i prossimi 7 giorni sono già nel calendario: qui solo quello che viene dopo
  const later = scheduled.filter(it => it.airingAt * 1000 >= weekStart(1));
  html += `<div class="panel-title">Più avanti</div>`;
  html += later.length
    ? later.map(it => {
        const d = new Date(it.airingAt * 1000);
        const day = d.toLocaleDateString('it-IT', { weekday:'long', day:'numeric', month:'short' });
        const time = d.toLocaleTimeString('it-IT', { hour:'2-digit', minute:'2-digit' });
        return `<div class="upcoming-item clickable" role="button" tabindex="0" onclick="openDetails(${it.id})">
          ${coverImg(it.cover, animeTitle(it))}
          <div class="meta"><h3 style="font-size:13.5px;margin:0;">${escapeHtml(animeTitle(it))}</h3>
          <div class="sub">Episodio ${it.episode}</div></div>
          <span class="when">${day}<br>${time}</span>
        </div>`;
      }).join('')
    : emptyState('Nessun altro episodio con data confermata.');
  return html;
}

// ---------- Tab: Statistiche ----------
// Grafici in HTML/CSS (niente librerie). Colori: palette categoriale validata (8 tinte, ordine fisso),
// ricalibrata per fondo chiaro e scuro. I grafici "classifica" (un solo insieme di barre non comparabili
// per categoria: studi, formati, serie più lunghe) restano in tinta unica; i Generi, essendo 8 categorie
// reali che tornano anche altrove nell'app, prendono una tinta per genere nell'ordine fisso 1→8.
const STATUS_VIZ = [
  ['COMPLETED', 'var(--viz-1)'], ['CURRENT', 'var(--viz-2)'], ['PLANNING', 'var(--viz-3)'],
  ['PAUSED', 'var(--viz-4)'], ['DROPPED', 'var(--viz-5)'], ['REPEATING', 'var(--viz-6)']
];
const nf = n => Number(n).toLocaleString('it-IT');

function vizStatus(byStatus){
  const parts = STATUS_VIZ.map(([k, c]) => ({ k, c, n: byStatus[k] || 0, label: LIST_LABELS[k].label })).filter(p => p.n);
  const tot = parts.reduce((s, p) => s + p.n, 0);
  if (!tot) return '';
  const pct = n => Math.round(n / tot * 100);
  return `<div class="viz-card">
    <h4>La tua lista</h4>
    <div class="stack">${parts.map(p => `<i style="flex:${p.n};background:${p.c}" data-tip="${p.label}: ${nf(p.n)} (${pct(p.n)}%)"></i>`).join('')}</div>
    <div class="legend">${parts.map(p => `<span><b style="background:${p.c}"></b>${p.label} <em>${nf(p.n)}</em></span>`).join('')}</div>
  </div>`;
}

// colonne verticali: cols = [{label, value, tip}], tick(i) decide quali etichette mostrare sotto,
// opts.color forza la tinta (altrimenti resta il blu di default definito in CSS)
function vizColumns(cols, opts = {}){
  const max = Math.max(...cols.map(c => c.value), 1);
  const iMax = cols.findIndex(c => c.value === max);
  const marker = opts.marker != null
    ? `<div class="mark" style="left:${opts.marker.pos * 100}%"><span>${opts.marker.label}</span></div>` : '';
  const bg = opts.color ? `background:${opts.color};` : '';
  return `<div class="cols-wrap">
    <div class="cols">${marker}${cols.map((c, i) => `
      <div class="col" data-tip="${escapeAttr(c.tip)}">
        ${i === iMax && c.value ? `<span class="top" style="bottom:calc(${Math.max(2, c.value / max * 100)}% + 3px)">${nf(c.value)}</span>` : ''}
        <i style="height:${c.value ? Math.max(2, c.value / max * 100) : 0}%;${bg}"></i>
      </div>`).join('')}</div>
    <div class="cols-x">${cols.map((c, i) => `<span>${!opts.tick || opts.tick(i, c) ? escapeHtml(String(c.label)) : ''}</span>`).join('')}</div>
  </div>`;
}

function vizScores(s){
  const hist = s.scoreHist || [];
  if (!hist.some(Boolean)) return `<div class="viz-card"><h4>I tuoi voti</h4><p class="viz-empty">Non hai ancora votato nessuna serie: puoi farlo dalla scheda di ogni anime.</p></div>`;
  const mean = s.meanScore != null ? s.meanScore / 10 : null;
  return `<div class="viz-card">
    <h4>I tuoi voti <small>${nf(s.scoredCount || hist.reduce((a, b) => a + b, 0))} serie votate</small></h4>
    ${vizColumns(hist.map((n, i) => ({ label: i + 1, value: n, tip: `Voto ${i + 1}: ${nf(n)} ${n === 1 ? 'serie' : 'serie'}` })),
      { marker: mean != null ? { pos: mean / 10, label: `media ${mean.toLocaleString('it-IT', { maximumFractionDigits: 1 })}` } : null })}
  </div>`;
}

function vizYears(byYear){
  const ys = Object.keys(byYear || {}).map(Number).filter(Boolean);
  if (ys.length < 2) return '';
  const from = Math.min(...ys), to = Math.max(...ys);
  const cols = [];
  for (let y = from; y <= to; y++) cols.push({ label: y, value: byYear[y] || 0, tip: `${y}: ${nf(byYear[y] || 0)} serie` });
  const step = cols.length > 30 ? 10 : cols.length > 12 ? 5 : cols.length > 6 ? 2 : 1;
  return `<div class="viz-card">
    <h4>Anno di uscita <small>serie viste o iniziate</small></h4>
    ${vizColumns(cols, { color: 'var(--viz-2)', tick: (i, c) => i === 0 || i === cols.length - 1 ? true : c.label % step === 0 && i > 1 && i < cols.length - 2 })}
  </div>`;
}

// barre orizzontali: rows = [{name, value, extra, tip}]. rowColor(row, i) => colore CSS per quella barra;
// di default tinta unica var(--viz-1) (classifica, non categorie a sé stanti).
function vizBars(title, rows, sub, rowColor){
  if (!rows.length) return '';
  const max = Math.max(...rows.map(r => r.value), 1);
  const color = rowColor || (() => 'var(--viz-1)');
  return `<div class="viz-card">
    <h4>${title}${sub ? ` <small>${sub}</small>` : ''}</h4>
    <div class="hbars">${rows.map((r, i) => `
      <div class="hbar" data-tip="${escapeAttr(r.tip || `${r.name}: ${nf(r.value)}`)}">
        <span class="n">${escapeHtml(r.name)}</span>
        <span class="t"><i style="width:${r.value / max * 100}%;background:${color(r, i)}"></i></span>
        <span class="v">${nf(r.value)}${r.extra ? ` <em>${r.extra}</em>` : ''}</span>
      </div>`).join('')}</div>
  </div>`;
}

function renderStats(s){
  return wrappedCta() + renderStatsBody(s);
}
function renderStatsBody(s){
  const days = Number(s.days) || 0;
  const tiles = [
    { num: nf(s.count), lbl: isManga() ? 'Opere in lista' : 'Serie in lista' },
    { num: nf(s.episodesWatched), lbl: W().seenUnits },
    // il tempo si può calcolare solo per gli anime (durata degli episodi): per i manga il riquadro non c'è
    ...(isManga() ? [] : [{ num: days >= 1 ? days.toLocaleString('it-IT', { maximumFractionDigits: 1 }) + ' g' : nf(s.hours) + ' h', lbl: `${nf(s.hours)} ore davanti agli anime` }]),
    { num: s.meanScore != null ? (s.meanScore / 10).toLocaleString('it-IT', { maximumFractionDigits: 1 }) + '<small>/10</small>' : '—', lbl: 'Voto medio' }
  ];
  let html = `<div class="stat-grid">${tiles.map(b => `
    <div class="stat-box"><div class="num">${b.num}</div><div class="lbl">${b.lbl}</div></div>`).join('')}</div>`;

  html += vizStatus(s.byStatus || {});
  html += `<div class="viz-grid">`;
  html += vizScores(s);
  html += vizBars('Generi più seguiti', (s.topGenres || []).map(g => ({
    name: IT.genre[g.name] || g.name, value: g.count,
    extra: g.mean ? '★ ' + fmtScore(g.mean) : '',
    tip: `${IT.genre[g.name] || g.name}: ${nf(g.count)} serie${g.mean ? ` · tuo voto medio ${fmtScore(g.mean)}/10` : ''}`
  })), 'serie · tuo voto medio', (r, i) => `var(--viz-${(i % 8) + 1})`);
  html += vizYears(s.byYear);
  const formats = Object.entries(s.byFormat || {}).sort((a, b) => b[1] - a[1]);
  html += vizBars('Formati', formats.map(([f, n]) => ({ name: IT.format[f] || f, value: n })), 'serie viste o iniziate', () => 'var(--viz-6)');
  html += vizBars('Studi più presenti', (s.topStudios || []).map(g => ({ name: g.name, value: g.count })), null, () => 'var(--viz-7)');
  html += vizBars(W().longest, (s.topLongest || []).map(g => ({ name: animeTitle(g), value: g.episodes, tip: `${animeTitle(g)}: ${nf(g.episodes)} ${W().units}` })), W().units, () => 'var(--viz-4)');
  html += `</div>`;
  return html;
}

// ---------- Il tuo anno ("Wrapped") ----------
// Dati da GET /wrapped?year= (attività AniList dell'anno, in cache sul server). Slide a tutto schermo come le
// "storie": tocco a destra/sinistra o frecce per scorrere, alla fine un'immagine 1080×1920 da scaricare.
const WR = { data: null, i: 0, slides: [] };
const romeYear = () => Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Rome', year: 'numeric' }).format(new Date()));
function wrappedCta(){
  const y = romeYear();
  const years = new Date().getMonth() <= 1 ? [y - 1, y] : [y];   // a gennaio e febbraio anche l'anno appena finito
  return `<div class="wrapped-cta">
    <div><b>✨ Il tuo anno in anime e manga</b><small>Ore, serie del cuore, generi, record e maratone: come nelle "storie".</small></div>
    <div class="wrapped-cta-btns">${years.map(v => `<button class="btn" onclick="openWrapped(${v})">Il tuo ${v}</button>`).join('')}</div>
  </div>`;
}
const wrHours = min => Math.round(min / 60);
const wrDate = d => new Date(d + 'T12:00:00Z').toLocaleDateString('it-IT', { day: 'numeric', month: 'long', timeZone: 'UTC' });
const WR_MONTHS = ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic'];
function wrCover(x, cls = ''){ return x && x.cover ? `<img class="wr-cover ${cls}" src="${escapeAttr(x.cover)}" alt="" loading="lazy" decoding="async">` : ''; }
function wrappedSlides(d){
  const name = ($('#userName') && $('#userName').textContent) || '';
  const S = [];
  S.push({ bg: 1, html: `<div class="wr-kicker">${escapeHtml(name)}</div><h2 class="wr-big">Il tuo ${d.year}</h2>
    <p class="wr-sub">in anime e manga</p><p class="wr-hint">Tocca per andare avanti →</p>` });
  if (!d.eps && !d.chapters){
    S.push({ bg: 2, html: `<h2 class="wr-mid">Ancora niente da raccontare</h2><p class="wr-sub">AniList non ha attività registrate nel ${d.year}. Segna qualche episodio e torna qui!</p>` });
    return S;
  }
  if (d.eps) S.push({ bg: 2, html: `<div class="wr-kicker">Tempo davanti allo schermo</div>
    <div class="wr-num">${nf(wrHours(d.minutes))}<small> ore</small></div>
    <p class="wr-sub">${nf(d.eps)} episodi di ${nf(d.seriesCount)} serie, in ${nf(d.activeDays)} giorni diversi${d.minutes >= 1440 ? ` — più di ${nf(Math.floor(d.minutes / 1440))} ${Math.floor(d.minutes / 1440) === 1 ? 'giorno intero' : 'giorni interi'}` : ''}.</p>` });
  if (d.topSeries && d.topSeries.length){
    const t = d.topSeries[0];
    S.push({ bg: 3, html: `<div class="wr-kicker">La serie del tuo anno</div>${wrCover(t, 'big')}
      <h2 class="wr-mid">${escapeHtml(animeTitle(t))}</h2><p class="wr-sub">${nf(t.eps)} episodi</p>
      ${d.topSeries.length > 1 ? `<ol class="wr-list" start="2">${d.topSeries.slice(1).map(x => `<li>${escapeHtml(animeTitle(x))} <small>${nf(x.eps)} ep.</small></li>`).join('')}</ol>` : ''}` });
  }
  if (d.genres && d.genres.length){
    const max = d.genres[0][1];
    S.push({ bg: 4, html: `<div class="wr-kicker">I tuoi generi</div><h2 class="wr-mid">${escapeHtml(IT.genre[d.genres[0][0]] || d.genres[0][0])}</h2>
      <div class="wr-bars">${d.genres.map(([g, n]) => `<div class="wr-bar"><span>${escapeHtml(IT.genre[g] || g)}</span><i style="width:${Math.max(6, n / max * 100)}%"></i><small>${nf(n)}</small></div>`).join('')}</div>` });
  }
  if (d.studios && d.studios.length) S.push({ bg: 5, html: `<div class="wr-kicker">Lo studio che hai visto di più</div>
    <h2 class="wr-mid">${escapeHtml(d.studios[0][0])}</h2><p class="wr-sub">${nf(d.studios[0][1])} episodi</p>
    ${d.studios.length > 1 ? `<ol class="wr-list" start="2">${d.studios.slice(1).map(([s, n]) => `<li>${escapeHtml(s)} <small>${nf(n)} ep.</small></li>`).join('')}</ol>` : ''}` });
  if (d.eps){
    const max = Math.max(...d.months, 1), best = d.months.indexOf(Math.max(...d.months));
    S.push({ bg: 6, html: `<div class="wr-kicker">Mese per mese</div><h2 class="wr-mid">Il mese più intenso: ${new Date(Date.UTC(2000, best, 15)).toLocaleDateString('it-IT', { month: 'long', timeZone: 'UTC' })}</h2>
      <div class="wr-cols">${d.months.map((n, i) => `<div><i style="height:${n ? Math.max(4, n / max * 100) : 0}%"></i><small>${WR_MONTHS[i]}</small></div>`).join('')}</div>` });
  }
  if (d.bestDay || d.streak) S.push({ bg: 7, html: `<div class="wr-kicker">I tuoi record</div>
    ${d.bestDay ? `<div class="wr-num">${nf(d.bestDay.eps)}<small> episodi</small></div><p class="wr-sub">in un giorno solo, il ${wrDate(d.bestDay.date)} 🔥</p>` : ''}
    ${d.streak && d.streak.days > 1 ? `<div class="wr-num sm">${nf(d.streak.days)}<small> giorni di fila</small></div><p class="wr-sub">dal ${wrDate(d.streak.from)} al ${wrDate(d.streak.to)}</p>` : ''}` });
  if (d.first) S.push({ bg: 8, html: `<div class="wr-kicker">Il tuo anno è iniziato con</div>${wrCover(d.first, 'big')}
    <h2 class="wr-mid">${escapeHtml(animeTitle(d.first))}</h2><p class="wr-sub">il ${wrDate(d.first.date)}</p>` });
  if (d.chapters) S.push({ bg: 3, html: `<div class="wr-kicker">E poi i manga</div><div class="wr-num">${nf(d.chapters)}<small> capitoli</small></div>
    <p class="wr-sub">di ${nf(d.mangaCount)} ${d.mangaCount === 1 ? 'opera' : 'opere'}</p>
    ${(d.topManga || []).length ? `<ol class="wr-list">${d.topManga.map(x => `<li>${escapeHtml(animeTitle(x))} <small>${nf(x.chapters)} cap.</small></li>`).join('')}</ol>` : ''}` });
  if (d.finishedCount) S.push({ bg: 5, html: `<div class="wr-kicker">Serie finite</div><div class="wr-num">${nf(d.finishedCount)}</div>
    ${d.meanScore ? `<p class="wr-sub">voto medio ${String(d.meanScore).replace('.', ',')}/10</p>` : ''}
    <div class="wr-covers">${d.finished.slice(0, 8).map(x => wrCover(x)).join('')}</div>` });
  S.push({ bg: 1, final: true, html: `<div class="wr-kicker">Il tuo ${d.year} in breve</div>
    <div class="wr-summary">
      ${d.eps ? `<div><b>${nf(wrHours(d.minutes))} h</b><small>${nf(d.eps)} episodi</small></div>` : ''}
      ${d.topSeries && d.topSeries[0] ? `<div><b>${escapeHtml(animeTitle(d.topSeries[0]))}</b><small>serie dell'anno</small></div>` : ''}
      ${d.genres && d.genres[0] ? `<div><b>${escapeHtml(IT.genre[d.genres[0][0]] || d.genres[0][0])}</b><small>genere preferito</small></div>` : ''}
      ${d.finishedCount ? `<div><b>${nf(d.finishedCount)}</b><small>serie finite</small></div>` : ''}
      ${d.chapters ? `<div><b>${nf(d.chapters)}</b><small>capitoli di manga</small></div>` : ''}
    </div>
    ${d.partial ? `<p class="wr-hint">Alcune attività non sono state lette: i numeri potrebbero essere un po' più bassi.</p>` : ''}
    <div class="wr-actions"><button class="btn" onclick="event.stopPropagation(); wrappedImage(this)">⬇️ Scarica l'immagine</button>
      <button class="btn ghost" onclick="event.stopPropagation(); closeWrapped()">Chiudi</button></div>` });
  return S;
}
function wrappedBack(){
  let back = $('#wrappedBack');
  if (!back){
    back = document.createElement('div');
    back.id = 'wrappedBack';
    back.className = 'wr-back';
    back.innerHTML = `<div class="wr-bars-top"></div><button class="wr-close" onclick="closeWrapped()" aria-label="Chiudi">×</button><div class="wr-slide"></div>`;
    back.addEventListener('click', e => {
      if (e.target.closest('button, a')) return;
      (e.clientX < window.innerWidth / 3) ? wrappedGo(-1) : wrappedGo(1);
    });
    document.body.appendChild(back);
  }
  return back;
}
async function openWrapped(year){
  const back = wrappedBack();
  back.classList.add('show');
  syncBodyScroll();
  back.querySelector('.wr-bars-top').innerHTML = '';
  back.querySelector('.wr-slide').className = 'wr-slide bg1';
  back.querySelector('.wr-slide').innerHTML = `<div class="wr-kicker">Il tuo ${year}</div><p class="wr-sub">Rileggo le tue attività su AniList… (la prima volta può volerci qualche secondo)</p>`;
  try {
    WR.data = await api('/wrapped?year=' + year);
  } catch (err){
    back.querySelector('.wr-slide').innerHTML = `<h2 class="wr-mid">Non ci sono riuscito</h2><p class="wr-sub">${escapeHtml(err.message)}</p>`;
    return;
  }
  if (!back.classList.contains('show')) return;
  WR.slides = wrappedSlides(WR.data);
  WR.i = 0;
  back.querySelector('.wr-bars-top').innerHTML = WR.slides.map(() => '<i></i>').join('');
  wrappedShow();
}
function wrappedShow(){
  const back = $('#wrappedBack');
  const s = WR.slides[WR.i];
  const el = back.querySelector('.wr-slide');
  el.className = 'wr-slide bg' + s.bg;
  el.innerHTML = s.html;
  back.querySelectorAll('.wr-bars-top i').forEach((b, k) => b.classList.toggle('on', k <= WR.i));
}
function wrappedGo(step){
  if (!WR.slides.length) return;
  const n = WR.i + step;
  if (n < 0) return;
  if (n >= WR.slides.length) return;          // l'ultima resta: da lì si scarica o si chiude
  WR.i = n;
  wrappedShow();
}
function closeWrapped(){
  const back = $('#wrappedBack');
  if (!back || !back.classList.contains('show')) return;
  back.classList.remove('show');
  syncBodyScroll();
}
document.addEventListener('keydown', e => {
  if (!$('#wrappedBack')?.classList.contains('show')) return;
  if (e.key === 'ArrowRight' || e.key === ' ') { e.preventDefault(); wrappedGo(1); }
  else if (e.key === 'ArrowLeft') wrappedGo(-1);
  else if (e.key === 'Escape') closeWrapped();
});
// immagine da condividere (formato storia 1080×1920), disegnata a mano su canvas
function wrLoadImg(src){
  return new Promise(res => {
    if (!src) return res(null);
    const im = new Image();
    im.crossOrigin = 'anonymous';
    im.onload = () => res(im);
    im.onerror = () => res(null);
    im.src = src;
  });
}
async function wrappedImage(btn){
  const d = WR.data;
  if (!d) return;
  btn.disabled = true;
  try {
    const W = 1080, H = 1920, c = document.createElement('canvas');
    c.width = W; c.height = H;
    const g = c.getContext('2d');
    const grad = g.createLinearGradient(0, 0, W, H);
    grad.addColorStop(0, '#3b1d6e'); grad.addColorStop(.55, '#c2185b'); grad.addColorStop(1, '#f4b740');
    g.fillStyle = grad; g.fillRect(0, 0, W, H);
    const txt = (s, x, y, size, weight = 600, color = '#fff', max = W - 160) => {
      g.font = `${weight} ${size}px Oswald, Inter, sans-serif`; g.fillStyle = color;
      let t = String(s);
      while (g.measureText(t).width > max && t.length > 3) t = t.slice(0, -2) + '…';
      g.fillText(t, x, y);
    };
    const name = ($('#userName') && $('#userName').textContent) || '';
    txt(name.toUpperCase(), 80, 150, 40, 500, 'rgba(255,255,255,.8)');
    txt('Il mio ' + d.year, 80, 260, 110, 700);
    txt('in anime e manga', 80, 330, 46, 400, 'rgba(255,255,255,.85)');
    const top = (d.topSeries || [])[0];
    const cover = await wrLoadImg(top && top.cover);
    let y = 420;
    if (cover){
      const cw = 420, ch = Math.round(cover.height / cover.width * cw);
      g.save(); g.shadowColor = 'rgba(0,0,0,.4)'; g.shadowBlur = 40;
      g.drawImage(cover, 80, y, cw, Math.min(ch, 600)); g.restore();
      txt('SERIE DELL\'ANNO', 540, y + 50, 30, 500, 'rgba(255,255,255,.75)', 460);
      txt(animeTitle(top), 540, y + 110, 48, 700, '#fff', 460);
      txt(nf(top.eps) + ' episodi', 540, y + 165, 36, 400, 'rgba(255,255,255,.85)', 460);
      y += Math.min(ch, 600) + 90;
    } else if (top){
      txt('SERIE DELL\'ANNO', 80, y + 40, 30, 500, 'rgba(255,255,255,.75)');
      txt(animeTitle(top), 80, y + 100, 56, 700); y += 250;
    }
    const stats = [
      d.eps ? [nf(wrHours(d.minutes)) + ' ore', nf(d.eps) + ' episodi'] : null,
      d.genres && d.genres[0] ? [IT.genre[d.genres[0][0]] || d.genres[0][0], 'genere preferito'] : null,
      d.studios && d.studios[0] ? [d.studios[0][0], 'studio più visto'] : null,
      d.finishedCount ? [nf(d.finishedCount), 'serie finite' + (d.meanScore ? ' · voto medio ' + String(d.meanScore).replace('.', ',') : '')] : null,
      d.bestDay ? [nf(d.bestDay.eps) + ' episodi', 'record in un giorno'] : null,
      d.chapters ? [nf(d.chapters) + ' capitoli', 'di manga'] : null
    ].filter(Boolean).slice(0, 6);
    for (const [big, small] of stats){
      txt(big, 80, y, 64, 700);
      txt(small, 80, y + 52, 34, 400, 'rgba(255,255,255,.8)');
      y += 150;
      if (y > H - 200) break;
    }
    const list = (d.topSeries || []).slice(1, 5);
    if (list.length && y < H - 300){
      txt('LE ALTRE PIÙ VISTE', 80, y, 30, 500, 'rgba(255,255,255,.75)');
      list.forEach((x, i) => txt((i + 2) + '. ' + animeTitle(x), 80, y + 60 + i * 56, 40, 500, '#fff'));
    }
    txt('Libreria Anime · dati AniList', 80, H - 80, 30, 400, 'rgba(255,255,255,.7)');
    const blob = await new Promise(r => c.toBlob(r, 'image/png'));
    if (!blob) throw new Error('il browser non ha creato l\'immagine');
    const file = new File([blob], `il-mio-${d.year}-anime.png`, { type: 'image/png' });
    // sul telefono: condividi (Telegram, WhatsApp, Instagram…); altrimenti download
    if (navigator.canShare && navigator.canShare({ files: [file] })){
      try { await navigator.share({ files: [file], title: 'Il mio ' + d.year + ' in anime' }); return; } catch (e) { if (e.name === 'AbortError') return; }
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = file.name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  } catch (err){
    showToast('Immagine non creata: ' + err.message, 'error');
  } finally { btn.disabled = false; }
}

// tooltip condiviso per tutti gli elementi con data-tip (mouse; su touch compare al tocco)
(function(){
  const tip = document.createElement('div');
  tip.className = 'viz-tip';
  document.body.appendChild(tip);
  let cur = null;
  const show = (el, x, y) => {
    cur = el;
    tip.textContent = el.dataset.tip;
    tip.classList.add('show');
    const w = tip.offsetWidth, h = tip.offsetHeight;
    tip.style.left = Math.min(window.innerWidth - w - 8, Math.max(8, x - w / 2)) + 'px';
    tip.style.top = (y - h - 12 < 8 ? y + 18 : y - h - 12) + 'px';
  };
  const hide = () => { cur = null; tip.classList.remove('show'); };
  document.addEventListener('mousemove', e => {
    const el = e.target.closest && e.target.closest('#content [data-tip]');
    if (el) show(el, e.clientX, e.clientY); else if (cur) hide();
  });
  document.addEventListener('click', e => {
    const el = e.target.closest && e.target.closest('#content [data-tip]');
    if (el && el !== cur){ const r = el.getBoundingClientRect(); show(el, r.left + r.width / 2, r.top); }
    else hide();
  });
  document.addEventListener('scroll', hide, { passive: true, capture: true });  // capture: lo scroll di #appBody non risale a window
})();

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

// ---------- Tab: Telegram ----------
// Notifiche v2 in prova: il pannello preferenze lo vedono solo gli amministratori finché resta true
const NOTIF_V2_TEST = false;
const PREF_DEFAULTS = { airing:true, seasons:true, planning:true, digest:true, digestHour:9, weekly:true, manga:true, quietStart:23, quietEnd:8 };

async function loadTelegram(){
  // Discord in parallelo: se gli endpoint non ci sono ancora (404) il riquadro semplicemente non compare
  const discord = api('/discord?r=' + encodeURIComponent(location.href.split('#')[0])).catch(() => null);
  const crunchy = (IS_ADMIN || !CR_TEST) ? crApi('status').catch(() => null) : null;
  const t = await api('/telegram');
  if (t.linked && (IS_ADMIN || !NOTIF_V2_TEST)){
    try { t.prefs = (await api('/prefs')).prefs; } catch (err) { t.prefsError = err.message; }
  }
  t.discord = await discord;
  t.crunchyroll = await crunchy;
  return t;
}

function hourOptions(sel){
  let h = '';
  for (let i = 0; i < 24; i++) h += `<option value="${i}" ${i === sel ? 'selected' : ''}>${String(i).padStart(2, '0')}:00</option>`;
  return h;
}

function renderPrefs(t){
  if (!(IS_ADMIN || !NOTIF_V2_TEST)) return '';
  if (t.prefsError) return `<div class="link-section"><p class="hint">Preferenze notifiche non disponibili: ${escapeHtml(t.prefsError)}</p></div>`;
  const p = Object.assign({}, PREF_DEFAULTS, t.prefs || {});
  const quietOn = p.quietStart != null && p.quietEnd != null;
  const row = (key, title, sub, extra = '') => `
    <div class="pref-row">
      <input type="checkbox" id="pf_${key}" ${p[key] ? 'checked' : ''}>
      <label for="pf_${key}">${title}<small>${sub}</small></label>${extra}
    </div>`;
  return `
    <div class="link-section" id="prefsBox">
      <h4>Notifiche</h4>
      <p class="hint">Scegli cosa ricevere sul bot.${NOTIF_V2_TEST ? ' <b>In prova: per ora valgono solo per gli amministratori.</b>' : ''}</p>
      ${row('airing', '📺 Nuovi episodi', 'Delle serie che stai guardando, con il pulsante “Visto”.')}
      ${row('seasons', '🆕 Nuove stagioni annunciate', 'Sequel, spin-off e film delle serie che hai in lista.')}
      ${row('planning', '▶️ Lista “Da vedere”', 'Quando una serie della lista inizia o finisce di uscire.')}
      ${row('digest', '☀️ Riepilogo del mattino', 'Cosa esce oggi, con gli orari.', `<select id="pf_digestHour" title="Ora del riepilogo">${hourOptions(p.digestHour)}</select>`)}
      ${row('weekly', '🗓 Il punto della settimana', 'Domenica sera: episodi da recuperare e serie in pausa da tempo.')}
      ${row('manga', '📖 Nuovi capitoli manga', 'Dei manga che stai leggendo, con il link al sito ufficiale e “Letto”.')}
      <div class="pref-row">
        <input type="checkbox" id="pf_quiet" ${quietOn ? 'checked' : ''} onchange="$('#pf_quietStart').disabled = $('#pf_quietEnd').disabled = !this.checked">
        <label for="pf_quiet">🌙 Orario di silenzio<small>In queste ore non arriva niente: i messaggi arrivano appena finisce.</small></label>
        <select id="pf_quietStart" ${quietOn ? '' : 'disabled'}>${hourOptions(quietOn ? p.quietStart : 23)}</select>
        <span class="count">→</span>
        <select id="pf_quietEnd" ${quietOn ? '' : 'disabled'}>${hourOptions(quietOn ? p.quietEnd : 8)}</select>
      </div>
      <div class="actions"><button class="btn" onclick="savePrefs(this)">Salva preferenze</button></div>
    </div>`;
}

async function savePrefs(btn){
  const on = id => $('#pf_' + id).checked;
  const prefs = {
    airing: on('airing'), seasons: on('seasons'), planning: on('planning'), digest: on('digest'), weekly: on('weekly'), manga: on('manga'),
    digestHour: Number($('#pf_digestHour').value),
    quietStart: on('quiet') ? Number($('#pf_quietStart').value) : null,
    quietEnd: on('quiet') ? Number($('#pf_quietEnd').value) : null
  };
  btn.disabled = true; btn.textContent = 'Salvo…';
  try{
    const r = await api('/prefs', { method:'POST', body: JSON.stringify({ prefs }) });
    if (cache.telegram) cache.telegram.prefs = r.prefs;
    showToast('Preferenze salvate.', 'ok');
  }catch(err){ showToast('Errore: ' + err.message, 'error'); }
  btn.disabled = false; btn.textContent = 'Salva preferenze';
}

function renderTelegram(t){
  return `<div class="links">${renderTelegramBox(t)}${renderDiscord(t.discord)}${renderCrunchyroll(t.crunchyroll)}</div>`;
}

const LINK_LOGOS = {
  telegram: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M20.7 4.3 2.9 11.2c-.9.4-.9 1.5 0 1.8l4.4 1.4 1.7 5.3c.2.7 1.1.9 1.6.4l2.5-2.3 4.6 3.4c.6.4 1.4.1 1.6-.6l3-14.3c.2-.9-.7-1.6-1.6-1.2ZM9.6 14.2l-.4 3.6-1.3-4 9.4-6-7.7 6.4Z"/></svg>',
  crunchyroll: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.6" fill="none" stroke="currentColor" stroke-width="2.6"/><circle cx="14.6" cy="10.2" r="3.6" fill="currentColor"/></svg>',
  spotify: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10" fill="currentColor"/><path d="M6.8 9.4c3.6-1.1 7.6-.8 10.8 1M7.4 12.4c3-.8 6.2-.5 8.8.9M8 15.2c2.3-.6 4.6-.4 6.6.7" fill="none" stroke="var(--panel)" stroke-width="1.6" stroke-linecap="round"/></svg>',
  discord: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M19.3 5.4A16.6 16.6 0 0 0 15.1 4l-.5 1.1a15.4 15.4 0 0 0-5.2 0L8.9 4a16.6 16.6 0 0 0-4.2 1.4C2 9.4 1.3 13.3 1.6 17.1a16.8 16.8 0 0 0 5.1 2.6l1.1-1.8a10.8 10.8 0 0 1-1.7-.8l.4-.3a11.9 11.9 0 0 0 11 0l.4.3c-.5.3-1.1.6-1.7.8l1.1 1.8a16.8 16.8 0 0 0 5.1-2.6c.4-4.4-.7-8.3-3.1-11.7ZM8.5 14.8c-1 0-1.8-.9-1.8-2s.8-2 1.8-2 1.8.9 1.8 2-.8 2-1.8 2Zm7 0c-1 0-1.8-.9-1.8-2s.8-2 1.8-2 1.8.9 1.8 2-.8 2-1.8 2Z"/></svg>'
};

// Card uniforme per ogni servizio: logo, nome, stato e "Scollega" sempre nello stesso punto dell'intestazione
function linkCard({ service, name, state, who, unlink, id, body }){
  const status = { on:'Collegato', off:'Non collegato', na:'Non disponibile', err:'Da ricollegare' }[state];
  return `
    <section class="link-card ${service}" ${id ? `id="${id}"` : ''}>
      <header class="link-head">
        <span class="link-logo">${LINK_LOGOS[service]}</span>
        <div class="link-title">
          <h3>${name}</h3>
          <span class="link-status ${state}">${status}${who ? ` come <b>${escapeHtml(who)}</b>` : ''}</span>
        </div>
        ${unlink ? `<button class="btn secondary link-unlink" onclick="${unlink}(this)">Scollega</button>` : ''}
      </header>
      ${body}
    </section>`;
}

function renderDiscord(d){
  if (!d || !d.configured) return '';
  if (!d.linked){
    return linkCard({ service:'discord', name:'Discord', state:'off', body:`
      <p class="link-desc">Collega il tuo account Discord: entri in automatico nel server del gruppo, puoi condividere le tue attività
        nel canale #attività, ricevere le notifiche nel canale #notifiche e accedere a questa dashboard anche con Discord.</p>
      <div class="actions">
        <a class="btn" href="${escapeAttr(d.linkUrl)}" style="text-decoration:none;">Collega Discord</a>
      </div>` });
  }
  return linkCard({ service:'discord', name:'Discord', state:'on', who: d.discordName || 'utente Discord',
    unlink:'unlinkDiscord', id:'discordBox', body:`
      <p class="link-desc">Ora puoi accedere a questa dashboard anche con “Accedi con Discord”.</p>
      <div class="link-section">
        <h4>Sul server</h4>
        <div class="pref-row">
          <input type="checkbox" id="dc_shareActivity" ${d.shareActivity ? 'checked' : ''}>
          <label for="dc_shareActivity">🎬 Condividi le mie attività<small>Episodi visti, serie iniziate e finite con il voto, nel canale #attività del server.</small></label>
        </div>
        <div class="pref-row">
          <input type="checkbox" id="dc_notifiche" ${d.notifiche ? 'checked' : ''}>
          <label for="dc_notifiche">🔔 Notifiche su Discord<small>Nuovi episodi nel canale #notifiche, con la tua menzione. Chi non le attiva non vede il canale.</small></label>
        </div>
      </div>
      ${Array.isArray(d.gusti) ? `
      <div class="link-section">
        <h4>🏷️ I tuoi gusti</h4>
        <p class="hint">Diventano ruoli sul server: gli altri vedono cosa ti piace e possono menzionarli per chiedere consigli.</p>
        <div class="chips gusti">
          ${d.gusti.map(g => `<button type="button" class="chip ${g.on ? 'active' : ''}" data-gusto="${escapeAttr(g.key)}"
            aria-pressed="${g.on}" onclick="this.classList.toggle('active'); this.setAttribute('aria-pressed', this.classList.contains('active'))">${escapeHtml(g.name)}</button>`).join('')}
        </div>
      </div>` : ''}
      <div class="actions">
        <button class="btn" onclick="saveDiscordPrefs(this)">Salva</button>
      </div>` });
}

// ---------- Crunchyroll (workflow "Crunchyroll (amici)") ----------
// true = la scheda la vedono solo gli amministratori (per provare novità; vedi anche SOLO_UTENTI in build_crunchyroll.py)
const CR_TEST = false;
let CR_POLL = null;
function crApi(action, extra = {}){
  return api('/crunchyroll', { method:'POST', body: JSON.stringify(Object.assign({ action }, extra)) });
}
function setCr(c){
  if (cache.telegram) cache.telegram.crunchyroll = c;
  const box = $('#crBox');
  if (box) box.outerHTML = renderCrunchyroll(c);
}
function renderCrunchyroll(c){
  if (!c || c.error) return '';
  const card = (state, body, extra = {}) => linkCard(Object.assign({ service:'crunchyroll', name:'Crunchyroll', state, id:'crBox', body }, extra));
  if (c.stato === 'linked'){
    const since = c.since ? new Date(c.since).toLocaleDateString('it-IT', { day:'numeric', month:'long' }) : '';
    return card('on', `
      <p class="link-desc">Quando finisci un episodio su Crunchyroll, da qualunque dispositivo, entro 10 minuti viene segnato su AniList
        e ti arriva un messaggio su Telegram. Conta solo quello che guardi${since ? ` dal ${since}` : ''} in poi.</p>
      ${c.errore ? `<p class="hint cr-warn">Ultimo controllo non riuscito: ${escapeHtml(c.errore)}</p>` : ''}
      <div class="link-section">
        <h4>Cronologia</h4>
        <p class="hint">Porta su AniList anche le serie viste prima del collegamento: prima ti mostriamo la lista, poi scegli tu cosa importare.
          Quelle importate hanno il riquadro “Da Crunchyroll” nella scheda della serie.</p>
        <div class="actions"><button class="btn secondary" onclick="crOpenImport()">Importa la cronologia</button></div>
      </div>`,
      { who: c.profileName ? 'profilo ' + c.profileName : '', unlink:'crUnlink' });
  }
  if (c.stato === 'pending'){
    return card('off', `
      <p class="link-desc">Apri <b>crunchyroll.com/activate</b> (con l’account Crunchyroll già aperto) e inserisci questo codice:</p>
      <div class="cr-code">${escapeHtml(c.userCode || '')}</div>
      <div class="actions">
        <button class="btn secondary" onclick="crCancel()">Annulla</button>
        <a class="btn" href="${escapeAttr(c.url || 'https://www.crunchyroll.com/activate')}" target="_blank" rel="noopener" style="text-decoration:none;">Apri crunchyroll.com/activate</a>
      </div>
      <p class="hint cr-wait">In attesa della conferma… il codice vale ${Math.max(1, Math.round(((c.expiresAt || 0) - Date.now()) / 60000))} minuti.</p>`);
  }
  if (c.stato === 'choose'){
    return card('off', `
      <p class="link-desc">Collegato all’account. Quale profilo è il tuo? Da lì leggiamo cosa guardi, gli altri profili non vengono toccati.</p>
      <div class="cr-profiles">
        ${(c.profiles || []).map(p => `<button class="btn secondary" ${p.taken ? 'disabled title="Già collegato da un’altra persona"' : ''}
          onclick="crProfile('${escapeAttr(p.id)}', this)">${escapeHtml(p.name)}${p.taken ? ' · già collegato' : ''}</button>`).join('')}
      </div>`);
  }
  const intro = c.stato === 'error'
    ? `<p class="link-desc">${escapeHtml(c.errore || 'Crunchyroll ha chiuso il collegamento.')} Succede se cambia la password dell’account
        o se qualcuno fa “esci da tutti i dispositivi”.</p>`
    : `<p class="link-desc">Gli episodi che finisci su Crunchyroll vengono segnati da soli su AniList, da qualunque dispositivo: TV, telefono o browser.
        Niente password: ti diamo un codice da inserire su crunchyroll.com/activate. Conta solo quello che guardi da quando lo colleghi.</p>
      <p class="hint">Account condiviso? Nessun problema: ognuno sceglie il proprio profilo.</p>`;
  return card(c.stato === 'error' ? 'err' : 'off', `${intro}
    <div class="actions"><button class="btn" onclick="crStart(this)">${c.stato === 'error' ? 'Ricollega' : 'Collega Crunchyroll'}</button></div>`);
}
async function crStart(btn){
  btn.disabled = true;
  try{
    const r = await crApi('start');
    if (r.error) throw new Error(r.error);
    setCr({ stato:'pending', userCode: r.userCode, url: r.url, expiresAt: Date.now() + (r.expiresIn || 300) * 1000 });
    crPoll();
  }catch(err){ showToast('Errore: ' + err.message, 'error'); btn.disabled = false; }
}
// controlla ogni 5 secondi finché il codice non viene confermato, scade, o si cambia scheda
function crPoll(){
  clearTimeout(CR_POLL);
  CR_POLL = setTimeout(async () => {
    const c = cache.telegram && cache.telegram.crunchyroll;
    if (!c || c.stato !== 'pending' || !$('#crBox')) return;
    try{
      const r = await crApi('poll');
      if (r.stato === 'choose'){ setCr({ stato:'choose', profiles: r.profiles }); return; }
      if (r.stato === 'expired' || Date.now() > c.expiresAt){ setCr({ stato:'off' }); showToast('Il codice è scaduto: riprova.', 'error'); return; }
    }catch(err){ /* rete ballerina: si riprova al giro dopo */ }
    crPoll();
  }, 5000);
}
function crCancel(){ clearTimeout(CR_POLL); setCr({ stato:'off' }); }
async function crProfile(id, btn){
  $$('#crBox .cr-profiles button').forEach(b => b.disabled = true);
  try{
    const r = await crApi('profile', { profileId: id });
    if (r.error) throw new Error(r.error);
    setCr(r);
    showToast('Crunchyroll collegato: da ora gli episodi finiti vengono segnati da soli.', 'ok');
  }catch(err){
    showToast('Errore: ' + err.message, 'error');
    $$('#crBox .cr-profiles button').forEach(b => b.disabled = b.textContent.includes('già collegato'));
  }
}
// Import della cronologia: il server confronta tutta la cronologia con la lista AniList (preview) e scrive solo le voci
// scelte (import). La finestra è creata qui, così funziona anche con un dashboard.html vecchio in cache.
let CR_PLAN = null;
function crImportBox(){
  let back = $('#crImportBack');
  if (!back){
    back = document.createElement('div');
    back.className = 'modal-back';
    back.id = 'crImportBack';
    back.innerHTML = '<div class="modal detail cr-import" id="crImportBox"></div>';
    back.addEventListener('click', e => { if (e.target === back) crCloseImport(); });
    document.body.appendChild(back);
  }
  return back;
}
function crCloseImport(){
  const back = $('#crImportBack');
  if (!back) return;
  back.classList.remove('show');
  syncBodyScroll();
}
const crImportHead = sub => `<button class="detail-close" onclick="crCloseImport()" title="Chiudi">×</button>
  <div class="cr-import-head"><h2>Importa da Crunchyroll</h2>${sub ? `<p class="hint">${sub}</p>` : ''}</div>`;
async function crOpenImport(){
  if (CR_QUEUE_RUNNING) { crShowQueue(); return; }   // un import alla volta
  const back = crImportBox(), box = $('#crImportBox');
  box.dataset.view = 'plan';
  back.classList.add('show');
  back.style.zIndex = ++MODAL_Z;
  syncBodyScroll();
  box.innerHTML = crImportHead('') + '<div class="detail-body"><div class="loading">Leggo tutta la cronologia di Crunchyroll e la confronto con la tua lista… può volerci un minuto.</div></div>';
  try{
    const r = await crApi('preview');
    if (r.error) throw new Error(r.error);
    CR_PLAN = r.plan || [];
    CR_MANUAL = {};
    renderCrPlan(r.voci);
  }catch(err){
    box.innerHTML = crImportHead('') + `<div class="detail-body">${emptyState('Anteprima non riuscita: ' + err.message)}</div>`;
  }
}
function renderCrPlan(voci){
  const todo = CR_PLAN.filter(p => p.action === 'aggiungi' || p.action === 'aggiorna');
  const ok = CR_PLAN.filter(p => p.action === 'ok' || p.action === 'importata');
  const skip = CR_PLAN.filter(p => p.action === 'salta' || p.action === 'nessuno');
  const name = p => escapeHtml(p.anilist || p.crTitle);
  const cr = p => p.anilist && p.crTitle.toLowerCase() !== p.anilist.toLowerCase() ? `<small>Crunchyroll: ${escapeHtml(p.crTitle)}</small>` : '';
  const row = p => `
    <label class="cr-row">
      <input type="checkbox" data-sid="${escapeAttr(p.sid)}" ${p.check ? 'checked' : ''} onchange="crCountSel()">
      <span class="cr-row-main"><b>${name(p)}</b>${cr(p)}
        <span class="cr-change">${escapeHtml(p.prima)} → <b>${escapeHtml(p.dopo)}</b></span>
        ${p.dubbio ? `<span class="cr-doubt">Da controllare: ${escapeHtml(p.dubbio)}</span>` : ''}</span>
      <span class="cr-when">vista ${new Date(p.last).toLocaleDateString('it-IT', { day:'numeric', month:'short', year:'numeric' })}</span>
    </label>`;
  const plain = (p, note) => `<div class="cr-row plain"><span class="cr-row-main"><b>${name(p)}</b>${cr(p)}<span class="cr-change">${escapeHtml(note)}</span></span></div>`;
  $('#crImportBox').dataset.view = 'plan';
  $('#crImportBox').innerHTML = crImportHead(`${voci ? voci + ' voci in cronologia, ' : ''}${CR_PLAN.length} serie. Scegli cosa portare su AniList: le altre non vengono toccate.`) + `
    <div class="detail-body">
      <h4>Da aggiungere o aggiornare (${todo.length})</h4>
      ${todo.length ? `<div class="cr-sel"><button class="linklike" onclick="crSelAll(true)">Tutte</button> · <button class="linklike" onclick="crSelAll(false)">Nessuna</button></div>
        <div class="cr-list">${todo.map(row).join('')}</div>` : '<p class="hint">Niente da importare: la tua lista è già allineata. 🎉</p>'}
      ${ok.length ? `<details class="cr-more"><summary>Già a posto (${ok.length})</summary><div class="cr-list">${ok.map(p => plain(p, p.action === 'importata' ? 'importata ora' : (p.prima || 'già a posto'))).join('')}</div></details>` : ''}
      ${skip.length ? `<details class="cr-more" ${Object.keys(CR_MANUAL).length ? 'open' : ''}><summary>Saltate (${skip.length})</summary>
        <p class="hint">Se sai a quale serie corrisponde, importala a mano: la scegli su AniList e decidi episodi e stato.</p>
        <div class="cr-list">${skip.map(p => crSkipRow(p, name, cr)).join('')}</div></details>` : ''}
    </div>
    ${todo.length ? `<div class="cr-import-foot"><button class="btn secondary" onclick="crCloseImport()">Annulla</button><button class="btn" id="crImportGo" onclick="crDoImport()"></button></div>` : ''}`;
  crCountSel();
}
// ---- import a mano delle serie saltate (non per i doppiaggi: la numerazione continua non corrisponde ad AniList)
let CR_MANUAL = {};   // sid -> { results, picked }
const crIsDub = p => /\b(dub|dubbed)\b|doppiat/i.test(p.crTitle || '');
function crSkipRow(p, name, cr){
  const note = p.why + (p.forse && p.forse.length ? ' · forse: ' + p.forse.join(', ') : '');
  return `<div class="cr-row plain cr-skip" id="crSkip-${escapeAttr(p.sid)}">
      <span class="cr-row-main"><b>${name(p)}</b>${cr(p)}<span class="cr-change">${escapeHtml(note)}</span></span>
      ${crIsDub(p) ? '' : `<button class="btn secondary cr-manual-btn" onclick="crManualOpen('${escapeAttr(p.sid)}')">Importa a mano</button>`}
    </div>
    <div class="cr-manual" id="crManual-${escapeAttr(p.sid)}" hidden></div>`;
}
// "Serie — Season 5" -> "Serie Season 5"; "Serie — Titolo della stagione" -> "Titolo della stagione"
function crManualQuery(p){
  const [series, season] = String(p.crTitle || '').split(' — ');
  const clean = t => String(t || '').replace(/\((italian|english|german|french|spanish)[^)]*\)/ig, '').trim();
  if (!season || /^(season|stagione)\s*0*1$/i.test(season.trim())) return clean(series);   // AniList non scrive "Season 1"
  return /^(season|stagione)\s*\d+/i.test(season) || season.split(/\s+/).length <= 2 ? clean(series + ' ' + season) : clean(season);
}
function crManualOpen(sid){
  const panel = $('#crManual-' + sid);
  if (!panel) return;
  if (!panel.hidden){ panel.hidden = true; return; }
  const p = CR_PLAN.find(x => x.sid === sid);
  CR_MANUAL[sid] = CR_MANUAL[sid] || { results: null, picked: null };
  panel.hidden = false;
  panel.innerHTML = `
    <div class="cr-manual-search">
      <input type="search" id="crQ-${escapeAttr(sid)}" value="${escapeAttr(crManualQuery(p))}" placeholder="Cerca su AniList…"
        onkeydown="if(event.key==='Enter'){event.preventDefault();crManualSearch('${escapeAttr(sid)}');}">
      <button class="btn secondary" onclick="crManualSearch('${escapeAttr(sid)}')">Cerca</button>
    </div>
    <div class="cr-manual-body" id="crMB-${escapeAttr(sid)}"></div>`;
  crManualSearch(sid);
}
async function crManualSearch(sid){
  const body = $('#crMB-' + sid), input = $('#crQ-' + sid), q = ((input || {}).value || '').trim();
  if (!body || !q) return;
  body.innerHTML = '<div class="loading">Cerco su AniList…</div>';
  const search = async t => {
    const d = await anilistPublic(`query ($q: String) { Page(perPage: 8) { media(search: $q, type: ANIME) {
      id title { english romaji native } format episodes seasonYear status coverImage { medium } } } }`, { q: t });
    return (d.Page && d.Page.media) || [];
  };
  try{
    let res = await search(q);
    // niente? si riprova con il solo nome della serie (prima del " — " di Crunchyroll)
    const p = CR_PLAN.find(x => x.sid === sid), series = String((p && p.crTitle) || '').split(' — ')[0].trim();
    if (!res.length && series && series.toLowerCase() !== q.toLowerCase()){ res = await search(series); if (res.length && input) input.value = series; }
    CR_MANUAL[sid].results = res;
    CR_MANUAL[sid].picked = null;
    crManualRender(sid);
  }catch(err){ body.innerHTML = `<p class="hint cr-warn">Ricerca non riuscita: ${escapeHtml(err.message)}</p>`; }
}
function crManualRender(sid){
  const body = $('#crMB-' + sid), st = CR_MANUAL[sid], p = CR_PLAN.find(x => x.sid === sid);
  if (!body || !st) return;
  const sub = m => [IT.format[m.format] || m.format, m.seasonYear, m.episodes ? m.episodes + ' ep.' : null].filter(Boolean).join(' · ');
  if (!st.picked){
    body.innerHTML = st.results.length
      ? `<div class="cr-results">${st.results.map(m => `<button class="cr-result" onclick="crManualPick('${escapeAttr(sid)}', ${m.id})">
          ${coverImg(m.coverImage && m.coverImage.medium, animeTitle(m))}<span><b>${escapeHtml(animeTitle(m))}</b><small>${escapeHtml(sub(m))}</small></span></button>`).join('')}</div>`
      : '<p class="hint">Nessun risultato: prova a cambiare il titolo.</p>';
    return;
  }
  const m = st.picked;
  const prog = m.episodes ? Math.min(p.maxFull || m.episodes, m.episodes) : (p.maxFull || 0);
  const status = m.episodes && prog >= m.episodes ? 'COMPLETED' : 'CURRENT';
  const opt = (v, t) => `<option value="${v}" ${v === status ? 'selected' : ''}>${t}</option>`;
  const eps = m.episodes || 0;
  body.innerHTML = `
    <div class="cr-picked">
      ${coverImg(m.coverImage && m.coverImage.medium, animeTitle(m))}
      <span><b>${escapeHtml(animeTitle(m))}</b><small>${escapeHtml(sub(m))}</small>
        <button class="linklike" onclick="crManualUnpick('${escapeAttr(sid)}')">Cambia serie</button></span>
    </div>
    <div class="cr-manual-form">
      <label>Episodi visti <input type="number" id="crP-${escapeAttr(sid)}" min="0" ${eps ? `max="${eps}"` : ''} value="${prog}"></label>
      <label>Stato <select id="crS-${escapeAttr(sid)}" onchange="crManualStatus('${escapeAttr(sid)}', this.value, ${eps})">
        ${opt('COMPLETED', 'Completato')}${opt('CURRENT', 'In corso')}${opt('PAUSED', 'In pausa')}${opt('PLANNING', 'Da vedere')}${opt('DROPPED', 'Droppato')}
      </select></label>
      <button class="btn" onclick="crManualSave('${escapeAttr(sid)}', this)">Importa</button>
    </div>
    ${p.maxFull ? `<p class="hint">Su Crunchyroll sei arrivato all’episodio ${p.maxFull}${p.nFull ? ` (${p.nFull} visti fino alla fine)` : ''}.</p>` : ''}`;
}
function crManualPick(sid, id){
  const st = CR_MANUAL[sid];
  st.picked = (st.results || []).find(m => m.id === id) || null;
  crManualRender(sid);
}
function crManualUnpick(sid){ CR_MANUAL[sid].picked = null; crManualRender(sid); }
// "Completato" porta gli episodi al totale della serie
function crManualStatus(sid, status, eps){ if (status === 'COMPLETED' && eps) $('#crP-' + sid).value = eps; }
async function crManualSave(sid, btn){
  const st = CR_MANUAL[sid], m = st && st.picked;
  if (!m) return;
  const progress = Number($('#crP-' + sid).value), status = $('#crS-' + sid).value;
  btn.disabled = true; btn.textContent = 'Importo…';
  try{
    const r = await crApi('manual', { sid, mediaId: m.id, progress, status, title: animeTitle(m) });
    if (r.error) throw new Error(r.error);
    const p = CR_PLAN.find(x => x.sid === sid);
    if (p) Object.assign(p, { action: 'importata', mediaId: r.mediaId, anilist: r.anilist, dopo: r.dopo });
    delete CR_MANUAL[sid];
    const row = $('#crSkip-' + sid), panel = $('#crManual-' + sid);
    if (panel) panel.remove();
    if (row) row.outerHTML = `<div class="cr-row plain"><span class="cr-row-main"><b>${escapeHtml(r.anilist)}</b>
      <small>Crunchyroll: ${escapeHtml(p ? p.crTitle : '')}</small><span class="cr-change">✅ importata a mano → <b>${escapeHtml(r.dopo)}</b></span></span></div>`;
    CR_STORICO = null;
    invalidateLists();
    showToast('Importata: ' + r.anilist, 'ok');
  }catch(err){
    showToast('Errore: ' + err.message, 'error');
    btn.disabled = false; btn.textContent = 'Importa';
  }
}
function crSelAll(on){ $$('#crImportBox .cr-list input[type=checkbox][data-sid]').forEach(c => c.checked = on); crCountSel(); }
function crCountSel(){
  const n = $$('#crImportBox .cr-list input[type=checkbox][data-sid]:checked').length;
  const b = $('#crImportGo');
  if (b){ b.textContent = n ? `Importa ${n} ${n === 1 ? 'serie' : 'serie'}` : 'Seleziona almeno una serie'; b.disabled = !n; }
}
// L'import va avanti una serie alla volta, con una pausa tra l'una e l'altra (AniList accetta circa 30 richieste al
// minuto e ogni serie ne costa un paio): la coda sta nel browser, così si può chiudere la finestra e fare altro,
// e se si ricarica la pagina riparte da dove era rimasta. Il piano (cosa scrivere) resta sul server.
const CR_QUEUE_KEY = 'crImportQueue';
const CR_QUEUE_PAUSE = 6000;
let CR_QUEUE = null, CR_QUEUE_RUNNING = false;
function crQueueSave(){
  try { CR_QUEUE ? localStorage.setItem(CR_QUEUE_KEY, JSON.stringify(CR_QUEUE)) : localStorage.removeItem(CR_QUEUE_KEY); } catch (e) {}
}
function crDoImport(){
  const picked = $$('#crImportBox .cr-list input[type=checkbox][data-sid]:checked').map(c => c.dataset.sid);
  if (!picked.length) return;
  const byId = Object.fromEntries((CR_PLAN || []).map(p => [p.sid, p]));
  CR_QUEUE = { items: picked.map(sid => ({ sid, name: (byId[sid] && (byId[sid].anilist || byId[sid].crTitle)) || sid, dopo: byId[sid] && byId[sid].dopo, esito: '' })) };
  crQueueSave();
  crShowQueue();
  crRunQueue();
}
function crResumeImport(){
  if (CR_QUEUE_RUNNING || !(IS_ADMIN || !CR_TEST)) return;
  try { CR_QUEUE = JSON.parse(localStorage.getItem(CR_QUEUE_KEY) || 'null'); } catch (e) { CR_QUEUE = null; }
  if (CR_QUEUE && CR_QUEUE.items && CR_QUEUE.items.some(i => !i.esito)) crRunQueue();
}
async function crRunQueue(){
  if (CR_QUEUE_RUNNING) return;
  CR_QUEUE_RUNNING = true;
  crRenderQueue();
  for (const it of CR_QUEUE.items){
    if (it.esito) continue;
    it.esito = 'corso';
    crRenderQueue();
    try{
      const r = await crApi('import', { sids: [it.sid] });
      if (r.error) throw new Error(r.error);
      const e = (r.errori || [])[0];
      if (e) { it.esito = 'errore'; it.errore = e.errore; }
      else if ((r.fatti || []).length) { it.esito = 'ok'; it.dopo = r.fatti[0].dopo || it.dopo; }
      else it.esito = 'gia';   // nel frattempo era già a posto
    }catch(err){
      if (/Sessione scaduta/.test(err.message)) { it.esito = ''; CR_QUEUE_RUNNING = false; crQueueSave(); crRenderQueue(); return; }
      it.esito = 'errore'; it.errore = err.message;
    }
    const p = (CR_PLAN || []).find(x => x.sid === it.sid);
    if (p && it.esito === 'ok') p.action = 'importata';
    crQueueSave();
    crRenderQueue();
    if (CR_QUEUE.items.some(i => !i.esito)) await new Promise(r => setTimeout(r, CR_QUEUE_PAUSE));
  }
  CR_QUEUE_RUNNING = false;
  CR_STORICO = null;   // i riquadri "Da Crunchyroll" si ricaricano alla prossima scheda aperta
  invalidateLists();
  const ok = CR_QUEUE.items.filter(i => i.esito === 'ok').length, ko = CR_QUEUE.items.filter(i => i.esito === 'errore').length;
  showToast(`Crunchyroll: importate ${ok} serie${ko ? `, ${ko} non riuscite` : ''}.`, ko ? 'error' : 'ok');
  crQueueSave();
  crRenderQueue();
}
function crQueueStats(){
  const items = CR_QUEUE ? CR_QUEUE.items : [];
  const done = items.filter(i => i.esito && i.esito !== 'corso').length;
  return { items, done, total: items.length, pct: items.length ? Math.round(done / items.length * 100) : 0 };
}
// pillola in basso a sinistra (sempre visibile) + finestra, se aperta sulla coda
function crRenderQueue(){
  const { items, done, total, pct } = crQueueStats();
  let pill = $('#crProgress');
  if (!pill){
    pill = document.createElement('button');
    pill.id = 'crProgress';
    pill.type = 'button';
    pill.className = 'cr-progress';
    pill.title = 'Mostra l’importazione';
    pill.onclick = crShowQueue;
    document.body.appendChild(pill);
  }
  if (!total){ pill.remove(); return; }
  const ko = items.filter(i => i.esito === 'errore').length;
  const finished = done === total;
  pill.classList.toggle('done', finished);
  pill.classList.toggle('ko', finished && ko > 0);
  pill.innerHTML = `<span class="cr-progress-ico">${LINK_LOGOS.crunchyroll}</span>
    <span class="cr-progress-txt">${finished ? (ko ? `Import finito · ${ko} non riuscite` : 'Import finito ✓') : `Importo da Crunchyroll · ${done}/${total} · ${pct}%`}</span>
    <span class="cr-progress-bar"><i style="width:${pct}%"></i></span>`;
  const box = $('#crImportBox');
  if (box && box.dataset.view === 'queue' && $('#crImportBack').classList.contains('show')) box.innerHTML = crQueueHtml();
}
const CR_ESITO = { '': '⏳ in coda', corso: '⏳ in corso…', ok: '✅', gia: '👍 era già a posto', errore: '⚠️' };
function crQueueHtml(){
  const { items, done, total, pct } = crQueueStats();
  const finished = done === total;
  return crImportHead(finished
      ? 'Importazione finita.'
      : 'Una serie alla volta, per non superare i limiti di AniList. Puoi chiudere questa finestra e continuare a usare la dashboard: l’avanzamento resta in basso a sinistra (se ricarichi la pagina, riprende da dove era).') + `
    <div class="detail-body">
      <div class="cr-bar"><i style="width:${pct}%"></i></div>
      <p class="hint" style="margin:6px 0 12px;">${done} di ${total} · ${pct}%</p>
      <div class="cr-list">${items.map(i => `<div class="cr-row plain"><span class="cr-row-main"><b>${escapeHtml(i.name)}</b>
        <span class="${i.esito === 'errore' ? 'cr-doubt' : 'cr-change'}">${CR_ESITO[i.esito] || ''} ${i.esito === 'ok' ? escapeHtml(i.dopo || '') : i.esito === 'errore' ? escapeHtml(i.errore || '') : ''}</span></span></div>`).join('')}</div>
      ${finished ? '<p class="hint" style="margin-top:14px;">Nella scheda di ogni serie importata trovi il riquadro “Da Crunchyroll”.</p>' : ''}
    </div>
    <div class="cr-import-foot">${finished
      ? '<button class="btn secondary" onclick="crClearQueue()">Chiudi e togli l’avanzamento</button>'
      : '<button class="btn secondary" onclick="crCloseImport()">Continua a usare la dashboard</button>'}</div>`;
}
function crShowQueue(){
  const back = crImportBox(), box = $('#crImportBox');
  box.dataset.view = 'queue';
  box.innerHTML = crQueueHtml();
  back.classList.add('show');
  back.style.zIndex = ++MODAL_Z;
  syncBodyScroll();
}
function crClearQueue(){
  if (CR_QUEUE_RUNNING) return;
  CR_QUEUE = null;
  crQueueSave();
  crRenderQueue();
  crCloseImport();
  refreshActive();
}

// Riquadro "Da Crunchyroll" nella scheda serie: cosa è stato importato o segnato da Crunchyroll (anime_cr_storico)
let CR_STORICO = null, CR_STORICO_LOADING = null;
async function loadCrStorico(){
  if (CR_STORICO) return CR_STORICO;
  if (!CR_STORICO_LOADING) CR_STORICO_LOADING = crApi('storico').then(r => {
    CR_STORICO = {};
    for (const it of (r.items || [])) CR_STORICO[it.mediaId] = it;
    return CR_STORICO;
  }).finally(() => { CR_STORICO_LOADING = null; });
  return CR_STORICO_LOADING;
}
async function renderCrTag(id){
  if (!(IS_ADMIN || !CR_TEST) || isManga()) return;
  let map;
  try { map = await loadCrStorico(); } catch (e) { return; }
  const it = map[id], el = $('#crTag');
  if (!it || !el || !DETAIL || DETAIL.id !== id) return;
  const quando = it.quando ? new Date(it.quando).toLocaleDateString('it-IT', { day:'numeric', month:'long', year:'numeric' }) : '';
  el.innerHTML = `<div class="cr-tag">
    <span class="cr-badge">${LINK_LOGOS.crunchyroll}Da Crunchyroll</span>
    <span>${it.fonte === 'import' ? 'Importata dalla cronologia' : 'Aggiornata in automatico'}${quando ? ' il ' + quando : ''}:
      ${escapeHtml(it.prima || '')} → <b>${escapeHtml(it.dopo || '')}</b></span>
  </div>`;
}

// ---------- Sigle (AnimeThemes) ----------
// Le sigle arrivano dal browser direttamente da api.animethemes.moe (CORS aperto), in due richieste:
// 1) id AnimeThemes dall'id AniList; 2) sigle di quell'anime SENZA filtri sui siti (filter[site] toglierebbe anche i link Spotify delle canzoni).
const AT_API = 'https://api.animethemes.moe';
const THEMES_CACHE = {};
async function atGet(path){
  let res;
  // durante i guasti Cloudflare risponde senza CORS: il browser dà solo "Failed to fetch"
  try { res = await fetch(AT_API + path, { headers:{ Accept:'application/json' } }); }
  catch (e) { throw new Error('AnimeThemes non è raggiungibile in questo momento, riprova più tardi'); }
  if (!res.ok) throw new Error('AnimeThemes non risponde (HTTP ' + res.status + '), riprova più tardi');
  return res.json();
}
async function loadThemes(id){
  if (THEMES_CACHE[id]) return THEMES_CACHE[id];
  const found = await atGet('/anime?filter[has]=resources&filter[site]=AniList&filter[external_id]=' + id + '&include=resources');
  const a = (found.anime || []).find(x => (x.resources || []).some(r => r.site === 'AniList' && Number(r.external_id) === id));
  let themes = [];
  if (a){
    const d = await atGet('/anime?filter[id]=' + a.id
      + '&include=animethemes.song.artists,animethemes.song.resources,animethemes.animethemeentries.videos.audio');
    const full = (d.anime || [])[0] || {};
    const ORDER = { OP:0, ED:1, IN:2 };
    themes = (full.animethemes || []).map(t => {
      const song = t.song || {};
      const res = site => ((song.resources || []).find(r => r.site === site) || {}).link || '';
      const sp = res('Spotify').match(/open\.spotify\.com\/(?:intl-[a-z]+\/)?track\/([A-Za-z0-9]{22})/);
      const entry = (t.animethemeentries || [])[0] || {};
      const video = (entry.videos || []).find(v => v.audio && v.audio.link) || (entry.videos || [])[0] || {};
      return {
        type: t.type, seq: t.sequence || null,
        title: song.title || '', artists: (song.artists || []).map(x => (x.artistsong && x.artistsong.as) || x.name).filter(Boolean),
        episodes: entry.episodes || '',
        audio: (video.audio && video.audio.link) || '', video: video.link || '',
        spotifyUrl: sp ? 'https://open.spotify.com/track/' + sp[1] : '',
        ytmusic: res('YouTube Music'), apple: res('Apple Music')
      };
    }).sort((x, y) => (ORDER[x.type] ?? 3) - (ORDER[y.type] ?? 3) || (x.seq || 0) - (y.seq || 0));
  }
  THEMES_CACHE[id] = themes;
  return themes;
}
const THEME_LABEL = { OP:'Opening', ED:'Ending', IN:'Insert song' };
function themeName(t){ return (THEME_LABEL[t.type] || t.type) + (t.seq ? ' ' + t.seq : ''); }

async function renderThemes(id){
  const el = $('#themesBox');
  if (!el) return;
  el.innerHTML = `<h4>Sigle</h4><div class="hint">Cerco opening ed ending…</div>`;
  let themes;
  try { themes = await loadThemes(id); }
  catch (err){
    // AnimeThemes giù (capita: guasti Cloudflare 522): la sezione sparisce invece di mostrare un errore in ogni scheda
    console.warn('Sigle:', err.message);
    if (DETAIL && DETAIL.id === id && $('#themesBox')) $('#themesBox').innerHTML = '';
    return;
  }
  if (!DETAIL || DETAIL.id !== id || !$('#themesBox')) return;
  if (!themes.length){ $('#themesBox').innerHTML = ''; return; }
  $('#themesBox').innerHTML = `<h4>Sigle</h4><div class="themes">${themes.map((t, i) => {
    const who = t.artists.join(', ');
    const search = 'https://open.spotify.com/search/' + encodeURIComponent([t.title, t.artists[0]].filter(Boolean).join(' '));
    const spLink = t.spotifyUrl
      ? `<a class="theme-sp" href="${escapeAttr(t.spotifyUrl)}" target="_blank" rel="noopener" title="Apri su Spotify">${LINK_LOGOS.spotify}</a>`
      : (t.title ? `<a class="theme-sp search" href="${escapeAttr(search)}" target="_blank" rel="noopener" title="Cerca su Spotify">${LINK_LOGOS.spotify}</a>` : '');
    return `<div class="theme" data-i="${i}">
      <button class="theme-play" ${t.audio ? '' : 'disabled'} onclick="playTheme(${id},${i},this)"
        title="${t.audio ? 'Ascolta la sigla' : 'Audio non disponibile'}" aria-label="Ascolta">▶</button>
      <div class="theme-meta">
        <div class="theme-kind">${escapeHtml(themeName(t))}${t.episodes ? ` · ep. ${escapeHtml(t.episodes)}` : ''}</div>
        <div class="theme-title">${escapeHtml(t.title || 'Titolo sconosciuto')}</div>
        ${who ? `<div class="theme-who">${escapeHtml(who)}</div>` : ''}
      </div>
      <div class="theme-links">
        ${spLink}
        ${t.ytmusic ? `<a class="theme-txt" href="${escapeAttr(t.ytmusic)}" target="_blank" rel="noopener" title="Apri su YouTube Music">YT</a>` : ''}
        ${t.apple ? `<a class="theme-txt" href="${escapeAttr(t.apple)}" target="_blank" rel="noopener" title="Apri su Apple Music">♫</a>` : ''}
      </div>
    </div>`;
  }).join('')}</div>
  <p class="watch-note">Sigle e audio da <a href="https://animethemes.moe" target="_blank" rel="noopener">AnimeThemes</a>.</p>`;
}

// lettore: uno solo per tutta la pagina, si ferma chiudendo la scheda
const THEME_AUDIO = new Audio();
THEME_AUDIO.preload = 'none';
let THEME_PLAYING = null;     // { id, i }
function resetPlayButtons(){ $$('.theme-play.playing').forEach(b => { b.classList.remove('playing'); b.textContent = '▶'; }); }
function stopTheme(){ THEME_AUDIO.pause(); THEME_PLAYING = null; resetPlayButtons(); }
function playTheme(id, i, btn){
  const t = (THEMES_CACHE[id] || [])[i];
  if (!t || !t.audio) return;
  if (THEME_PLAYING && THEME_PLAYING.id === id && THEME_PLAYING.i === i){ stopTheme(); return; }
  stopTheme();
  THEME_AUDIO.src = t.audio;
  THEME_PLAYING = { id, i };
  btn.classList.add('playing'); btn.textContent = '❚❚';
  THEME_AUDIO.play().catch(() => {
    stopTheme();
    // i Safari più vecchi non leggono l'audio .ogg: si apre il video della sigla
    if (t.video) window.open(t.video, '_blank', 'noopener');
    else showToast('Il browser non riesce a riprodurre questa sigla.', 'error');
  });
}
THEME_AUDIO.addEventListener('ended', stopTheme);

async function crUnlink(btn){
  btn.disabled = true;
  try{
    await crApi('unlink');
    setCr({ stato:'off' });
    showToast('Crunchyroll scollegato.', 'ok');
  }catch(err){ showToast('Errore: ' + err.message, 'error'); btn.disabled = false; }
}

async function saveDiscordPrefs(btn){
  btn.disabled = true; btn.textContent = 'Salvo…';
  try{
    const body = { shareActivity: $('#dc_shareActivity').checked, notifiche: $('#dc_notifiche').checked };
    // i gusti si mandano solo se il riquadro li mostra (server che li supporta, membro trovato)
    const chips = $$('#discordBox [data-gusto]');
    if (chips.length) body.gusti = chips.filter(b => b.classList.contains('active')).map(b => b.dataset.gusto);
    const r = await api('/discord/prefs', { method:'POST', body: JSON.stringify(body) });
    if (!r.ok) throw new Error(r.error === 'not_linked' ? 'Discord non è più collegato' : (r.error || 'errore'));
    if (cache.telegram && cache.telegram.discord) Object.assign(cache.telegram.discord, { shareActivity: r.shareActivity, notifiche: r.notifiche },
      Array.isArray(r.gusti) ? { gusti: r.gusti } : {});
    showToast('Preferenze Discord salvate.', 'ok');
  }catch(err){ showToast('Errore: ' + err.message, 'error'); }
  btn.disabled = false; btn.textContent = 'Salva';
}

async function unlinkDiscord(btn){
  btn.disabled = true;
  try{
    await api('/discord/unlink', { method:'POST', body:'{}' });
    showToast('Discord scollegato.', 'ok');
    loadTab('telegram', true);
  }catch(err){
    showToast('Errore: ' + err.message, 'error');
    btn.disabled = false;
  }
}

function renderTelegramBox(t){
  if (t.linked){
    return linkCard({ service:'telegram', name:'Telegram', state:'on', unlink:'unlinkTelegram', body:`
      <p class="link-desc">Scrivi <b>/menu</b> al bot per gestire la libreria dalla chat: le notifiche dei nuovi episodi arrivano lì in automatico.</p>
      ${renderPrefs(t)}` });
  }
  if (!t.linkUrl){
    return linkCard({ service:'telegram', name:'Telegram', state:'na', body:`
      <p class="link-desc">Il bot Telegram non è ancora configurato sul server.</p>` });
  }
  return linkCard({ service:'telegram', name:'Telegram', state:'off', body:`
    <p class="link-desc">Collega il bot Telegram per gestire la tua libreria dalla chat e ricevere le notifiche dei nuovi episodi.
      Premi il pulsante, poi su Telegram premi <b>Avvia</b>.</p>
    <div class="actions">
      <button class="btn secondary" onclick="loadTab('telegram', true)">Ho fatto, aggiorna</button>
      <a class="btn" href="${escapeAttr(t.linkUrl)}" target="_blank" rel="noopener" style="text-decoration:none;">Collega Telegram</a>
    </div>` });
}
async function unlinkTelegram(btn){
  btn.disabled = true;
  try{
    await api('/telegram/unlink', { method:'POST', body:'{}' });
    showToast('Telegram scollegato.', 'ok');
    loadTab('telegram', true);
  }catch(err){
    showToast('Errore: ' + err.message, 'error');
    btn.disabled = false;
  }
}

// ---------- Scheda dettagli (dati pubblici letti direttamente da AniList) ----------
const DETAIL_QUERY = `query($id:Int){ Media(id:$id){
  id type siteUrl title{romaji english native} coverImage{large} bannerImage
  description(asHtml:false) format status episodes chapters volumes duration source
  season seasonYear startDate{year month day} endDate{year month day}
  averageScore popularity genres nextAiringEpisode{episode airingAt}
  tags{name rank isMediaSpoiler isGeneralSpoiler}
  studios(isMain:true){nodes{name}}
  staff(perPage:25, sort:RELEVANCE){edges{role node{name{full}}}}
  relations{edges{relationType node{id type format status seasonYear siteUrl title{romaji english native} coverImage{medium}}}}
  externalLinks{site url type language color icon notes isDisabled}
}}`;

// ---------- Dove vederlo ----------
// AniList elenca i siti di streaming ma non dice in quali paesi funzionano: prima quelli attivi in Italia,
// gli altri a parte. JustWatch (Italia) è sempre in fondo perché mostra la disponibilità reale.
const WATCH_IT = ['Crunchyroll', 'Netflix', 'Amazon Prime Video', 'Disney Plus', 'YouTube', 'Bilibili TV', 'Apple TV', 'Rakuten Viki', 'Tubi TV'];
function watchSection(m){
  const seen = new Set();
  const links = (m.externalLinks || []).filter(l => l && l.type === 'STREAMING' && !l.isDisabled && /^https?:\/\//.test(l.url || ''))
    .filter(l => { const k = l.site + '|' + l.url; if (seen.has(k)) return false; seen.add(k); return true; });
  const rank = l => { const i = WATCH_IT.indexOf(l.site); return i < 0 ? 99 : i; };
  const italy = links.filter(l => rank(l) < 99).sort((a, b) => rank(a) - rank(b));
  const other = links.filter(l => rank(l) === 99);
  const btn = l => {
    const ic = l.icon ? `<span class="ic" style="background:${/^#[0-9a-f]{3,8}$/i.test(l.color || '') ? l.color : 'var(--muted)'}"><img src="${escapeAttr(l.icon)}" alt=""></span>`
                      : `<span class="ic">${escapeHtml(l.site.slice(0, 1))}</span>`;
    const extra = [l.language, l.notes].filter(Boolean).join(' · ');
    return `<a href="${escapeAttr(l.url)}" target="_blank" rel="noopener">${ic}${escapeHtml(l.site)}${extra ? ` <small>${escapeHtml(extra)}</small>` : ''}</a>`;
  };
  const title = m.title.english || m.title.romaji;
  const jw = `<a href="https://www.justwatch.com/it/cerca?q=${encodeURIComponent(title)}" target="_blank" rel="noopener"><span class="ic" style="background:#fbc500;color:#000">JW</span>Cerca su JustWatch</a>`;
  let html = `<h4>Dove vederlo</h4>`;
  html += `<div class="watch">${italy.map(btn).join('')}${jw}</div>`;
  if (other.length) html += `<div class="watch-note">Altri siti (spesso non disponibili in Italia):</div><div class="watch other" style="margin-top:6px;">${other.map(btn).join('')}</div>`;
  else if (!italy.length) html += `<div class="watch-note">AniList non ha link di streaming per questa serie.</div>`;
  return html;
}
const detailCache = {};
const IT = {
  format: { TV:'Serie TV', TV_SHORT:'Serie TV (corti)', MOVIE:'Film', SPECIAL:'Speciale', OVA:'OVA', ONA:'ONA', MUSIC:'Video musicale',
            MANGA:'Manga', NOVEL:'Light novel', ONE_SHOT:'One shot' },
  status: { FINISHED:'Concluso', RELEASING:'In corso', NOT_YET_RELEASED:'Non ancora uscito', CANCELLED:'Cancellato', HIATUS:'In pausa' },
  season: { WINTER:'Inverno', SPRING:'Primavera', SUMMER:'Estate', FALL:'Autunno' },
  source: { ORIGINAL:'Opera originale', MANGA:'Manga', LIGHT_NOVEL:'Light novel', VISUAL_NOVEL:'Visual novel', VIDEO_GAME:'Videogioco',
            NOVEL:'Romanzo', WEB_NOVEL:'Web novel', DOUJINSHI:'Doujinshi', ANIME:'Anime', LIVE_ACTION:'Live action', GAME:'Gioco',
            COMIC:'Fumetto', MULTIMEDIA_PROJECT:'Progetto multimediale', PICTURE_BOOK:'Libro illustrato', WEBTOON:'Webtoon', OTHER:'Altro' },
  genre: { Action:'Azione', Adventure:'Avventura', Comedy:'Commedia', Drama:'Drammatico', Ecchi:'Ecchi', Fantasy:'Fantasy', Hentai:'Hentai',
           Horror:'Horror', 'Mahou Shoujo':'Mahou Shoujo', Mecha:'Mecha', Music:'Musica', Mystery:'Mistero', Psychological:'Psicologico',
           Romance:'Romantico', 'Sci-Fi':'Fantascienza', 'Slice of Life':'Slice of life', Sports:'Sport', Supernatural:'Soprannaturale', Thriller:'Thriller' }
};
// in quest'ordine nella scheda: prima le altre stagioni, poi il resto, per ultima l'opera originale
const relationIT = { PREQUEL:'Prequel', SEQUEL:'Sequel', PARENT:'Serie principale', SIDE_STORY:'Storia parallela',
                     SPIN_OFF:'Spin-off', ALTERNATIVE:'Versione alternativa', SUMMARY:'Riassunto', COMPILATION:'Compilation',
                     CONTAINS:'Contiene', OTHER:'Altro', SOURCE:'Opera originale', ADAPTATION:'Tratto da' };
const RELATION_ORDER = Object.keys(relationIT);
const MANGA_FORMAT = { MANGA:'Manga', NOVEL:'Light novel', ONE_SHOT:'One shot' };
// scheda aperta da un'opera collegata: la pila serve al pulsante "Indietro"
const DETAIL_STACK = [];
function detailNav(){
  return `<button class="detail-close" onclick="closeDetails()" title="Chiudi">×</button>`
    + (DETAIL_STACK.length ? `<button class="detail-back" onclick="detailGoBack()" title="Torna alla serie precedente">← Indietro</button>` : '');
}
function openRelated(id){
  if (DETAIL) DETAIL_STACK.push(DETAIL.id);
  return openDetails(id);
}
function detailGoBack(){
  const prev = DETAIL_STACK.pop();
  if (prev != null) return openDetails(prev);
}

function fmtDate(d){
  if (!d || !d.year) return null;
  if (!d.month) return String(d.year);
  return new Date(d.year, d.month - 1, d.day || 1)
    .toLocaleDateString('it-IT', d.day ? { day:'numeric', month:'long', year:'numeric' } : { month:'long', year:'numeric' });
}
// ---------- Trama in italiano ----------
// /trama?id= traduce la trama di AniList una volta per serie (cache sul server, per tutti);
// "Originale" rimette l'inglese e la scelta resta (VIEW.plotLang).
const TRAMA_IT = {};
async function renderTrama(id){
  if (!DETAIL || DETAIL.id !== id || !$('#detailBox .synopsis') || !cleanSynopsis(DETAIL.m.description)) return;
  if (VIEW.plotLang === 'en' || TRAMA_IT[id] !== undefined) return showTrama(id, VIEW.plotLang !== 'en');
  const el = $('#detailBox .synopsis');
  el.classList.add('translating');
  try { TRAMA_IT[id] = (await api('/trama?id=' + id)).it || ''; } catch (e) { TRAMA_IT[id] = ''; }
  if (!DETAIL || DETAIL.id !== id) return;
  el.classList.remove('translating');
  showTrama(id, true);
}
function showTrama(id, italian){
  const el = $('#detailBox .synopsis');
  if (!el || !DETAIL || DETAIL.id !== id) return;
  const it = TRAMA_IT[id];
  const useIt = Boolean(italian && it);
  el.textContent = useIt ? it : cleanSynopsis(DETAIL.m.description);
  let bar = $('#tramaBar');
  if (!bar){ bar = document.createElement('div'); bar.id = 'tramaBar'; bar.className = 'trama-bar'; el.after(bar); }
  bar.innerHTML = useIt
    ? `Tradotta automaticamente · <a href="#" onclick="setTramaLang(${id}, false); return false">mostra l'originale</a>`
    : (it === '' ? '' : `<a href="#" onclick="setTramaLang(${id}, true); return false">🇮🇹 Traduci in italiano</a>`);
}
function setTramaLang(id, italian){
  VIEW.plotLang = italian ? 'it' : 'en';
  saveView();
  if (italian && TRAMA_IT[id] === undefined) renderTrama(id); else showTrama(id, italian);
}
function cleanSynopsis(s){
  if (!s) return '';
  return s.replace(/\r/g, '')
          .replace(/~!.*?!~/gs, '')            // spoiler nascosti di AniList
          .replace(/<br\s*\/?>/gi, '\n')
          .replace(/<[^>]+>/g, '')
          .replace(/&[a-z]+;|&#\d+;/gi, m => { const t = document.createElement('textarea'); t.innerHTML = m; return t.value; })
          .replace(/\n{3,}/g, '\n\n').trim();
}
function creatorsOf(m){
  // "Original Creator", "Original Story", "Story & Art", ... = autore dell'opera
  const re = /^(original creator|original story|original work|story & art|story|art)\s*(\(.*\))?$/i;
  const seen = new Set(), out = [];
  for (const e of (m.staff && m.staff.edges) || []){
    if (!re.test((e.role || '').trim())) continue;
    const name = e.node.name.full;
    if (seen.has(name)) continue;
    seen.add(name); out.push({ name, role: e.role });
  }
  return out;
}

let OPEN_SEQ = 0;
async function openDetails(id){
  const seq = ++OPEN_SEQ;                      // conta solo l'ultima scheda richiesta
  const box = $('#detailBox');
  if (!$('#detailBack').classList.contains('show')) DETAIL_STACK.length = 0;   // apertura "da fuori"
  $('#detailBack').classList.add('show');
  $('#detailBack').style.zIndex = ++MODAL_Z;
  syncBodyScroll();
  box.scrollTop = 0;
  DETAIL = null;
  if (!detailCache[id]){
    box.innerHTML = detailNav() + '<div class="detail-body"><div class="loading">Carico i dettagli…</div></div>';
    try{
      const res = await fetch('https://graphql.anilist.co', {
        method:'POST',
        headers:{ 'Content-Type':'application/json', 'Accept':'application/json' },
        body: JSON.stringify({ query: DETAIL_QUERY, variables: { id } })
      });
      if (res.status === 429) throw new Error('troppe richieste ad AniList, riprova tra un minuto');
      const j = await res.json();
      if (!j.data || !j.data.Media) throw new Error((j.errors && j.errors[0] && j.errors[0].message) || 'HTTP ' + res.status);
      detailCache[id] = j.data.Media;
    }catch(err){
      if (seq !== OPEN_SEQ) return;
      box.innerHTML = detailNav() + `<div class="detail-body">${emptyState('Impossibile caricare i dettagli: ' + err.message)}</div>`;
      return;
    }
  }
  // l'utente potrebbe aver chiuso o aperto un'altra scheda nel frattempo
  if (!$('#detailBack').classList.contains('show') || seq !== OPEN_SEQ) return;   // chiusa, o nel frattempo aperta un'altra
  DETAIL = { id, m: detailCache[id], entry: undefined };
  box.innerHTML = renderDetails(DETAIL.m);
  renderTrama(id);
  renderDetailFriends(id);
  renderCrTag(id);
  if (DETAIL.m.type === 'ANIME') renderThemes(id);
  try{
    const entry = await getEntry(id);
    if (DETAIL && DETAIL.id === id){ DETAIL.entry = entry; renderMyList(); }
  }catch(err){
    if (DETAIL && DETAIL.id === id && $('#myList')) $('#myList').innerHTML = `<div class="lbl">Impossibile leggere la tua lista: ${escapeHtml(err.message)}</div>`;
  }
}
function closeDetails(){
  if (!$('#detailBack').classList.contains('show')) return;
  if (document.activeElement && document.activeElement.id === 'myNotes') document.activeElement.blur();
  $('#detailBack').classList.remove('show');
  syncBodyScroll();
  stopTheme();
  DETAIL = null;
  DETAIL_STACK.length = 0;
  // se dalla scheda è cambiato qualcosa: invia subito le modifiche, poi aggiorna quello che c'è sotto
  if (DETAIL_DIRTY){
    DETAIL_DIRTY = false;
    flushAll().then(() => { invalidateLists(); refreshActive(); });
  }
}

// ---------- Azioni dalla scheda dettagli ----------
// Lo stato in lista arriva da GET /entry (tutti gli stati, anche "Da vedere").
// Se l'endpoint non risponde si ricava dalle liste già usate dalla dashboard.
let DETAIL = null, DETAIL_DIRTY = false;
const ENTRY_OVERRIDE = {};
const LIST_TABS = { library:'CURRENT', planning:'PLANNING', completed:'COMPLETED', paused:'PAUSED', dropped:'DROPPED' };
// carica le liste mancanti in cache; una lista che non risponde viene saltata
async function ensureLists(tabs){
  await Promise.all(tabs.map(async t => {
    if (cache[t]) return;
    try { cache[t] = await api(TAB_ENDPOINTS[t]); }
    catch (err) { if (err.message.includes('scaduta')) throw err; }
  }));
}

async function getEntry(id){
  // modifica fatta da qui e non ancora confermata dal server: vale quella
  if (ENTRY_OVERRIDE[id] !== undefined) return ENTRY_OVERRIDE[id];
  try{
    const r = await api('/entry?id=' + id);
    if ('entry' in r) return r.entry;
  }catch(err){
    if (err.message.includes('scaduta')) throw err;
  }
  await ensureLists(Object.keys(LIST_TABS));
  for (const [t, status] of Object.entries(LIST_TABS)){
    if (!cache[t]) continue;
    const it = cache[t].items.find(x => x.id === id);
    if (it) return { status, progress: it.progress != null ? it.progress : (status === 'COMPLETED' ? (it.episodes || 0) : 0),
                     progressVolumes: it.progressVolumes || 0, score: it.score || null };
  }
  return null;
}

// unità totali di un'opera: episodi per un anime, capitoli per un manga (null se ancora in corso)
const mediaTotal = m => m.episodes != null ? m.episodes : m.chapters;
function detailCap(m){
  const next = m.nextAiringEpisode;
  // per un manga il tetto sono i capitoli usciti (null se è ancora in pubblicazione)
  return next ? next.episode - 1 : mediaTotal(m);
}

function renderMyList(){
  if (DETAIL) setTimeout(() => { if (DETAIL) renderDetailFriends(DETAIL.id); }, 0);   // badge avanti/indietro con il progresso aggiornato
  const el = $('#myList');
  if (!el || !DETAIL) return;
  const { id, m, entry } = DETAIL;
  el.classList.remove('busy');
  if (entry === undefined){ el.innerHTML = '<div class="lbl">Controllo la tua lista…</div>'; return; }
  const statusBtn = (st, text) => {
    const c = LIST_LABELS[st].color;
    const active = entry && entry.status === st;
    if (st === 'REPEATING' && !active) return '';
    // se manca ancora un episodio programmato la serie non è finita: non si può "completare" per sbaglio
    if (st === 'COMPLETED' && !active && m.nextAiringEpisode) return '';
    return active
      ? `<span class="pill active" style="color:var(--accent-ink);background:${c === 'var(--muted)' ? 'var(--text)' : c};border-color:transparent;">✓ ${text}</span>`
      : `<button class="pill" onclick="detailStatus(${id},'${st}')">${text}</button>`;
  };
  if (!entry){
    // non ancora uscito: non può essere "in corso" né "già visto", l'unica scelta sensata è "Da vedere"
    const notYet = m.status === 'NOT_YET_RELEASED';
    el.innerHTML = `
      <div class="lbl">Non è nella tua lista</div>
      <div class="status-seg">
        ${notYet ? '' : `<button class="pill positive" onclick="detailStatus(${id},'CURRENT')">+ ${W().start}</button>`}
        <button class="pill${notYet ? ' positive' : ''}" onclick="detailStatus(${id},'PLANNING')">${listLabel('PLANNING')}</button>
        ${notYet ? '' : `<button class="pill" onclick="detailStatus(${id},'COMPLETED')">${W().done}</button>`}
      </div>
      ${notYet ? `<p class="hint" style="margin:8px 0 0;">Non è ancora uscito: puoi solo metterlo in "${listLabel('PLANNING')}".</p>` : ''}`;
    return;
  }
  const cap = detailCap(m);
  const total = mediaTotal(m);
  const showEps = entry.status !== 'PLANNING';
  const maxLabel = m.nextAiringEpisode ? `Fino all'ultimo uscito (${cap})` : 'Tutti';
  // una riga per contatore: i manga ne hanno due (volumi sopra, capitoli sotto), gli anime solo gli episodi.
  // `tetto` è il massimo raggiungibile (per una serie in onda è l'ultimo episodio uscito), `totale` quello dichiarato.
  const rigaProgresso = (etichetta, valore, tetto, totale, campo) => `
    <div class="ep-row">
      <span class="count">${etichetta}</span>
      <button class="step" ${valore <= 0 ? 'disabled' : ''} onclick="detailProgress(${id},'dec',null,'${campo}')">−</button>
      <input type="number" min="0" ${tetto != null ? `max="${tetto}"` : ''} value="${valore}" onchange="detailProgress(${id},'set',this.value,'${campo}')" onkeydown="if(event.key==='Enter')this.blur()">
      <span class="count">${totale ? '/ ' + totale : ''}</span>
      <button class="step" ${tetto != null && valore >= tetto ? 'disabled' : ''} onclick="detailProgress(${id},'inc',null,'${campo}')">+</button>
      ${tetto != null && valore < tetto ? `<button class="pill" onclick="detailProgress(${id},'max',null,'${campo}')">${escapeHtml(campo === 'volumes' ? 'Tutti' : maxLabel)}</button>` : ''}
      ${totale ? `<div class="bar"><i style="width:${Math.min(100, Math.round(valore / totale * 100))}%"></i></div>` : ''}
    </div>`;
  const èManga = m.type === 'MANGA' || isManga();
  el.innerHTML = `
    <div class="lbl">Nella tua lista</div>
    <div class="status-seg">
      ${statusBtn('CURRENT', listLabel('CURRENT'))}${statusBtn('REPEATING', listLabel('REPEATING'))}${statusBtn('PLANNING', listLabel('PLANNING'))}${statusBtn('PAUSED', 'In pausa')}${statusBtn('DROPPED', 'Droppato')}${statusBtn('COMPLETED', 'Completato')}
    </div>
    ${showEps ? (èManga ? rigaProgresso('Volumi letti', entry.progressVolumes || 0, m.volumes, m.volumes, 'volumes') : '')
      + rigaProgresso(W().seenUnits, entry.progress, cap, total, 'chapters') : ''}
    ${scoreWidgetHtml(id, entry)}
    <div class="notes-box">
      <textarea id="myNotes" maxlength="2000" placeholder="Note personali (visibili solo a te e su AniList)…"
        onchange="detailNotes(${id},this.value)">${escapeHtml(entry.notes || '')}</textarea>
    </div>
    <div style="margin-top:14px;text-align:right;">
      <button class="pill danger" onclick="detailRemove(${id})">Rimuovi dalla lista</button>
    </div>`;
  const scoreEl = $('#myScore');
  if (scoreEl) scoreLabel(scoreEl.value);
}

// Il controllo con cui si assegna il voto: nell'aspetto scelto su AniList (numero su 100, slider su 10
// intero o decimale, stelle o faccine). Internamente il voto resta sempre 0-100 (scoreRaw di AniList).
function scoreWidgetHtml(id, entry){
  const f = scoreFmt();
  const raw = entry.score || 0;
  const val = raw ? f.toDisplay(raw) : 0;
  const clearBtn = raw ? `<button class="pill" onclick="detailScore(${id},0)">Togli voto</button>` : '';
  if (SCORE_FORMAT === 'POINT_3'){
    const opt = (v, icon, label) => `<button class="pill${val === v ? ' active' : ''}" onclick="detailScore(${id},${v})" aria-label="${label}">${icon}</button>`;
    return `
    <div class="score-row">
      <span class="count">Il tuo voto</span>
      <span class="smiley-picker">${opt(1, '🙁', 'Non mi è piaciuto')}${opt(2, '😐', 'Nella media')}${opt(3, '🙂', 'Mi è piaciuto')}</span>
      ${clearBtn}
    </div>`;
  }
  if (SCORE_FORMAT === 'POINT_100'){
    return `
    <div class="score-row">
      <span class="count">Il tuo voto</span>
      <input type="number" id="myScore" min="0" max="100" step="1" value="${val || ''}" placeholder="0-100"
        onchange="detailScore(${id},this.value)" aria-label="Il tuo voto da 0 a 100">
      ${clearBtn}
    </div>`;
  }
  return `
    <div class="score-row">
      <span class="count">Il tuo voto</span>
      <input type="range" id="myScore" min="0" max="${f.max}" step="${f.step}" value="${val}"
        oninput="scoreLabel(this.value)" onchange="detailScore(${id},this.value)" aria-label="Il tuo voto da 0 a ${f.max}">
      <span class="val" id="myScoreVal"></span>
      ${clearBtn}
    </div>`;
}

function scoreValueLabel(v){
  if (!v) return 'nessun voto';
  if (SCORE_FORMAT === 'POINT_5'){
    const full = Math.floor(v), half = v % 1 !== 0;
    return '★'.repeat(full) + (half ? '½' : '') + '☆'.repeat(5 - full - (half ? 1 : 0));
  }
  if (SCORE_FORMAT === 'POINT_100') return `${v.toLocaleString('it-IT')} / 100`;
  return `★ ${v.toLocaleString('it-IT')} / 10`;
}

function scoreLabel(v){
  const el = $('#myScoreVal');
  if (!el) return;
  v = Number(v);
  el.textContent = scoreValueLabel(v);
  el.classList.toggle('none', !v);
}

function detailScore(id, value){
  if (!DETAIL || DETAIL.id !== id || !DETAIL.entry) return;
  const v = Number(value) || 0;
  const score = v ? scoreFmt().toRaw(v) : 0;
  if (score === (DETAIL.entry.score || 0)) return;
  applyLocal(id, Object.assign({}, DETAIL.entry, { score: score || null }));
  queueChange(id, { score });
  showToast(score ? `Voto salvato: ${scoreValueLabel(v)}` : 'Voto tolto.', 'ok');
}

function detailNotes(id, value){
  if (!DETAIL || DETAIL.id !== id || !DETAIL.entry) return;
  const notes = value.trim();
  if (notes === (DETAIL.entry.notes || '')) return;
  DETAIL.entry.notes = notes;                                  // niente rerender: si sta scrivendo
  ENTRY_OVERRIDE[id] = DETAIL.entry;
  DETAIL_DIRTY = true;
  queueChange(id, { notes });
}

// cuore condiviso da detailRemove (modal, con conferma) e dallo swipe-to-remove (con annulla): chiama /remove
// e allinea cache/stato locale. Rilancia l'errore: ogni chiamante decide come mostrarlo/recuperare.
async function removeEntry(id){
  // prima chiude eventuali modifiche in sospeso su questa serie, poi rimuove
  if (PENDING[id]){ PENDING[id].want = null; await flushSync(id); }
  await api('/remove', { method:'POST', body: JSON.stringify({ mediaId: id }) });
  applyLocal(id, null);
  invalidateLists();
}
async function detailRemove(id){
  const title = DETAIL && DETAIL.m ? animeTitle(DETAIL.m) : 'questa serie';
  if (!confirm(`Rimuovere "${title}" dalla tua lista?\nPerderai anche ${W().seenUnits.toLowerCase()} e voto.`)) return;
  $('#myList').classList.add('busy');
  try{
    await removeEntry(id);
    showToast('Rimossa dalla lista.', 'ok');
  }catch(err){ showToast('Errore: ' + err.message, 'error'); renderMyList(); }
}

// ---------- Swipe-to-remove: sparisce subito con un "Annulla", la /remove vera parte dopo qualche secondo ----------
const SWIPE_REMOVE_GRACE_MS = 4000;
const SWIPE_REMOVE_PENDING = {};   // mediaId -> { timer, originalHtml, placeholder }
function swipeRemoveCard(id, cardEl){
  if (SWIPE_REMOVE_PENDING[id]) return;
  const h3 = cardEl.querySelector('h3');
  const title = h3 ? h3.textContent : 'questa serie';
  const placeholder = document.createElement('div');
  placeholder.className = 'card simple-card rec-hidden';
  placeholder.dataset.id = id;
  placeholder.innerHTML = `<span>Rimossa: <b>${escapeHtml(title)}</b></span><button class="pill" onclick="undoSwipeRemove(${id})">Annulla</button>`;
  const originalHtml = cardEl.outerHTML;
  cardEl.replaceWith(placeholder);
  SWIPE_REMOVE_PENDING[id] = {
    originalHtml, placeholder,
    timer: setTimeout(() => commitSwipeRemove(id), SWIPE_REMOVE_GRACE_MS)
  };
}
function restoreSwipedCard(p){
  const tmp = document.createElement('div');
  tmp.innerHTML = p.originalHtml;
  if (p.placeholder.isConnected) p.placeholder.replaceWith(tmp.firstElementChild);
}
function undoSwipeRemove(id){
  const p = SWIPE_REMOVE_PENDING[id];
  if (!p) return;
  clearTimeout(p.timer);
  delete SWIPE_REMOVE_PENDING[id];
  restoreSwipedCard(p);
}
async function commitSwipeRemove(id){
  const p = SWIPE_REMOVE_PENDING[id];
  if (!p) return;
  delete SWIPE_REMOVE_PENDING[id];
  try{
    await removeEntry(id);
    showToast('Rimossa dalla lista.', 'ok');
  }catch(err){
    showToast('Errore: ' + err.message, 'error');
    restoreSwipedCard(p);
  }
}
async function commitSwipeAdd(mediaId, cardEl, notYetReleased){
  const status = await addToLibrary(mediaId, notYetReleased);
  const contentEl = cardEl.querySelector('.card-content') || cardEl;
  if (status){
    const actionsRow = cardEl.querySelector('.actions-row');
    if (actionsRow) actionsRow.innerHTML = libraryStatusPill(status, 0, null);
    cardEl.removeAttribute('data-swipe');
    const bg = cardEl.querySelector('.swipe-bg');
    if (bg) bg.remove();
  }
  contentEl.style.transform = '';
  syncSearchHtml();
}

// ---------- Gesture: swipe sulle card (solo touch) — destra aggiunge, sinistra rimuove ----------
// Delegato su #content (le card vengono ri-renderizzate spesso, riattaccare listener per ognuna sarebbe fragile).
(() => {
  const DECIDE_PX = 8;       // sotto questa soglia il movimento non è ancora chiaramente orizzontale o verticale
  const COMMIT_RATIO = .35;  // frazione della larghezza della card da superare per confermare l'azione
  let sw = null;

  function snapBack(){
    if (!sw) return;
    sw.contentEl.classList.remove('swiping');
    sw.contentEl.classList.add('swipe-snap');
    sw.contentEl.style.transform = '';
    if (sw.bg) sw.bg.style.opacity = 0;
    sw = null;
  }

  const content = $('#content');
  content.addEventListener('pointerdown', e => {
    if (e.pointerType !== 'touch') return;
    if (e.target.closest('button, a, input, textarea, select')) return;
    const card = e.target.closest('.card[data-swipe]');
    if (!card) return;
    sw = {
      card, dir: card.dataset.swipe,
      contentEl: card.querySelector('.card-content') || card,
      bg: card.querySelector('.swipe-bg'),
      id: Number(card.dataset.id),
      notYetReleased: card.dataset.notReleased === 'true',
      startX: e.clientX, startY: e.clientY,
      deciding: true, active: false,
      width: card.getBoundingClientRect().width || 260
    };
  }, { passive: true });

  content.addEventListener('pointermove', e => {
    if (!sw) return;
    const dx = e.clientX - sw.startX, dy = e.clientY - sw.startY;
    if (sw.deciding){
      if (Math.abs(dx) < DECIDE_PX && Math.abs(dy) < DECIDE_PX) return;
      if (Math.abs(dy) > Math.abs(dx)){ sw = null; return; }   // scroll verticale: lo gestisce il browser
      sw.deciding = false;
      sw.active = true;
      sw.contentEl.classList.add('swiping');
      sw.contentEl.classList.remove('swipe-snap');
    }
    if (!sw.active) return;
    e.preventDefault();
    const allowed = (sw.dir === 'add' && dx > 0) || (sw.dir === 'remove' && dx < 0);
    const shown = allowed ? dx : dx / 4;   // verso non consentito per questa card: solo un piccolo elastico
    sw.contentEl.style.transform = `translateX(${shown}px)`;
    if (sw.bg) sw.bg.style.opacity = Math.min(Math.abs(shown) / (sw.width * COMMIT_RATIO), 1);
  }, { passive: false });

  function end(e){
    if (!sw || !sw.active){ sw = null; return; }
    const dx = e.clientX - sw.startX;
    const allowed = (sw.dir === 'add' && dx > 0) || (sw.dir === 'remove' && dx < 0);
    const committed = allowed && Math.abs(dx) >= sw.width * COMMIT_RATIO;
    const { card, contentEl, id, dir, notYetReleased } = sw;
    contentEl.classList.remove('swiping');
    contentEl.classList.add('swipe-snap');
    if (!committed){ contentEl.style.transform = ''; if (sw.bg) sw.bg.style.opacity = 0; sw = null; return; }
    contentEl.style.transform = `translateX(${dx > 0 ? sw.width : -sw.width}px)`;
    sw = null;
    if (dir === 'add') commitSwipeAdd(id, card, notYetReleased);
    else setTimeout(() => swipeRemoveCard(id, card), 200);   // aspetta la fine dell'animazione di uscita
  }
  content.addEventListener('pointerup', end);
  content.addEventListener('pointercancel', snapBack);
})();

function detailStatus(id, status){
  if (!DETAIL || DETAIL.id !== id) return;
  const m = DETAIL.m, prev = DETAIL.entry;
  // aggiungendola per la prima volta: se non è ancora uscita non può che finire in "Da vedere"
  if (!prev && m.status === 'NOT_YET_RELEASED') status = 'PLANNING';
  const change = { status };
  let progress = prev ? prev.progress : 0;
  const totale = mediaTotal(m);
  if (status === 'COMPLETED' && totale){ progress = totale; change.progress = totale; }
  applyLocal(id, Object.assign({}, prev, { status, progress }));
  queueChange(id, change, totale);
  const labels = { CURRENT:'Spostata in In corso.', PLANNING:`Aggiunta a ${listLabel('PLANNING')}.`, PAUSED:'Messa in pausa.', DROPPED:'Droppata.', COMPLETED:'Segnata come completata.' };
  showToast(labels[status] || 'Aggiornata.', 'ok');
}

function detailProgress(id, action, value, field){
  if (!DETAIL || DETAIL.id !== id || !DETAIL.entry) return;
  const e = DETAIL.entry, m = DETAIL.m;
  const vol = field === 'volumes';
  const cap = vol ? m.volumes : detailCap(m);
  const clamp = v => Math.max(0, cap != null ? Math.min(v, cap) : v);
  const attuale = vol ? (e.progressVolumes || 0) : e.progress;
  let v = attuale;
  if (action === 'inc') v = clamp(v + 1);
  else if (action === 'dec') v = clamp(v - 1);
  else if (action === 'max' && cap != null) v = cap;
  else if (action === 'set') v = clamp(parseInt(value, 10) || 0);
  if (v === attuale){ renderMyList(); return; }
  const nuovo = vol ? { progressVolumes: v } : { progress: v };
  if (vol){
    const stima = capitoliDaVolumi(m.chapters, m.volumes, v, e.progress);
    if (stima != null) nuovo.progress = stima;
  }
  applyLocal(id, Object.assign({}, e, nuovo));
  queueChange(id, nuovo, vol ? m.volumes : mediaTotal(m));
}

function invalidateLists(){
  ['library','planning','paused','dropped','completed','recs','upcoming','stats'].forEach(t => delete cache[t]);
}
// aggiorna subito quello che si vede; il server lo riceve dopo (queueChange)
function applyLocal(id, entry){
  ENTRY_OVERRIDE[id] = entry;
  DETAIL_DIRTY = true;
  const item = cache.library && cache.library.items.find(x => x.id === id);
  if (item && entry && entry.status === 'CURRENT'){
    item.progress = entry.progress;
    if (entry.progressVolumes != null) item.progressVolumes = entry.progressVolumes;
  }
  if (DETAIL && DETAIL.id === id){ DETAIL.entry = entry; renderMyList(); }
}
$('#detailBack').addEventListener('click', e => { if (e.target === $('#detailBack')) closeDetails(); });
// $('#friendBack') può mancare se l'HTML in cache nel browser è più vecchio del JS appena scaricato:
// senza controllo qui bloccherebbe l'avvio di tutta la pagina.
if ($('#friendBack')) $('#friendBack').addEventListener('click', e => { if (e.target === $('#friendBack')) closeFriendProfile(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') { closeDetails(); closeFriendProfile(); closeSettings(); closeTabsSheet(); } });
// Card e "chip" con onclick ma senza <button>: Invio/Spazio le attivano come farebbe un click, per chi naviga da tastiera.
document.addEventListener('keydown', e => {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  const el = e.target.closest('[role="button"]');
  if (!el || el.tagName === 'BUTTON') return;
  e.preventDefault();
  el.click();
});

function renderDetails(m){
  const title = animeTitle(m);
  const alts = [m.title.english, m.title.romaji, m.title.native].filter(t => t && t !== title);
  const creators = creatorsOf(m);
  const studios = (m.studios && m.studios.nodes || []).map(s => s.name);
  const start = fmtDate(m.startDate), end = fmtDate(m.endDate);
  const facts = [
    ['Formato', IT.format[m.format] || m.format],
    ['Stato', IT.status[m.status] || m.status],
    ['Episodi', m.episodes ? m.episodes + (m.duration ? ` × ${m.duration} min` : '') : null],
    ['Capitoli', m.chapters || null],
    ['Volumi', m.volumes || null],
    ['Stagione', m.season ? `${IT.season[m.season]} ${m.seasonYear || ''}` : null],
    ['Data di uscita', start],
    ['Fine', end && end !== start ? end : null],
    ['Prossimo episodio', m.nextAiringEpisode ? `Ep. ${m.nextAiringEpisode.episode}, ${new Date(m.nextAiringEpisode.airingAt * 1000).toLocaleDateString('it-IT', { weekday:'short', day:'numeric', month:'short' })}` : null],
    ['Origine', IT.source[m.source] || m.source],
    ['Studio', studios.join(', ') || null],
    ['Autore', creators.length ? creators.map(c => c.name).join(', ') : null],
    ['Voto medio', m.averageScore ? m.averageScore + '%' : null]
  ].filter(f => f[1]);
  const tags = (m.tags || []).filter(t => !t.isMediaSpoiler && !t.isGeneralSpoiler).sort((a, b) => b.rank - a.rank).slice(0, 12);
  const related = ((m.relations && m.relations.edges) || [])
    .filter(e => relationIT[e.relationType] && e.node)
    .sort((a, b) => RELATION_ORDER.indexOf(a.relationType) - RELATION_ORDER.indexOf(b.relationType))
    .map(e => {
      const n = e.node, t = animeTitle(n);
      const isAnime = n.type === 'ANIME';
      const sameMode = n.type === mediaType();
      const sub = [isAnime ? (IT.format[n.format] || n.format) : (MANGA_FORMAT[n.format] || 'Manga'), n.seasonYear,
                   n.status === 'NOT_YET_RELEASED' ? 'non ancora uscito' : null].filter(Boolean).join(' · ');
      const inner = `${coverImg(n.coverImage && n.coverImage.medium, t)}
        <div class="meta"><div class="kind">${escapeHtml(relationIT[e.relationType])}</div>
        <div class="t">${escapeHtml(t)}</div><div class="sub">${escapeHtml(sub)}${sameMode ? '' : ' ↗'}</div></div>`;
      // stessa modalità: si apre qui dentro; l'altro mondo (l'anime tratto dal manga, o viceversa) si apre su AniList
      return sameMode
        ? `<button class="rel" onclick="openRelated(${n.id})">${inner}</button>`
        : `<a class="rel" href="${escapeAttr(n.siteUrl)}" target="_blank" rel="noopener">${inner}</a>`;
    });
  const synopsis = cleanSynopsis(m.description);

  return `
    ${detailNav()}
    ${m.bannerImage ? `<div class="detail-banner" style="background-image:url('${escapeAttr(m.bannerImage)}')"></div>` : ''}
    <div class="detail-head">
      ${coverImg(m.coverImage && m.coverImage.large, title)}
      <div class="meta" style="padding-top:${m.bannerImage ? '6px' : '0'}">
        <h2>${escapeHtml(title)}</h2>
        ${alts.length ? `<div class="alt">${alts.map(escapeHtml).join(' · ')}</div>` : ''}
        ${m.genres && m.genres.length ? `<div class="chips">${m.genres.map(g => `<button class="chip genre" data-kind="genre" data-value="${escapeAttr(g)}" onclick="searchByEl(this)" title="Tutto quello di questo genere">${escapeHtml(IT.genre[g] || g)}</button>`).join('')}</div>` : ''}
      </div>
    </div>
    <div class="my-list" id="myList"><div class="lbl">Controllo la tua lista…</div></div>
    <div class="friends-box" id="friendsBox"><div class="lbl">Amici…</div></div>
    <div id="crTag"></div>
    <div class="detail-body">
      <div class="facts">${facts.map(([k, v]) => `<div><span>${k}</span>${escapeHtml(String(v))}</div>`).join('')}</div>
      ${watchSection(m)}
      ${m.type === 'ANIME' ? '<div id="themesBox"></div>' : ''}
      <h4>Trama</h4>
      <div class="synopsis">${synopsis ? escapeHtml(synopsis) : '<span style="color:var(--muted)">Nessuna trama disponibile.</span>'}</div>
      ${tags.length ? `<h4>Tag</h4><div class="chips">${tags.map(t => `<button class="chip" data-kind="tag" data-value="${escapeAttr(t.name)}" onclick="searchByEl(this)" title="Tutto quello con questo tag">${escapeHtml(t.name)}<small>${t.rank}%</small></button>`).join('')}</div>` : ''}
      ${related.length ? `<h4>Opere collegate</h4><div class="rel-grid">${related.join('')}</div>` : ''}
      <div style="margin-top:20px;display:flex;gap:16px;flex-wrap:wrap;font-size:13px;">
        <a href="${escapeAttr(m.siteUrl)}" target="_blank" rel="noopener">Apri su AniList ↗</a>
        ${(() => { const o = (m.externalLinks || []).find(l => l && l.site === 'Official Site' && !l.isDisabled && /^https?:\/\//.test(l.url || '')); return o ? `<a href="${escapeAttr(o.url)}" target="_blank" rel="noopener">Sito ufficiale ↗</a>` : ''; })()}
      </div>
    </div>`;
}

// ---------- Tab: Per te (consigli) ----------
// Parte dalle serie che hai completato (pesate col tuo voto), che stai guardando o hai in pausa,
// chiede ad AniList le raccomandazioni degli utenti per ciascuna e le somma; droppate e completate
// con voto basso tolgono punti. Esclude quello che è già nelle tue liste e quello nascosto.
// In più: "Piaciute agli amici" (voto ≥ 8) e una spinta ai consigli che piacciono anche a loro.
const RECS_QUERY = () => `query($ids:[Int]){ Page(perPage:50){ media(id_in:$ids, type:${mediaType()}){
  id title{english romaji native}
  recommendations(sort:RATING_DESC, perPage:10){ nodes{ rating mediaRecommendation{
    id isAdult title{english romaji native} coverImage{medium} format episodes seasonYear averageScore genres status
  } } }
} } }`;
let RECS_GENRE = '';
const FRIEND_LIKED_QUERY = () => `query($ids:[Int]){ Page(perPage:50){ media(id_in:$ids, type:${mediaType()}){
  id isAdult title{english romaji native} coverImage{medium} format episodes seasonYear averageScore genres status } } }`;

async function loadRecs(){
  const tabs = ['library','completed','paused','dropped'];
  await Promise.all(tabs.map(async t => { if (!cache[t]) cache[t] = await api(TAB_ENDPOINTS[t]); }));
  await ensureLists(['planning']);
  const known = new Set(tabs.concat(cache.planning ? ['planning'] : []).flatMap(t => cache[t].items.map(x => x.id)));
  // consigli nascosti con "Non mi interessa" (se l'endpoint manca si va avanti senza)
  let hidden = [], canHide = true;
  try { hidden = (await api('/hidden')).ids || []; } catch (err) { if (err.message.includes('scaduta')) throw err; canHide = false; }
  const skip = new Set([...known, ...hidden]);
  // gli amici servono per la sezione "piaciute agli amici" e per dare una spinta ai consigli in comune
  let fr = null;
  try { fr = await loadFriendLists(); } catch (err) { fr = null; }

  // peso di ogni serie "seme": voto del completato (0-100), altrimenti un valore fisso.
  // Le serie che non ti sono piaciute (droppate, completate con voto basso) pesano in negativo:
  // abbassano i titoli che AniList consiglia a partire da quelle.
  const seeds = [], against = [];
  cache.completed.items.forEach(x => {
    if (x.score && x.score < 55) against.push({ id:x.id, title:animeTitle(x), w: -((60 - x.score) / 10 + 2) });
    else seeds.push({ id:x.id, title:animeTitle(x), w: x.score ? x.score / 10 : 7 });
  });
  cache.library.items.forEach(x => seeds.push({ id:x.id, title:animeTitle(x), w:6 }));
  cache.paused.items.forEach(x => seeds.push({ id:x.id, title:animeTitle(x), w:4 }));
  cache.dropped.items.forEach(x => against.push({ id:x.id, title:animeTitle(x), w:-5 }));
  seeds.sort((a, b) => b.w - a.w);
  against.sort((a, b) => a.w - b.w);
  const top = seeds.slice(0, 30).concat(against.slice(0, 15));
  if (!seeds.length) return { items: [], friendItems: [], noSeeds: true, canHide };

  const d = await anilistPublic(RECS_QUERY(), { ids: top.map(x => x.id) });
  const weight = Object.fromEntries(top.map(x => [x.id, x]));
  const acc = {};
  for (const m of d.Page.media){
    const seed = weight[m.id];
    if (!seed) continue;
    for (const n of m.recommendations.nodes){
      const r = n.mediaRecommendation;
      if (!r || r.isAdult || n.rating <= 0 || skip.has(r.id)) continue;
      const a = acc[r.id] || (acc[r.id] = { media:r, score:0, because:[] });
      const pts = seed.w * Math.log2(1 + n.rating);
      a.score += pts;
      if (pts > 0) a.because.push({ title: seed.title, pts });
    }
  }

  // amici: voto ≥ 8 su serie che stanno guardando o hanno finito
  const liked = {};
  if (fr){
    for (const [mid, list] of Object.entries(fr.byMedia)){
      const fans = list.filter(x => x.score >= 80 && ['COMPLETED','CURRENT','REPEATING'].includes(x.status));
      if (fans.length && !skip.has(Number(mid))) liked[mid] = fans;
    }
  }
  const fanNames = id => (liked[id] || []).map(x => x.friend.name);
  const toItem = (m, extra) => Object.assign({
    id: m.id, title: animeTitle(m), titles: m.title, cover: m.coverImage && m.coverImage.medium,
    format: m.format, episodes: m.episodes, year: m.seasonYear, avg: m.averageScore, genres: m.genres || [],
    status: m.status, fans: fanNames(m.id)
  }, extra);

  const items = Object.values(acc).filter(a => a.score > 0 && a.because.length).map(a => toItem(a.media, {
    because: a.because.sort((x, y) => y.pts - x.pts).map(b => b.title),
    score: a.score * (1 + (a.media.averageScore || 60) / 200) * (1 + 0.25 * fanNames(a.media.id).length)
  })).sort((a, b) => b.score - a.score).slice(0, 36);

  // piaciute agli amici: servono titolo e copertina, una richiesta per le prime 50 (le più votate)
  let friendItems = [];
  const likedIds = Object.keys(liked).map(Number)
    .sort((a, b) => liked[b].length - liked[a].length || Math.max(...liked[b].map(x => x.score)) - Math.max(...liked[a].map(x => x.score)))
    .slice(0, 50);
  if (likedIds.length){
    try{
      const fd = await anilistPublic(FRIEND_LIKED_QUERY(), { ids: likedIds });
      const pos = Object.fromEntries(likedIds.map((id, i) => [id, i]));
      friendItems = fd.Page.media.filter(m => !m.isAdult).sort((a, b) => pos[a.id] - pos[b.id]).slice(0, 12)
        .map(m => toItem(m, { friendScores: liked[m.id] }));
    }catch(err){ friendItems = []; }
  }
  // chi è già in "Piaciute agli amici" non si ripete sotto
  const inFriends = new Set(friendItems.map(x => x.id));
  return { items: items.filter(x => !inFriends.has(x.id)), friendItems, canHide, hiddenCount: hidden.length };
}

function setRecsGenre(g){ RECS_GENRE = g; renderTab(); }

// "Non mi interessa": sparisce subito, al suo posto resta un "Annulla" finché non cambi scheda
async function hideRec(id, btn){
  const card = btn.closest('.card');
  const title = card ? card.querySelector('h3').textContent : '';
  try{
    await api('/hidden', { method:'POST', body: JSON.stringify({ mediaId: id, hide: true }) });
  }catch(err){ showToast('Non riesco a nasconderlo: ' + err.message, 'error'); return; }
  const data = cache.recs;
  if (data){
    data.items = data.items.filter(x => x.id !== id);
    data.friendItems = data.friendItems.filter(x => x.id !== id);
    data.hiddenCount = (data.hiddenCount || 0) + 1;
  }
  if (card) card.outerHTML = `<div class="card simple-card rec-hidden" data-hidden="${id}">
    <span>Nascosto: <b>${escapeHtml(title)}</b></span>
    <button class="pill" onclick="unhideRec(${id}, this)">Annulla</button></div>`;
}

async function unhideRec(id, btn){
  btn.disabled = true;
  try{
    await api('/hidden', { method:'POST', body: JSON.stringify({ mediaId: id, hide: false }) });
    delete cache.recs;                 // ricalcola: il consiglio torna al suo posto
    loadTab('recs', true, true);
  }catch(err){ btn.disabled = false; showToast('Errore: ' + err.message, 'error'); }
}

function recCard(it, canHide, whyHtml){
  return `
      <div class="card simple-card">
        <div class="cover-row clickable" role="button" tabindex="0" onclick="openDetails(${it.id})">
          ${coverImg(it.cover, animeTitle(it))}
          <div class="meta">
            <h3>${escapeHtml(animeTitle(it))}</h3>
            <div class="sub">${[IT.format[it.format] || it.format, it.year, it.episodes ? `${it.episodes} ${W().unitAbbr}` : null].filter(Boolean).join(' · ')}</div>
            ${it.avg ? `<span class="score-badge">★ ${it.avg}%</span>` : ''}
            <div class="because">${whyHtml}</div>
          </div>
        </div>
        <div class="actions-row" style="border-top:1px solid var(--border);">
          <button class="pill positive" onclick="doAdd(${it.id}, this, ${it.status === 'NOT_YET_RELEASED'})">Aggiungi</button>
          ${canHide ? `<button class="pill" onclick="hideRec(${it.id}, this)" title="Non mostrarlo più">Non mi interessa</button>` : ''}
        </div>
      </div>`;
}

function renderRecs(data){
  if (data.noSeeds) return emptyState('Completa o inizia qualche serie: i consigli si basano su quello che hai visto.');
  const names = list => list.length > 2 ? `${list.slice(0, 2).map(escapeHtml).join(', ')} e altri ${list.length - 2}` : list.map(escapeHtml).join(' e ');
  let html = '';
  if (data.friendItems && data.friendItems.length){
    html += `<div class="panel-title">Piaciute agli amici</div><div class="grid">${data.friendItems.map(it => recCard(it, data.canHide,
      it.friendScores.map(x => `<b>${escapeHtml(x.friend.name)}</b> ★ ${fmtScore(x.score)}`).join(' · '))).join('')}</div>`;
  }
  if (!data.items.length){
    return html + emptyState('Nessun altro consiglio al momento: hai già visto tutto quello che ti suggerirebbero!');
  }
  const counts = {};
  data.items.forEach(it => it.genres.forEach(g => counts[g] = (counts[g] || 0) + 1));
  const genres = Object.keys(counts).sort((a, b) => counts[b] - counts[a]).slice(0, 8);
  if (RECS_GENRE && !genres.includes(RECS_GENRE)) RECS_GENRE = '';
  const shown = RECS_GENRE ? data.items.filter(it => it.genres.includes(RECS_GENRE)) : data.items.slice(0, 24);
  const chip = (g, label) => `<button class="chip ${RECS_GENRE === g ? 'active' : ''}" onclick="setRecsGenre('${escapeAttr(g)}')">${escapeHtml(label)}</button>`;
  html += `
    <div class="panel-title">Ti potrebbero interessare</div>
    <div class="recs-filter">${chip('', 'Tutti')}${genres.map(g => chip(g, IT.genre[g] || g)).join('')}</div>
    <div class="grid">${shown.map(it => recCard(it, data.canHide,
      `Perché hai visto <b>${escapeHtml(it.because[0])}</b>${it.because.length > 1 ? ` e altre ${it.because.length - 1}` : ''}`
      + (it.fans.length ? `<br>Piace anche a ${names(it.fans)}` : ''))).join('')}</div>`;
  if (data.hiddenCount) html += `<div class="cal-legend" style="margin-top:14px;">${data.hiddenCount} consigli nascosti con "Non mi interessa".</div>`;
  return html;
}

// ---------- Tab: News ----------
// News da AnimeClick.it (raccolte a parte ogni 30 min da n8n). /news restituisce sia quelle che citano un
// titolo/sinonimo della libreria di chi guarda (`items`) sia le ultime in generale (`latest`, con i tag):
// due viste, "Tutte" e "Le tue serie", più un filtro per argomento ricavato dai tag.
const NEWS_VIEW_KEY = 'animeDashboardNewsView';
let NEWS_VIEW = { scope: 'all', topic: '' };
try { Object.assign(NEWS_VIEW, JSON.parse(localStorage.getItem(NEWS_VIEW_KEY)) || {}); } catch (e) {}
function setNewsView(key, val){
  NEWS_VIEW[key] = val;
  if (key === 'scope') NEWS_VIEW.topic = '';
  try { localStorage.setItem(NEWS_VIEW_KEY, JSON.stringify(NEWS_VIEW)); } catch (e) {}
  renderTab();
}
// i tag di AnimeClick sono liberi (studi, editori, stagioni...): qui si raggruppano in pochi argomenti
const NEWS_TOPICS = [
  ['anime', 'Anime', t => t === 'anime' || t.startsWith('anime-') || t === 'crunchyroll'],
  ['manga', 'Manga e fumetti', t => /manga|fumett|novel|webtoon|manhwa|star-comics|j-pop|planet-manga/.test(t)],
  ['games', 'Videogiochi', t => /videogioc|jgdr|nintendo|playstation|xbox|steam|pc-games/.test(t)],
  ['movies', 'Film e live action', t => /film|live.action|cinema/.test(t)],
  ['japan', 'Giappone', t => t === 'giappone' || t.startsWith('cultura')]
];
function newsTopics(it){
  const tags = (it.tags || []).map(t => String(t).toLowerCase());
  return NEWS_TOPICS.filter(([, , test]) => tags.some(test)).map(([k]) => k);
}
function newsMatchChip(m){
  return `<span class="news-match" role="button" tabindex="0" onclick="openDetails(${m.id})" title="Apri la scheda">
    ${m.cover ? `<img src="${escapeAttr(m.cover)}" alt="" loading="lazy" decoding="async">` : ''}<span>${escapeHtml(animeTitle(m))}</span></span>`;
}
function newsItem(it){
  const sec = it.pubDate ? Date.parse(it.pubDate) / 1000 : null;
  const matches = it.matches || [];
  return `<div class="news-item ${matches.length ? 'followed' : ''}">
    <a href="${escapeAttr(it.link)}" target="_blank" rel="noopener noreferrer">
      ${it.image ? `<img class="news-thumb" src="${escapeAttr(it.image)}" alt="" loading="lazy" decoding="async" onerror="this.style.display='none'">` : ''}
    </a>
    <div class="txt">
      <div class="news-head">
        <a class="news-title" href="${escapeAttr(it.link)}" target="_blank" rel="noopener noreferrer">${escapeHtml(it.title)}</a>
        ${sec ? `<span class="when">${relTime(sec)}</span>` : ''}
      </div>
      ${matches.length ? `<div class="news-matches">${matches.map(newsMatchChip).join('')}</div>` : ''}
    </div>
  </div>`;
}
function renderNews(data){
  if (VIEW.showYen === false) return renderNewsList(data);   // nascosto dalla rotellina
  setTimeout(yenEnsure, 0);
  return `<div class="viz-card yen-card" id="yenBox">${yenInner()}</div>` + renderNewsList(data);
}
function renderNewsList(data){
  const mine = (data && data.items) || [];
  const latest = data && data.latest;
  // server non ancora aggiornato (niente `latest`): solo le news sulle tue serie, come prima
  if (!latest){
    if (!mine.length) return emptyState('Nessuna news di AnimeClick.it, nelle ultime settimane, cita una serie della tua libreria.');
    return `<div class="panel-title">News sulle tue serie</div>${mine.map(newsItem).join('')}`;
  }
  const scope = NEWS_VIEW.scope === 'mine' ? 'mine' : 'all';
  const base = scope === 'mine' ? mine : latest;
  const counts = {};
  base.forEach(it => newsTopics(it).forEach(k => counts[k] = (counts[k] || 0) + 1));
  const topics = NEWS_TOPICS.filter(([k]) => counts[k]);
  if (NEWS_VIEW.topic && !counts[NEWS_VIEW.topic]) NEWS_VIEW.topic = '';
  const shown = NEWS_VIEW.topic ? base.filter(it => newsTopics(it).includes(NEWS_VIEW.topic)) : base;
  const chip = (key, val, label, active) =>
    `<button class="chip ${active ? 'active' : ''}" onclick="setNewsView('${key}', '${escapeAttr(val)}')">${label}</button>`;
  const head = `
    <div class="recs-filter news-scope">
      ${chip('scope', 'all', 'Tutte', scope === 'all')}
      ${chip('scope', 'mine', `Le tue serie${mine.length ? ` <span class="tab-count">${mine.length}</span>` : ''}`, scope === 'mine')}
    </div>
    ${topics.length > 1 ? `<div class="recs-filter">${chip('topic', '', 'Ogni argomento', !NEWS_VIEW.topic)}${
      topics.map(([k, label]) => chip('topic', k, `${escapeHtml(label)} <small>${counts[k]}</small>`, NEWS_VIEW.topic === k)).join('')}</div>` : ''}`;
  if (!base.length){
    return head + emptyState(scope === 'mine'
      ? 'Nessuna news di AnimeClick.it, nelle ultime settimane, cita una serie della tua libreria.'
      : 'Nessuna news salvata negli ultimi 30 giorni.');
  }
  return head + shown.map(newsItem).join('');
}

// ---------- News: andamento dello yen ----------
// Cambio EUR→JPY della BCE via api.frankfurter.dev (gratis, CORS aperto), letto direttamente dal browser.
// La BCE pubblica un valore al giorno (verso le 16): il riquadro ricontrolla da solo ogni 30 minuti
// mentre la scheda News è aperta e si ridisegna quando arriva un dato nuovo.
// Più yen per 1 € = yen debole = comprare dal Giappone costa meno → Miku felice.
const YEN_RANGES = { '7': ['7 giorni', 0.3], '30': ['30 giorni', 0.5], '90': ['3 mesi', 1], '365': ['1 anno', 2] };  // [etichetta, soglia %]
const YEN_RANGE_KEY = 'animeDashboardYenRange';
const YEN_POLL_MS = 30 * 60 * 1000;
const YEN = { range: '30', series: {}, checkedAt: 0, loading: false, error: null, timer: null };
try { const r = localStorage.getItem(YEN_RANGE_KEY); if (YEN_RANGES[r]) YEN.range = r; } catch (e) {}

async function yenFetch(range){
  const start = new Date(Date.now() - Number(range) * 86400000).toISOString().slice(0, 10);
  // no-cache: l'API manda max-age di un giorno, senza questo il browser non vedrebbe mai il dato nuovo
  const res = await fetch(`https://api.frankfurter.dev/v1/${start}..?from=EUR&to=JPY`, { cache: 'no-cache' });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const j = await res.json();
  const pts = Object.entries(j.rates || {}).map(([d, r]) => ({ d, v: Number(r.JPY) })).filter(p => p.v > 0);
  pts.sort((a, b) => a.d < b.d ? -1 : 1);
  if (pts.length < 2) throw new Error('dati insufficienti');
  return pts;
}
async function yenLoad(force){
  const range = YEN.range;
  if (YEN.loading || (!force && YEN.series[range])) return;
  YEN.loading = true; YEN.error = null;
  try{
    const pts = await yenFetch(range);
    const prev = YEN.series[range];
    // è uscito un giorno nuovo: gli altri periodi in memoria sono vecchi, si riscaricano quando servono
    if (prev && prev[prev.length - 1].d !== pts[pts.length - 1].d) YEN.series = {};
    YEN.series[range] = pts;
    YEN.checkedAt = Date.now();
  }catch(err){
    YEN.error = err.message || 'errore';
  }finally{
    YEN.loading = false;
  }
  yenPaint();
  if (range !== YEN.range) yenLoad(false);   // nel frattempo è stato scelto un altro periodo
}
// chiamata a ogni disegno della scheda News: carica se serve e fa partire il controllo periodico
function yenEnsure(){
  if (!document.getElementById('yenBox')) return;
  yenLoad(Date.now() - YEN.checkedAt > YEN_POLL_MS);
  if (!YEN.timer) YEN.timer = setInterval(() => {
    // fuori dalla scheda News o con la pagina nascosta non si scarica niente
    if (!document.getElementById('yenBox') || document.visibilityState !== 'visible'){ clearInterval(YEN.timer); YEN.timer = null; return; }
    yenLoad(true);
  }, YEN_POLL_MS);
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') yenEnsure(); });
function setYenRange(r){
  if (!YEN_RANGES[r]) return;
  YEN.range = r;
  try { localStorage.setItem(YEN_RANGE_KEY, r); } catch (e) {}
  yenPaint();
  yenLoad(false);
}
// ridisegna solo il riquadro; Miku si tocca solo se cambia umore, così l'animazione non riparte a ogni aggiornamento
function yenPaint(){
  const box = document.getElementById('yenBox');
  if (!box) return;
  const tmp = document.createElement('div');
  tmp.innerHTML = yenInner();
  const oldMiku = box.querySelector('.yen-miku'), newMiku = tmp.querySelector('.yen-miku');
  if (oldMiku && newMiku && oldMiku.dataset.mood === newMiku.dataset.mood) newMiku.replaceWith(oldMiku);
  box.replaceChildren(...tmp.childNodes);
}

function yenMood(pts){
  const first = pts[0].v, last = pts[pts.length - 1].v;
  const pct = (last - first) / first * 100;
  const th = YEN_RANGES[YEN.range][1];
  return { pct, mood: pct >= th ? 'happy' : pct <= -th ? 'sad' : 'calm' };
}
const yenNum = (v, d = 2) => v.toLocaleString('it-IT', { minimumFractionDigits: d, maximumFractionDigits: d });
const yenDate = (d, year) => new Date(d + 'T12:00:00').toLocaleDateString('it-IT', year ? { day: 'numeric', month: 'short', year: 'numeric' } : { day: 'numeric', month: 'short' });

function yenInner(){
  const pts = YEN.series[YEN.range];
  const chips = Object.entries(YEN_RANGES).map(([k, [label]]) =>
    `<button class="chip ${k === YEN.range ? 'active' : ''}" onclick="setYenRange('${k}')">${label}</button>`).join('');
  const head = `<div class="yen-head"><h4>Andamento dello yen <small>quanti yen compri con 1 €</small></h4><div class="recs-filter yen-ranges">${chips}</div></div>`;
  if (!pts){
    const msg = YEN.error ? `Cambio non disponibile ora (${escapeHtml(YEN.error)}): riprovo da solo più tardi.` : 'Carico il cambio…';
    return head + `<div class="yen-body">${mikuSvg('calm')}<p class="viz-empty">${msg}</p></div>${MIKU_CREDIT}`;
  }
  const { pct, mood } = yenMood(pts);
  const last = pts[pts.length - 1];
  const say = {
    happy: 'Lo yen è debole: i tuoi euro in Giappone valgono di più!',
    calm: 'Cambio stabile, niente di nuovo.',
    sad: 'Lo yen si è rafforzato: comprare dal Giappone costa di più.'
  }[mood];
  const checked = YEN.checkedAt ? new Date(YEN.checkedAt).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' }) : '';
  return head + `<div class="yen-body">
    ${mikuSvg(mood)}
    <div class="yen-main">
      <div class="yen-now">
        <span class="yen-rate">${yenNum(last.v)} ¥</span><span class="yen-per">per 1 €</span>
        <span class="yen-delta ${mood}">${pct >= 0 ? '▲' : '▼'} ${pct >= 0 ? '+' : ''}${yenNum(pct)}% <small>in ${YEN_RANGES[YEN.range][0]}</small></span>
      </div>
      <p class="yen-say">${say}</p>
      ${yenChart(pts)}
      <div class="yen-foot">100 ¥ = ${yenNum(100 / last.v)} € · dato BCE del ${yenDate(last.d, true)}${checked ? ` · controllato alle ${checked}` : ''}</div>
    </div>
  </div>`+ MIKU_CREDIT;
}

function yenChart(pts){
  const W = 600, H = 150;
  const vals = pts.map(p => p.v);
  let lo = Math.min(...vals), hi = Math.max(...vals);
  const pad = Math.max((hi - lo) * 0.12, 0.2);
  lo -= pad; hi += pad;
  const x = i => i / (pts.length - 1) * W;
  const y = v => H - (v - lo) / (hi - lo) * H;
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.v).toFixed(1)}`).join('');
  const step = W / (pts.length - 1);
  const year = YEN.range === '365';
  // una fascia invisibile per giorno: col mouse (o toccando) compare la riga verticale e il tooltip condiviso
  const hits = pts.map((p, i) => `<g class="yen-hit" data-tip="${yenDate(p.d, true)}: 1 € = ${yenNum(p.v)} ¥">
      <rect x="${(x(i) - step / 2).toFixed(1)}" y="0" width="${step.toFixed(1)}" height="${H}" fill="transparent"/>
      <line x1="${x(i).toFixed(1)}" x2="${x(i).toFixed(1)}" y1="0" y2="${H}" vector-effect="non-scaling-stroke"/></g>`).join('');
  return `<div class="yen-chart" role="img" aria-label="Cambio euro-yen dal ${yenDate(pts[0].d, true)} al ${yenDate(pts[pts.length - 1].d, true)}: da ${yenNum(pts[0].v)} a ${yenNum(pts[pts.length - 1].v)} yen per euro">
    <div class="yen-axis"><span>${yenNum(hi, 1)}</span><span>${yenNum((lo + hi) / 2, 1)}</span><span>${yenNum(lo, 1)}</span></div>
    <div class="yen-plot">
      <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
        <defs><linearGradient id="yenFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="var(--teal)" stop-opacity=".28"/><stop offset="1" stop-color="var(--teal)" stop-opacity="0"/></linearGradient></defs>
        <g class="yen-grid">${[0, H / 2, H].map(g => `<line x1="0" x2="${W}" y1="${g}" y2="${g}" vector-effect="non-scaling-stroke"/>`).join('')}</g>
        <path d="${line}L${W},${H}L0,${H}Z" fill="url(#yenFill)"/>
        <path class="yen-line" d="${line}" vector-effect="non-scaling-stroke"/>
        ${hits}
      </svg>
      <div class="yen-dates"><span>${yenDate(pts[0].d, year)}</span><span>${yenDate(pts[pts.length - 1].d, year)}</span></div>
    </div>
  </div>`;
}

// Miku: illustrazioni ufficiali di KEI da piapro.net (Crypton Future Media, licenza CC BY-NC 3.0, credito obbligatorio
// sotto il riquadro). File in miku/ accanto alla dashboard, sfondo reso trasparente da uno script in scratchpad.
// Le immagini sono ferme: il movimento è tutto CSS (nel browser, nessun carico sul server). Non esiste una Miku
// ufficiale triste, quindi "triste" è quella tranquilla con i colori spenti e una nuvoletta che le piove addosso.
const MIKU_IMG = { happy: 'miku/miku-felice.png', calm: 'miku/miku-calma.png', sad: 'miku/miku-calma.png' };
const MIKU_CREDIT = `<div class="yen-credit"><a href="https://piapro.net/intl/en_character.html" target="_blank" rel="noopener noreferrer">Hatsune Miku</a>
  by Crypton Future Media, INC. 2007 is licensed under a
  <a href="https://creativecommons.org/licenses/by-nc/3.0/" target="_blank" rel="noopener noreferrer">Creative Commons Attribution-NonCommercial 3.0 Unported License</a>.</div>`;
function mikuSvg(mood){
  const title = { happy: 'Miku è felice', calm: 'Miku è tranquilla', sad: 'Miku è triste' }[mood];
  const extra = {
    happy: `<g class="m-notes"><text x="4" y="40">♪</text><text x="118" y="22">♫</text><text x="126" y="84">♪</text><text x="0" y="96">♫</text></g>`,
    calm: '',
    sad: `<g class="m-cloud"><ellipse cx="62" cy="14" rx="24" ry="9"/><ellipse cx="48" cy="11" rx="12" ry="9"/><ellipse cx="74" cy="9" rx="13" ry="10"/>
            <path class="m-drop" d="M46 27 l-2 6 M56 29 l-2 6 M66 27 l-2 6 M76 29 l-2 6"/></g>`
  }[mood];
  return `<div class="yen-miku ${mood}" data-mood="${mood}" role="img" aria-label="${title}" title="${title}">
    <img class="m-fig" src="${MIKU_IMG[mood]}" alt="">
    ${extra ? `<svg class="m-fx" viewBox="0 0 150 190" aria-hidden="true">${extra}</svg>` : ''}
  </div>`;
}

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

// ---------- Tab: Amici ----------
// GET /friends dà solo chi usa la dashboard (id, nome, avatar); liste e attività arrivano dall'API pubblica
// di AniList. Chi ha la lista privata su AniList resta nell'elenco ma senza dati.
const FRIEND_LIST_QUERY = () => `query($u:Int){ MediaListCollection(userId:$u, type:${mediaType()}){ lists{ entries{
  mediaId status progress score(format:POINT_100) } } } }`;
const FEED_QUERY = () => `query($ids:[Int]){ Page(perPage:30){ activities(userId_in:$ids, type:${isManga() ? 'MANGA_LIST' : 'ANIME_LIST'}, sort:ID_DESC){
  ... on ListActivity{ id createdAt status progress user{ id } media{ id title{ english romaji native } coverImage{ medium } } } } } }`;
let FRIENDS = null;               // { me, friends:[{id,name,avatar,private}], byMedia:{mediaId:[{friend,status,progress,score}]} }
let FRIENDS_LOADING = null;

// liste di tutti gli amici, una richiesta per amico; usate sia dalla scheda Amici sia dai dettagli
function loadFriendLists(force){
  if (FRIENDS && !force) return Promise.resolve(FRIENDS);
  if (FRIENDS_LOADING) return FRIENDS_LOADING;
  FRIENDS_LOADING = (async () => {
    const info = await api('/friends');
    const byMedia = {}, lists = {};
    const toMap = d => Object.fromEntries(d.MediaListCollection.lists.flatMap(l => l.entries).map(e => [e.mediaId, e]));
    let mine = null;
    await Promise.all([
      // la mia lista (pubblica) per la compatibilità; se è privata la compatibilità non compare
      (async () => { try { if (info.me && info.me.id) mine = toMap(await anilistPublic(FRIEND_LIST_QUERY(), { u: info.me.id })); } catch (e) { mine = null; } })(),
      ...info.friends.map(async f => {
        try{
          const d = await anilistPublic(FRIEND_LIST_QUERY(), { u: f.id });
          lists[f.id] = toMap(d);
          d.MediaListCollection.lists.flatMap(l => l.entries).forEach(e => {
            (byMedia[e.mediaId] || (byMedia[e.mediaId] = [])).push({ friend: f, status: e.status, progress: e.progress, score: e.score });
          });
        }catch(err){ f.private = true; }
      })
    ]);
    return (FRIENDS = { me: info.me, friends: info.friends, requests: info.requests || [], sent: info.sent || [],
                       others: info.others || [], byMedia, lists, mine });
  })().finally(() => { FRIENDS_LOADING = null; });
  return FRIENDS_LOADING;
}

// ---------- Compatibilità con un amico ----------
// Sulle serie viste da entrambi (non "Da vedere"):
//  - voti vicini (se almeno 3 serie votate da tutti e due): 35 punti su 100 di differenza media = nessuna affinità;
//  - quante serie in comune rispetto alla lista più corta;
//  - stesso destino: non è che uno l'ha droppata e l'altro no.
// Con pochi voti la percentuale è "stimata" solo dalle ultime due (servono almeno 5 serie in comune).
function compatWith(fid){
  const fr = FRIENDS;
  if (!fr || !fr.mine || !fr.lists || !fr.lists[fid]) return null;
  const A = fr.mine, B = fr.lists[fid];
  const seen = e => e && e.status !== 'PLANNING';
  const nA = Object.values(A).filter(seen).length, nB = Object.values(B).filter(seen).length;
  let shared = 0, sameFate = 0;
  const pairs = [];
  for (const id of Object.keys(B)){
    if (!seen(A[id]) || !seen(B[id])) continue;
    shared++;
    if ((A[id].status === 'DROPPED') === (B[id].status === 'DROPPED')) sameFate++;
    if (A[id].score > 0 && B[id].score > 0) pairs.push({ id: Number(id), me: A[id].score, them: B[id].score });
  }
  const base = { shared, pairs, estimated: pairs.length < 3 };
  if (shared < 5 && pairs.length < 3) return Object.assign(base, { pct: null });
  const overlap = Math.min(1, shared / Math.max(1, Math.min(nA, nB)));
  const fate = shared ? sameFate / shared : 1;
  let pct;
  if (pairs.length >= 3){
    const mad = pairs.reduce((t, p) => t + Math.abs(p.me - p.them), 0) / pairs.length;
    pct = 0.6 * Math.max(0, 1 - mad / 35) + 0.25 * overlap + 0.15 * fate;
  } else pct = 0.7 * overlap + 0.3 * fate;
  return Object.assign(base, { pct: Math.round(100 * pct), nA, nB });
}
function compatBadge(fid){
  const c = compatWith(fid);
  return c && c.pct != null ? `<small class="compat" title="Compatibilità dei gusti">${c.pct}%</small>` : '';
}
// nel profilo di un amico: percentuale, dove siete d'accordo e cosa ha amato che tu non hai visto
function renderCompatSection(data){
  const u = data.User;
  const c = compatWith(u.id);
  if (!c || isManga()) return '';        // il profilo mostra le liste anime: in modalità manga non si confronta
  const entries = ((data.lists && data.lists.lists) || []).flatMap(l => l.entries).filter(e => e.media);
  const media = Object.fromEntries(entries.map(e => [e.media.id, e.media]));
  const mine = FRIENDS.mine;
  let html = `<h4>Compatibilità con te</h4>`;
  if (c.pct == null){
    html += `<p class="hint">Avete solo ${c.shared} serie in comune: troppo poche per dirlo.</p>`;
  } else {
    const agree = c.pairs.filter(p => media[p.id] && Math.abs(p.me - p.them) <= 10 && p.me >= 70).sort((a, b) => (b.me + b.them) - (a.me + a.them)).slice(0, 3);
    const clash = c.pairs.filter(p => media[p.id] && Math.abs(p.me - p.them) >= 30).sort((a, b) => Math.abs(b.me - b.them) - Math.abs(a.me - a.them)).slice(0, 2);
    html += `<div class="compat-box"><div class="compat-pct">${c.pct}%</div>
      <div><div class="bar"><i style="width:${c.pct}%"></i></div>
      <small>${c.shared} serie viste da entrambi${c.estimated ? ' · stimata: pochi voti in comune, conta soprattutto quante serie condividete' : `, ${c.pairs.length} votate da tutti e due`}</small></div></div>`;
    if (agree.length) html += `<p class="compat-line">👍 D'accordo su ${agree.map(p => `<b>${escapeHtml(animeTitle(media[p.id]))}</b>`).join(', ')}</p>`;
    if (clash.length) html += `<p class="compat-line">⚔️ Non d'accordo su ${clash.map(p => `<b>${escapeHtml(animeTitle(media[p.id]))}</b> (tu ${fmtScore(p.me)}, ${escapeHtml(u.name)} ${fmtScore(p.them)})`).join(', ')}</p>`;
  }
  // finite dall'amico (senza voto o con voto alto, prima le più votate) che tu non hai ancora visto
  const loves = entries.filter(e => e.status === 'COMPLETED' && (!e.score || e.score >= 75) && (!mine[e.media.id] || mine[e.media.id].status === 'PLANNING'))
    .sort((a, b) => (b.score || 0) - (a.score || 0)).slice(0, 8);
  if (loves.length) html += `<h4>Da ${escapeHtml(u.name)} per te</h4><p class="hint">Le ha finite (prima quelle con il voto più alto) e tu non le hai ancora viste.</p>${friendAnimeGrid(loves, { score: true })}`;
  return html;
}

// azioni sulla scheda Amici: richiedi/accetta/rifiuta/annulla/rimuovi, poi ricarica la scheda
async function friendAction(path, id, btn){
  btn.disabled = true;
  try{
    await api(path, { method:'POST', body: JSON.stringify({ id }) });
    FRIENDS = null;
    loadTab('friends', true);
  }catch(err){ btn.disabled = false; showToast('Errore: ' + err.message, 'error'); }
}
function sendFriendRequest(id, btn){ friendAction('/friends/request', id, btn); }
function acceptFriendRequest(id, btn){ friendAction('/friends/accept', id, btn); }
function declineFriendRequest(id, btn){ friendAction('/friends/remove', id, btn); }
function cancelFriendRequest(id, btn){ friendAction('/friends/remove', id, btn); }
function removeFriend(id, btn){
  if (!confirm('Rimuovere questo amico? Potrai sempre rimandare una richiesta in futuro.')) return;
  friendAction('/friends/remove', id, btn);
}

// ---------- Profilo di un utente (scheda a comparsa, dati pubblici AniList) ----------
const FRIEND_PROFILE_QUERY = `query($id:Int){
  User(id:$id){
    id name siteUrl
    avatar{ large }
    bannerImage
    about(asHtml:false)
    statistics{ anime{ count episodesWatched meanScore genres(limit:6, sort:COUNT_DESC){ genre count } } }
    favourites{ anime(perPage:12){ nodes{ id title{english romaji native} coverImage{medium} } } }
  }
  lists: MediaListCollection(userId:$id, type:ANIME, status_in:[CURRENT,COMPLETED]){
    lists{ entries{ status progress score(format:POINT_100) media{ id title{english romaji native} coverImage{medium} episodes } } }
  }
}`;
const friendProfileCache = {};
let FRIEND_PROFILE_SEQ = 0;

let MODAL_Z = 50;   // chi si apre per ultimo va sopra, che sia il profilo amico o la scheda anime
function syncBodyScroll(){
  const open = $('#detailBack').classList.contains('show') || Boolean($('#friendBack')?.classList.contains('show'))
    || Boolean($('#crImportBack')?.classList.contains('show')) || Boolean($('#wrappedBack')?.classList.contains('show'));
  const body = $('#appBody');       // è questa la parte che scorre davvero (l'header resta fisso): va bloccata mentre c'è un modale sopra
  if (body) body.style.overflow = open ? 'hidden' : '';
  // Mini App: la freccia "indietro" di Telegram chiude il modale aperto (come Esc) invece di chiudere la dashboard
  if (TG && TG.BackButton) try { open ? TG.BackButton.show() : TG.BackButton.hide(); } catch (e) {}
}
if (TG && TG.BackButton) try {
  TG.BackButton.onClick(() => {
    if ($('#wrappedBack')?.classList.contains('show')) closeWrapped();
    else if ($('#detailBack').classList.contains('show') && DETAIL_STACK.length) detailGoBack();
    else if ($('#crImportBack')?.classList.contains('show')) crCloseImport();
    else { closeFriendProfile(); closeDetails(); }
  });
} catch (e) {}
function friendProfileNav(){ return `<button class="detail-close" onclick="closeFriendProfile()" title="Chiudi">×</button>`; }
function closeFriendProfile(){
  if (!$('#friendBack')?.classList.contains('show')) return;
  $('#friendBack').classList.remove('show');
  syncBodyScroll();
}

async function openFriendProfile(id){
  const back = $('#friendBack'), box = $('#friendBox');
  if (!back || !box){ showToast('Pagina non aggiornata: ricarica con Ctrl+F5.', 'error'); return; }
  const seq = ++FRIEND_PROFILE_SEQ;
  back.classList.add('show');
  back.style.zIndex = ++MODAL_Z;
  syncBodyScroll();
  box.scrollTop = 0;
  if (!friendProfileCache[id]){
    box.innerHTML = friendProfileNav() + '<div class="detail-body"><div class="loading">Carico il profilo…</div></div>';
    try{
      const data = await anilistPublic(FRIEND_PROFILE_QUERY, { id });
      if (!data.User) throw new Error('profilo non trovato');
      friendProfileCache[id] = data;
    }catch(err){
      if (seq !== FRIEND_PROFILE_SEQ) return;
      box.innerHTML = friendProfileNav() + `<div class="detail-body">${emptyState('Impossibile caricare il profilo: ' + err.message)}</div>`;
      return;
    }
  }
  if (!back.classList.contains('show') || seq !== FRIEND_PROFILE_SEQ) return;
  box.innerHTML = renderFriendProfile(friendProfileCache[id]);
  renderTogether(id);
}

function friendAnimeGrid(list, opts={}){
  return `<div class="rel-grid">${list.map(x => {
    const m = x.media || x;
    const t = animeTitle(m);
    const sub = [opts.score && x.score ? `★ ${fmtScore(x.score)}/10` : null,
                 opts.progress ? `ep. ${x.progress || 0}${m.episodes ? '/' + m.episodes : ''}` : null].filter(Boolean).join(' · ');
    return `<button class="rel" onclick="openDetails(${m.id})">${coverImg(m.coverImage && m.coverImage.medium, t)}
      <div class="meta"><div class="t">${escapeHtml(t)}</div>${sub ? `<div class="sub">${escapeHtml(sub)}</div>` : ''}</div></button>`;
  }).join('')}</div>`;
}

function renderFriendProfile(data){
  const u = data.User;
  const about = cleanSynopsis(u.about || '');
  const stats = (u.statistics && u.statistics.anime) || {};
  const genres = (stats.genres || []).slice(0, 6);
  const favs = ((u.favourites && u.favourites.anime && u.favourites.anime.nodes) || []).filter(Boolean);
  const entries = ((data.lists && data.lists.lists) || []).flatMap(l => l.entries).filter(e => e.media);
  const watching = entries.filter(e => e.status === 'CURRENT').slice(0, 12);
  const topRated = entries.filter(e => e.status === 'COMPLETED' && e.score).sort((a, b) => b.score - a.score).slice(0, 10);

  return `
    ${friendProfileNav()}
    ${u.bannerImage ? `<div class="detail-banner" style="background-image:url('${escapeAttr(u.bannerImage)}')"></div>` : ''}
    <div class="detail-head">
      ${u.avatar && u.avatar.large ? `<img class="avatar-lg" src="${escapeAttr(u.avatar.large)}" alt="">` : `<div class="avatar-lg"></div>`}
      <div class="meta" style="padding-top:${u.bannerImage ? '6px' : '0'}">
        <h2>${escapeHtml(u.name)}</h2>
        ${genres.length ? `<div class="chips">${genres.map(g => `<span class="chip">${escapeHtml(IT.genre[g.genre] || g.genre)}<small>${g.count}</small></span>`).join('')}</div>` : ''}
      </div>
    </div>
    <div class="detail-body">
      <div class="facts">
        ${stats.count != null ? `<div><span>Serie viste</span>${stats.count}</div>` : ''}
        ${stats.episodesWatched != null ? `<div><span>Episodi</span>${stats.episodesWatched}</div>` : ''}
        ${stats.meanScore ? `<div><span>Voto medio</span>${fmtScore(stats.meanScore)}/10</div>` : ''}
      </div>
      ${renderCompatSection(data)}
      ${isManga() ? '' : '<div id="togetherBox"></div>'}
      ${about ? `<h4>Bio</h4><div class="synopsis">${escapeHtml(about)}</div>` : ''}
      ${favs.length ? `<h4>Preferiti</h4>${friendAnimeGrid(favs)}` : ''}
      ${watching.length ? `<h4>Sta guardando</h4>${friendAnimeGrid(watching, { progress:true })}` : ''}
      ${topRated.length ? `<h4>Voti più alti</h4>${friendAnimeGrid(topRated, { score:true })}` : ''}
      <div style="margin-top:20px;font-size:13px;"><a href="${escapeAttr(u.siteUrl)}" target="_blank" rel="noopener">Apri su AniList ↗</a></div>
    </div>`;
}
// bottone avatar+nome cliccabile, riusato in tutte le liste di utenti della scheda Amici;
// ferma la propagazione perché a volte sta dentro una card che ha già il suo onclick (apre l'anime)
function friendUserBtn(f){
  return `<button class="fr-user" onclick="event.stopPropagation(); openFriendProfile(${f.id})">${friendAvatar(f)}<span class="n">${escapeHtml(f.name)}</span></button>`;
}

async function loadFriends(){
  const fr = await loadFriendLists(true);
  let feed = [], feedError = null;
  const ids = fr.friends.filter(f => !f.private).map(f => f.id);
  if (ids.length){
    try{ feed = (await anilistPublic(FEED_QUERY(), { ids })).Page.activities.filter(a => a && a.media); }
    catch(err){ feedError = err.message; }
  }
  await ensureLists(['planning']);
  let recs = null;
  try {
    recs = await api('/recommendations');
    const mids = [...new Set([...(recs.received || []), ...(recs.sent || [])].map(r => r.mediaId))].slice(0, 50);
    recs.media = {};
    if (mids.length){
      const d = await anilistPublic(`query($ids:[Int]){ Page(perPage:50){ media(id_in:$ids){ id type title{english romaji native} coverImage{medium} format seasonYear episodes } } }`, { ids: mids });
      (d.Page.media || []).forEach(m => { recs.media[m.id] = m; });
    }
  } catch (e) { recs = null; }
  return { feed, feedError, recs };
}

function friendAvatar(f){
  return f.avatar ? `<img class="av" src="${escapeAttr(f.avatar)}" alt="" loading="lazy" decoding="async">` : `<span class="av"></span>`;
}

function friendStatusText(x){
  const s = (LIST_LABELS[x.status] || { label: x.status }).label;
  const ep = x.progress && (x.status === 'CURRENT' || x.status === 'REPEATING' || x.status === 'PAUSED' || x.status === 'DROPPED') ? ` · ep. ${x.progress}` : '';
  return s + ep;
}

// ---------- Chi è più avanti ----------
// Solo se tutti e due la state guardando (in corso, rewatch o in pausa): differenza di episodi/capitoli.
const WATCHING = ['CURRENT', 'REPEATING', 'PAUSED'];
function aheadInfo(mine, theirs){
  if (!mine || !theirs || !WATCHING.includes(mine.status) || !WATCHING.includes(theirs.status)) return null;
  const d = (theirs.progress || 0) - (mine.progress || 0);
  const u = n => n === 1 ? W().unit : W().units;
  if (d === 0) return { cls: 'even', txt: 'in pari con te' };
  return d > 0 ? { cls: 'ahead', txt: `${d} ${u(d)} avanti a te` } : { cls: 'behind', txt: `${-d} ${u(-d)} dietro di te` };
}
function aheadBadge(mine, theirs){
  const a = aheadInfo(mine, theirs);
  return a ? `<span class="ahead-badge ${a.cls}">${escapeHtml(a.txt)}</span>` : '';
}

function friendRows(list, mine){
  return `<div class="fr-list">${list.map(x => `
    <div class="fr-row">${friendUserBtn(x.friend)}
      <span class="st">${escapeHtml(friendStatusText(x))}</span>
      ${x.score ? `<span class="sc">★ ${fmtScore(x.score)}/10</span>` : ''}
      ${aheadBadge(mine, x)}</div>`).join('')}</div>`;
}

// ---------- Cosa guardare insieme (profilo di un amico) ----------
// Serie che state guardando tutti e due (prima quelle dove siete più vicini), quelle nei "Da vedere" di entrambi
// (prima quelle già uscite) e quelle che l'amico sta guardando mentre tu le hai in "Da vedere".
function togetherGrid(items){
  return `<div class="rel-grid">${items.map(({ m, sub, badge }) => {
    const t = animeTitle(m);
    return `<button class="rel" onclick="openDetails(${m.id})">${coverImg(m.coverImage && m.coverImage.medium, t)}
      <div class="meta"><div class="t">${escapeHtml(t)}</div>${sub ? `<div class="sub">${escapeHtml(sub)}</div>` : ''}${badge || ''}</div></button>`;
  }).join('')}</div>`;
}
async function renderTogether(fid){
  if (isManga() || !$('#togetherBox')) return;
  try { await loadFriendLists(); } catch (e) { return; }
  const el = $('#togetherBox');
  const fr = FRIENDS;
  if (!el || !fr || !fr.mine || !fr.lists || !fr.lists[fid]) return;
  const A = fr.mine, B = fr.lists[fid];
  const name = (fr.friends.find(f => f.id === fid) || {}).name || 'il tuo amico';
  const ids = Object.keys(B).filter(id => A[id]);
  const active = s => s === 'CURRENT' || s === 'REPEATING';
  const watching = ids.filter(id => active(A[id].status) && active(B[id].status));
  const plan = ids.filter(id => A[id].status === 'PLANNING' && B[id].status === 'PLANNING');
  const join = ids.filter(id => A[id].status === 'PLANNING' && active(B[id].status));
  const all = [...new Set([...watching, ...join, ...plan])].map(Number).slice(0, 50);
  if (!all.length){ el.innerHTML = ''; return; }
  el.innerHTML = `<h4>Cosa guardare insieme</h4><div class="loading">Cerco le serie in comune…</div>`;
  const media = {};
  try {
    const d = await anilistPublic(`query($ids:[Int]){ Page(perPage:50){ media(id_in:$ids){ id title{english romaji native} coverImage{medium} episodes status } } }`, { ids: all });
    (d.Page.media || []).forEach(m => { media[m.id] = m; });
  } catch (e){ el.innerHTML = ''; return; }
  if (!$('#togetherBox')) return;
  const ep = n => `ep. ${n || 0}`;
  let html = '';
  const w = watching.filter(id => media[id])
    .sort((a, b) => Math.abs((A[a].progress || 0) - (B[a].progress || 0)) - Math.abs((A[b].progress || 0) - (B[b].progress || 0)));
  if (w.length) html += `<h4>Le state guardando tutti e due</h4>${togetherGrid(w.map(id => ({ m: media[id],
    sub: `tu ${ep(A[id].progress)} · ${name} ${ep(B[id].progress)}`, badge: aheadBadge(A[id], B[id]) })))}`;
  const j = join.filter(id => media[id]);
  if (j.length) html += `<h4>${escapeHtml(name)} le sta guardando, tu le hai in "Da vedere"</h4>${togetherGrid(j.map(id => ({ m: media[id],
    sub: `${name} è all'episodio ${B[id].progress || 0}` })))}`;
  const released = m => m.status === 'RELEASING' || m.status === 'FINISHED' ? 0 : 1;
  const p = plan.filter(id => media[id]).sort((a, b) => released(media[a]) - released(media[b]));
  if (p.length) html += `<h4>Nei "Da vedere" di tutti e due</h4><p class="hint">Buone per iniziarle insieme.</p>${togetherGrid(p.map(id => ({ m: media[id],
    sub: media[id].status === 'NOT_YET_RELEASED' ? 'non ancora uscita' : (media[id].episodes ? media[id].episodes + ' ep.' : '') })))}`;
  el.innerHTML = html;
}

const ACTIVITY_IT = {
  'watched episode':'ha visto', 'rewatched episode':'ha rivisto', 'completed':'ha finito', 'rewatched':'ha rivisto tutto',
  'plans to watch':'vuole vedere', 'dropped':'ha droppato', 'paused watching':'ha messo in pausa'
};
function relTime(sec){
  const d = Date.now() / 1000 - sec;
  if (d < 3600) return Math.max(1, Math.round(d / 60)) + ' min fa';
  if (d < 86400) return Math.round(d / 3600) + ' h fa';
  if (d < 86400 * 7) return Math.round(d / 86400) + ' g fa';
  return new Date(sec * 1000).toLocaleDateString('it-IT', { day:'numeric', month:'short' });
}

// richieste ricevute/inviate, in cima alla scheda Amici
function renderFriendRequests(fr){
  let html = '';
  if (fr.requests.length){
    html += `<div class="panel-title">Richieste ricevute</div><div class="fr-list">${fr.requests.map(f => `
      <div class="fr-row">${friendUserBtn(f)}
        <button class="pill positive" onclick="acceptFriendRequest(${f.id}, this)">Accetta</button>
        <button class="pill danger" onclick="declineFriendRequest(${f.id}, this)">Rifiuta</button></div>`).join('')}</div>`;
  }
  if (fr.sent.length){
    html += `<div class="panel-title">Richieste inviate</div><div class="fr-list">${fr.sent.map(f => `
      <div class="fr-row">${friendUserBtn(f)}
        <span class="st">in attesa</span>
        <button class="pill danger" onclick="cancelFriendRequest(${f.id}, this)">Annulla</button></div>`).join('')}</div>`;
  }
  return html;
}

// registrati senza alcun rapporto con me: candidati a cui mandare una richiesta
// ---------- Aggiungere un amico: codice personale, link d'invito o nome AniList esatto ----------
// Non c'è più l'elenco di tutti i registrati: ognuno vede solo i propri amici e le richieste.
function friendInviteUrl(){ return location.origin + location.pathname + '?amico=' + encodeURIComponent(FRIENDS.me.code); }
async function copyText(t, msg){
  try { await navigator.clipboard.writeText(t); showToast(msg || 'Copiato.', 'ok'); }
  catch (e) { window.prompt('Copia da qui:', t); }
}
function copyFriendCode(){ copyText(FRIENDS.me.code, 'Codice copiato.'); }
async function shareFriendLink(){
  const url = friendInviteUrl();
  if (navigator.share){
    try { await navigator.share({ title: 'Libreria Anime', text: 'Aggiungimi come amico sulla Libreria Anime:', url }); return; }
    catch (e) { if (e.name === 'AbortError') return; }
  }
  copyText(url, 'Link d\'invito copiato: mandalo a chi vuoi aggiungere.');
}
const FRIEND_REQ_ERRORS = { not_found: 'Nessun utente con questo codice o nome AniList.', self: 'Questo sei tu 🙂' };
async function sendFriendReq(body, btn){
  if (btn) btn.disabled = true;
  try {
    const r = await api('/friends/request', { method: 'POST', body: JSON.stringify(body) });
    if (!r.ok){ showToast(FRIEND_REQ_ERRORS[r.error] || 'Richiesta non riuscita.', 'error'); return false; }
    showToast(r.status === 'accepted' ? `Tu e ${r.name} ora siete amici!` : `Richiesta di amicizia inviata a ${r.name}.`, 'ok');
    FRIENDS = null;
    loadTab('friends', true);
    return true;
  } catch (err){ showToast('Errore: ' + err.message, 'error'); return false; }
  finally { if (btn) btn.disabled = false; }
}
function addFriendByInput(ev){
  ev.preventDefault();
  const v = $('#frAddInput').value.trim();
  if (v) sendFriendReq({ code: v, name: v }, ev.submitter || null);
}
// link d'invito ?amico=CODICE: la richiesta parte da sola appena si è entrati
async function acceptPendingInvite(){
  let c = null;
  try { c = sessionStorage.getItem('friendInvite'); sessionStorage.removeItem('friendInvite'); } catch (e) {}
  if (c) await sendFriendReq({ code: c });
}

function renderAddFriends(fr){
  const code = fr.me && fr.me.code;
  return `<section class="fr-card">
    <div class="fr-card-h">Aggiungi un amico</div>
    <p class="hint">Manda il tuo codice o il link d'invito a chi vuoi aggiungere, oppure scrivi qui il suo codice o il suo nome AniList.</p>
    ${code ? `<div class="fr-code"><span>Il tuo codice</span><b>${escapeHtml(code)}</b>
      <button class="pill" onclick="copyFriendCode()">Copia</button>
      <button class="pill positive" onclick="shareFriendLink()">🔗 Link d'invito</button></div>` : ''}
    <form class="fr-add" onsubmit="addFriendByInput(event)">
      <input id="frAddInput" placeholder="Codice amico o nome AniList" maxlength="30" autocomplete="off" autocapitalize="off" spellcheck="false">
      <button class="btn" type="submit">Invia richiesta</button>
    </form>
  </section>`;
}

function friendPersonRow(f){
  const c = compatWith(f.id);
  const pct = c && c.pct != null ? c.pct : null;
  return `<div class="fr-person${f.private ? ' private' : ''}">
    <button class="fr-person-main" onclick="openFriendProfile(${f.id})" title="Vedi profilo">
      ${friendAvatar(f)}
      <span class="n">${escapeHtml(f.name)}${f.private ? ' 🔒' : ''}</span>
      ${pct != null ? `<span class="fr-compat" title="Compatibilità dei gusti${c.estimated ? ' (stimata)' : ''}"><i style="width:${pct}%"></i></span><small>${pct}%</small>` : ''}
    </button>
    <button class="chip-x" title="Rimuovi amico" onclick="removeFriend(${f.id}, this)">×</button>
  </div>`;
}

function renderFriends(data){
  const fr = FRIENDS;
  if (!fr) return emptyState('Impossibile caricare gli amici.');
  const byId = Object.fromEntries(fr.friends.map(f => [f.id, f]));
  let html = renderFriendRequests(fr) + renderReceivedRecs(data.recs);

  html += `<div class="friends-top">
    <section class="fr-card">
      <div class="fr-card-h">I tuoi amici <small>${fr.friends.length || ''}</small></div>
      ${fr.friends.length ? `<div class="fr-people">${fr.friends.map(friendPersonRow).join('')}</div>`
        : `<p class="hint">Non hai ancora amici: manda il tuo codice o il link d'invito a chi vuoi aggiungere.</p>`}
    </section>
    ${renderAddFriends(fr)}
  </div>`;
  if (IS_ADMIN){ html += `<div id="adminUsers"></div>`; setTimeout(loadAdminUsers, 0); }
  if (!fr.friends.length) return html;

  // la mia lista "Da vedere" vista dagli amici: prima quelle che più amici hanno già visto o vogliono vedere
  const plan = ((cache.planning && cache.planning.items) || [])
    .map(it => ({ it, fr: fr.byMedia[it.id] || [] }))
    .filter(x => x.fr.length)
    .sort((a, b) => b.fr.length - a.fr.length);
  html += `<div class="panel-title">La tua lista "Da vedere", secondo gli amici</div>`;
  html += plan.length ? `<div class="grid">${plan.map(({ it, fr: list }) => `
    <div class="card simple-card">
      <div class="cover-row clickable" role="button" tabindex="0" onclick="openDetails(${it.id})">
        ${coverImg(it.cover, animeTitle(it))}
        <div class="meta">
          <h3>${escapeHtml(animeTitle(it))}</h3>
          ${friendRows(list)}
        </div>
      </div>
    </div>`).join('')}</div>`
    : emptyState('Nessuna serie della tua lista "Da vedere" è nelle liste degli amici.');

  html += `<div class="panel-title">Attività recenti</div>`;
  if (data.feedError) html += emptyState('Impossibile leggere le attività: ' + data.feedError);
  else if (!data.feed.length) html += emptyState('Ancora nessuna attività.');
  else html += `<div class="feed">${data.feed.map(a => {
    const f = byId[a.user.id] || { name: '?' };
    const t = animeTitle(a.media);
    const verb = ACTIVITY_IT[a.status] || a.status;
    const ep = a.progress && /episode/.test(a.status) ? ` l'episodio ${escapeHtml(String(a.progress).replace(' - ', '–'))} di` : '';
    const open = f.id ? ` role="button" tabindex="0" onclick="event.stopPropagation(); openFriendProfile(${f.id})"` : '';
    // tutto su una riga di testo (niente pulsanti dentro la frase): nome, verbo e titolo restano allineati
    return `<div class="feed-item" role="button" tabindex="0" onclick="openDetails(${a.media.id})">
      <span class="feed-av"${open}>${friendAvatar(f)}</span>
      <div class="txt"><span class="who"${open}>${escapeHtml(f.name)}</span> ${escapeHtml(verb)}${ep} <b>${escapeHtml(t)}</b>
        <span class="when">${relTime(a.createdAt)}</span></div>
      ${coverImg(a.media.coverImage && a.media.coverImage.medium, t)}
    </div>`;
  }).join('')}</div>`;
  return html;
}

// ---------- Utenti autorizzati (solo amministratori; il server ricontrolla) ----------
const ADMIN_ERRORS = { forbidden: 'Non sei amministratore.', bad_name: 'Nome AniList non valido.', admin: 'Un amministratore non si può togliere.', bad_action: 'Azione non valida.' };
async function loadAdminUsers(){
  const el = $('#adminUsers');
  if (!el) return;
  el.innerHTML = `<section class="fr-card admin-card"><div class="fr-card-h">👑 Utenti autorizzati</div><div class="loading">Carico…</div></section>`;
  let d;
  try { d = await api('/admin/users'); }
  catch (err){ el.innerHTML = `<section class="fr-card admin-card"><div class="fr-card-h">👑 Utenti autorizzati</div><p class="hint">Non disponibile: ${escapeHtml(err.message)}</p></section>`; return; }
  if (!$('#adminUsers')) return;
  if (d.error){ el.remove(); return; }
  const users = d.users || [];
  const badge = (txt, cls = '') => `<span class="adm-badge ${cls}">${txt}</span>`;
  el.innerHTML = `<section class="fr-card admin-card">
    <div class="fr-card-h">👑 Utenti autorizzati <small>${users.filter(u => u.allowed).length} · visibile solo a te</small></div>
    <p class="hint">Chi è qui può entrare nella dashboard e usare i bot. Togliendo l'accesso lo disconnetti dal sito e dai bot; le sue amicizie restano, se lo riattivi le ritrova.</p>
    <form class="fr-add" onsubmit="adminAddUser(event)">
      <input id="admAddInput" placeholder="Nome AniList da autorizzare" maxlength="20" autocomplete="off" autocapitalize="off" spellcheck="false">
      <button class="btn" type="submit">Autorizza</button>
    </form>
    <div class="adm-list">${users.map(u => `
      <div class="adm-row${u.allowed ? '' : ' off'}">
        ${u.avatar ? `<img class="av" src="${escapeAttr(u.avatar)}" alt="" loading="lazy" decoding="async">` : '<span class="av"></span>'}
        <div class="adm-main">
          <div class="n">${escapeHtml(u.display || u.name)}${u.admin ? ' 👑' : ''}</div>
          <div class="adm-badges">
            ${u.registered ? badge('registrato', 'ok') : badge('non ancora entrato')}
            ${u.telegram ? badge('Telegram') : ''}
            ${u.override === 'allow' && !u.env ? badge('aggiunto dal sito') : ''}
            ${u.env ? badge('lista iniziale') : ''}
            ${!u.allowed ? badge('accesso tolto', 'no') : ''}
          </div>
        </div>
        ${u.admin ? '' : u.allowed
          ? `<button class="pill danger" onclick="adminUserAction('${escapeAttr(u.name)}', 'remove', this)">Togli accesso</button>`
          : `<button class="pill positive" onclick="adminUserAction('${escapeAttr(u.name)}', 'add', this)">Riattiva</button>`}
      </div>`).join('')}</div>
  </section>`;
}
async function adminUserAction(name, action, btn){
  if (action === 'remove' && !confirm(`Togliere l'accesso a ${name}?\nVerrà disconnesso dalla dashboard e dai bot. Le amicizie restano.`)) return;
  if (btn) btn.disabled = true;
  try {
    const r = await api('/admin/users', { method: 'POST', body: JSON.stringify({ action, name }) });
    if (!r.ok) showToast(ADMIN_ERRORS[r.error] || 'Operazione non riuscita.', 'error');
    else showToast(action === 'add' ? `${r.name} può entrare.` : `Accesso tolto a ${r.name}.`, 'ok');
  } catch (err){ showToast('Errore: ' + err.message, 'error'); }
  if (btn) btn.disabled = false;
  loadAdminUsers();
}
function adminAddUser(ev){
  ev.preventDefault();
  const v = $('#admAddInput').value.trim().replace(/^@/, '');
  if (v) adminUserAction(v, 'add', ev.submitter || null);
}

// ---------- Consiglia a un amico ----------
// POST /recommend: il consiglio arriva sul bot Telegram (e in #notifiche su Discord per chi le ha attive) con
// "➕ Da vedere" e "📋 Scheda"; nella dashboard dell'amico compare in "Consigliati a te" (scheda Amici).
function recommendBack(){
  let back = $('#recBack');
  if (!back){
    back = document.createElement('div');
    back.id = 'recBack';
    back.className = 'modal-back';
    back.innerHTML = '<div class="modal rec-modal" id="recBox"></div>';
    back.addEventListener('click', e => { if (e.target === back) closeRecommend(); });
    document.body.appendChild(back);
  }
  return back;
}
function closeRecommend(){ const b = $('#recBack'); if (b) b.classList.remove('show'); }
async function openRecommend(id){
  const back = recommendBack();
  back.style.zIndex = ++MODAL_Z;
  back.classList.add('show');
  const box = $('#recBox');
  box.innerHTML = '<div class="loading">Carico gli amici…</div>';
  let fr;
  try { fr = await loadFriendLists(); } catch (e) { box.innerHTML = '<p class="hint">Amici non disponibili.</p>'; return; }
  const m = (DETAIL && DETAIL.id === id && DETAIL.m) || detailCache[id] || { id, title: {} };
  const title = animeTitle(m) || 'questa serie';
  const has = Object.fromEntries((fr.byMedia[id] || []).map(x => [x.friend.id, x]));
  box.innerHTML = `<button class="detail-close" onclick="closeRecommend()" title="Chiudi">×</button>
    <h2>💌 Consiglia ${escapeHtml(title)}</h2>
    ${fr.friends.length ? `<p class="hint">Arriva sul bot Telegram (e su Discord a chi ha le notifiche lì), con il pulsante per aggiungerla a "Da vedere".</p>
    <div class="rec-friends">${fr.friends.map(f => {
      const h = has[f.id];
      return `<label class="rec-friend"><input type="checkbox" value="${f.id}" ${h ? '' : 'checked'}>
        ${friendAvatar(f)}<span class="n">${escapeHtml(f.name)}</span>
        ${h ? `<small>ce l'ha già: ${escapeHtml(friendStatusText(h))}</small>` : ''}</label>`;
    }).join('')}</div>
    <textarea id="recMsg" maxlength="200" rows="3" placeholder="Due parole sul perché (facoltativo)"></textarea>
    <div class="modal-actions"><button class="btn ghost" onclick="closeRecommend()">Annulla</button>
      <button class="btn" onclick="sendRecommend(${id}, this)">Invia</button></div>`
    : '<p class="hint">Non hai ancora amici a cui consigliarla: aggiungine uno dalla scheda Amici.</p>'}`;
}
async function sendRecommend(id, btn){
  const to = $$('#recBox .rec-friend input:checked').map(i => Number(i.value));
  if (!to.length){ showToast('Scegli almeno un amico.', 'error'); return; }
  btn.disabled = true;
  try {
    const r = await api('/recommend', { method: 'POST', body: JSON.stringify({ mediaId: id, to, msg: $('#recMsg').value }) });
    if (!r.ok) showToast({ too_many: 'Hai mandato troppi consigli oggi, riprova domani.', no_friends: 'Nessuno degli amici scelti può riceverlo.' }[r.error] || 'Consiglio non inviato.', 'error');
    else { showToast(r.count === 1 ? 'Consiglio inviato 💌' : `Consiglio inviato a ${r.count} amici 💌`, 'ok'); closeRecommend(); }
  } catch (err){ showToast('Errore: ' + err.message, 'error'); }
  btn.disabled = false;
}
// scheda Amici: consigli ricevuti (da aggiungere a "Da vedere" o da ignorare)
function renderReceivedRecs(recs){
  if (!recs || !(recs.received || []).length) return '';
  const mine = (FRIENDS && FRIENDS.mine) || {};
  return `<div class="panel-title">💌 Consigliati a te</div><div class="rec-list">${recs.received.map(r => {
    const m = recs.media[r.mediaId] || { id: r.mediaId, title: {} };
    const t = animeTitle(m) || 'Serie';
    const e = mine[r.mediaId];
    return `<div class="rec-item" role="button" tabindex="0" onclick="openDetails(${r.mediaId})">
      ${coverImg(m.coverImage && m.coverImage.medium, t)}
      <div class="txt">
        <div class="t">${escapeHtml(t)}</div>
        <div class="who">da <b>${escapeHtml(r.from.name)}</b> · ${relTime(r.ts / 1000)}</div>
        ${r.msg ? `<div class="msg">“${escapeHtml(r.msg)}”</div>` : ''}
      </div>
      <div class="rec-actions" onclick="event.stopPropagation()">
        ${e ? `<span class="rec-st">${escapeHtml((LIST_LABELS[e.status] || { label: e.status }).label)}</span>`
            : `<button class="pill positive" onclick="recToPlanning(${r.mediaId}, this)">➕ Da vedere</button>`}
        <button class="pill" onclick="dismissRec(${r.from.id}, ${r.mediaId}, this)" title="Togli da questa lista">Ignora</button>
      </div>
    </div>`;
  }).join('')}</div>`;
}
async function recToPlanning(mediaId, btn){
  btn.disabled = true;
  try {
    await api('/status', { method: 'POST', body: JSON.stringify({ mediaId, status: 'PLANNING' }) });
    if (FRIENDS && FRIENDS.mine) FRIENDS.mine[mediaId] = { mediaId, status: 'PLANNING', progress: 0, score: 0 };
    invalidateLists();
    btn.outerHTML = `<span class="rec-st">${escapeHtml((LIST_LABELS.PLANNING || { label: 'Da vedere' }).label)}</span>`;
    showToast('Aggiunta a "Da vedere".', 'ok');
  } catch (err){ btn.disabled = false; showToast('Errore: ' + err.message, 'error'); }
}
async function dismissRec(fromId, mediaId, btn){
  btn.disabled = true;
  try {
    await api('/recommendations/dismiss', { method: 'POST', body: JSON.stringify({ fromId, mediaId }) });
    const item = btn.closest('.rec-item');
    const list = item && item.parentElement;
    if (item) item.remove();
    if (list && !list.children.length){ if (list.previousElementSibling) list.previousElementSibling.remove(); list.remove(); }
  } catch (err){ btn.disabled = false; showToast('Errore: ' + err.message, 'error'); }
}

// riquadro "Amici" nella scheda dettagli
async function renderDetailFriends(id){
  const el = $('#friendsBox');
  if (!el) return;
  let fr;
  try{ fr = await loadFriendLists(); }
  catch(err){ el.remove(); return; }             // workflow senza /friends: niente riquadro
  if (!DETAIL || DETAIL.id !== id || !$('#friendsBox')) return;
  const order = ['CURRENT','REPEATING','COMPLETED','PAUSED','PLANNING','DROPPED'];
  const list = (fr.byMedia[id] || []).slice().sort((a, b) => order.indexOf(a.status) - order.indexOf(b.status));
  if (!fr.friends.length){ el.remove(); return; }
  // la mia voce: quella appena letta dalla scheda se c'è (più aggiornata), altrimenti dalla mia lista pubblica
  const mine = (DETAIL.entry && DETAIL.entry.status) ? DETAIL.entry : (fr.mine && fr.mine[id]);
  el.innerHTML = `<div class="lbl friends-lbl">Amici <button class="pill positive" onclick="openRecommend(${id})">💌 Consiglia</button></div>`
    + (list.length ? friendRows(list, mine) : '<div class="fr-row"><span class="st">Nessun amico ce l\'ha in lista.</span></div>');
}

// ---------- Tab: Classifiche (dati pubblici letti direttamente da AniList) ----------
// Due modalità: "Per stagione" (anno + stagione, come la classifica stagionale di AniList)
// e "Generale" (i migliori/più popolari di sempre). Nessun endpoint nuovo: stessa chiamata
// pubblica già usata per tag/generi e consigli, qui filtrata per stagione/anno/ordinamento.
function currentSeason(){
  const now = new Date(), m = now.getMonth();       // 0=gen … 11=dic; dicembre è già inverno dell'anno dopo
  if (m === 11) return { season:'WINTER', year: now.getFullYear() + 1 };
  if (m <= 1) return { season:'WINTER', year: now.getFullYear() };
  if (m <= 4) return { season:'SPRING', year: now.getFullYear() };
  if (m <= 7) return { season:'SUMMER', year: now.getFullYear() };
  return { season:'FALL', year: now.getFullYear() };
}
const SEASONAL_SORTS = [['TRENDING_DESC','Di tendenza'], ['POPULARITY_DESC','Più popolari'], ['SCORE_DESC','Più votati']];
const SEASONAL_YEAR_MAX = currentSeason().year + 1;
const SEASONAL_YEAR_MIN = 1960;
let SEASONAL_VIEW = Object.assign({ mode:'season', sort:'TRENDING_DESC', page:0, items:[], hasNext:false, loading:false, error:null }, currentSeason());

// GraphQL vuole solo variabili dichiarate E usate: in modalità "generale" $year/$season non entrano
// nella query, quindi vanno tolte anche dalla firma (altrimenti AniList risponde con un errore di validazione).
const seasonalQuery = mode => `query(${mode === 'season' ? '$year:Int, $season:MediaSeason, ' : ''}$page:Int, $sort:[MediaSort]){ Page(page:$page, perPage:24){ pageInfo{hasNextPage}
  media(type:ANIME, isAdult:false, format_not_in:[MUSIC], sort:$sort${mode === 'season' ? ', seasonYear:$year, season:$season' : ''}){
    id title{english romaji native} coverImage{medium} format episodes seasonYear averageScore status } } }`;

async function runSeasonal(more = false){
  const v = SEASONAL_VIEW;
  if (!more){ v.page = 0; v.items = []; v.error = null; v.loading = true; if (ACTIVE_TAB === 'seasonal') renderTab(); }
  try{
    const [data] = await Promise.all([
      anilistPublic(seasonalQuery(v.mode), { year: v.year, season: v.season, page: v.page + 1, sort: [v.sort] }),
      ensureLists(Object.keys(LIST_TABS)).catch(() => {})
    ]);
    v.page++;
    v.hasNext = data.Page.pageInfo.hasNextPage;
    const st = listStatusMap();
    v.items = v.items.concat(data.Page.media.map(m => ({
      id: m.id, title: animeTitle(m), titles: m.title, cover: m.coverImage && m.coverImage.medium,
      format: m.format, episodes: m.episodes, year: m.seasonYear, avg: m.averageScore, status: m.status,
      inLibrary: Boolean(st[m.id]), libraryStatus: st[m.id] && st[m.id].status, libraryProgress: st[m.id] && st[m.id].progress
    })));
  }catch(err){ v.error = err.message; }
  v.loading = false;
  if (ACTIVE_TAB === 'seasonal') renderTab();
}

function setSeasonalMode(mode){
  if (SEASONAL_VIEW.mode === mode) return;
  SEASONAL_VIEW.mode = mode;
  if (mode === 'all' && SEASONAL_VIEW.sort === 'TRENDING_DESC') SEASONAL_VIEW.sort = 'SCORE_DESC';
  runSeasonal();
}
function setSeasonalYear(y){ SEASONAL_VIEW.year = Number(y); runSeasonal(); }
function setSeasonalSeason(s){ SEASONAL_VIEW.season = s; runSeasonal(); }
function setSeasonalSort(s){ if (SEASONAL_VIEW.sort === s) return; SEASONAL_VIEW.sort = s; runSeasonal(); }

function renderSeasonal(){
  const v = SEASONAL_VIEW;
  const years = []; for (let y = SEASONAL_YEAR_MAX; y >= SEASONAL_YEAR_MIN; y--) years.push(y);
  const opt = (val, text, cur) => `<option value="${escapeAttr(String(val))}" ${String(cur) === String(val) ? 'selected' : ''}>${escapeHtml(String(text))}</option>`;
  const sorts = SEASONAL_SORTS.map(([k, l]) => `<button class="chip ${v.sort === k ? 'active' : ''}" onclick="setSeasonalSort('${k}')">${l}</button>`).join('');
  const body = v.loading && !v.items.length ? skeletonGrid()
    : v.error ? emptyState('Errore nel caricamento: ' + v.error)
    : v.items.length ? renderSearchResults(v.items)
    : emptyState('Nessun risultato.');
  return `
    <div class="list-tools">
      <button class="pill${v.mode === 'season' ? ' active' : ''}" onclick="setSeasonalMode('season')">Per stagione</button>
      <button class="pill${v.mode === 'all' ? ' active' : ''}" onclick="setSeasonalMode('all')">Generale</button>
      ${v.mode === 'season' ? `
        <select aria-label="Anno" onchange="setSeasonalYear(this.value)">${years.map(y => opt(y, y, v.year)).join('')}</select>
        <select aria-label="Stagione" onchange="setSeasonalSeason(this.value)">${Object.entries(IT.season).map(([k, l]) => opt(k, l, v.season)).join('')}</select>` : ''}
    </div>
    <div class="recs-filter">${sorts}</div>
    ${body}
    ${v.hasNext && !v.loading ? `<div style="text-align:center;margin-top:18px;"><button class="btn secondary" onclick="this.disabled=true;this.textContent='Carico…';runSeasonal(true)">Carica altri</button></div>` : ''}`;
}

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
