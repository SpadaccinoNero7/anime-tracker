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

