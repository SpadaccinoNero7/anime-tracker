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
  schedulePushView();
}
applyTheme();
$('#themeBtn').addEventListener('click', () => setTheme(activeTheme() === 'light' ? 'dark' : 'light'));
try { matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => { if (THEME_PREF === 'auto') applyTheme(); }); } catch (e) {}
if (TG) try { TG.onEvent('themeChanged', () => { if (THEME_PREF === 'auto') applyTheme(); }); } catch (e) {}

// ---------- Preferenze di visualizzazione (rotellina) ----------
// Aspetto e schede: restano su questo browser (localStorage), non passano dal server.
const VIEW_KEY = 'animeDashboardView';
const VIEW_DEFAULTS = { titleLang:'english', groupSeasons:true, pageSize:30, startTab:'library', hiddenTabs:[], tabOrder:[], volumeChapters:true, showYen:true };
let VIEW = Object.assign({}, VIEW_DEFAULTS);
try { Object.assign(VIEW, JSON.parse(localStorage.getItem(VIEW_KEY)) || {}); } catch (e) {}
if (!Array.isArray(VIEW.hiddenTabs)) VIEW.hiddenTabs = [];
if (!Array.isArray(VIEW.tabOrder)) VIEW.tabOrder = [];
function saveView(){ try { localStorage.setItem(VIEW_KEY, JSON.stringify(VIEW)); } catch (e) {} schedulePushView(); }

// Le preferenze restano anche su n8n (GET/POST /view, WORKFLOWS/add_view_endpoints.py): cambiando dispositivo ritrovi
// schede, ordine, tema e lingua. All'avvio vince quello che c'è sul server; se il server non le ha ancora, le carica questo browser.
// Se l'endpoint non esiste (workflow non aggiornato) o non risponde, tutto continua a funzionare solo in locale.
const VIEW_SYNC_KEYS = ['titleLang', 'groupSeasons', 'pageSize', 'startTab', 'hiddenTabs', 'tabOrder', 'volumeChapters', 'showYen'];
let viewSyncOn = false, viewSyncTimer = null, viewApplyingRemote = false;
function viewSnapshot(){
  const o = { theme: THEME_PREF };
  VIEW_SYNC_KEYS.forEach(k => { o[k] = VIEW[k]; });
  return o;
}
function schedulePushView(){
  if (!viewSyncOn || viewApplyingRemote) return;
  clearTimeout(viewSyncTimer);
  viewSyncTimer = setTimeout(() => { api('/view', { method: 'POST', body: JSON.stringify({ view: viewSnapshot() }) }).catch(() => {}); }, 1000);
}
async function pullView(){
  try {
    const r = await Promise.race([api('/view'), new Promise((_, no) => setTimeout(() => no(new Error('timeout')), 2500))]);
    viewSyncOn = true;
    if (!r || !r.view || typeof r.view !== 'object'){ schedulePushView(); return; }
    viewApplyingRemote = true;
    try {
      VIEW_SYNC_KEYS.forEach(k => { if (k in r.view) VIEW[k] = r.view[k]; });
      if (!Array.isArray(VIEW.hiddenTabs)) VIEW.hiddenTabs = [];
      if (!Array.isArray(VIEW.tabOrder)) VIEW.tabOrder = [];
      saveView();
      if (r.view.theme) setTheme(r.view.theme);
    } finally { viewApplyingRemote = false; }
    applyTabPrefs();
  } catch (e) { viewSyncOn = false; }
}

