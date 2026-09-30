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

