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

