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

