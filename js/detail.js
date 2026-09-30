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

