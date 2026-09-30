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

