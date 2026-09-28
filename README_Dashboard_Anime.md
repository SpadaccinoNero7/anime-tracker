# Dashboard web per la libreria anime — multi-utente

## Cos'è

Il bot Telegram resta invariato e continua a funzionare come prima, con il tuo solo account AniList.

Questo pacchetto aggiunge un layer parallelo, separato dal bot: una dashboard web dove **ognuno accede con il proprio account AniList**. Ogni persona vede e modifica solo la propria libreria — non c'è nessun account condiviso. Solo chi è nella whitelist può entrare.

## File allegati

| File | Cos'è |
|---|---|
| `API_Dashboard_Anime.json` | Workflow n8n da importare. Contiene i webhook per la dashboard, il login OAuth con AniList, la verifica sessione e il logout. |
| `dashboard.html` | Pagina web singola e autonoma (HTML+CSS+JS) che chiama gli endpoint del workflow sopra. |
| `dashboard.css` / `dashboard.js` | Stili e logica della pagina (la `dashboard.html` li carica a fianco). |
| `WORKFLOWS/add_manga_support.py` | Patch idempotente che apre gli endpoint ai manga (`?type=MANGA`). Da applicare ai workflow dashboard. |
| `WORKFLOWS/add_volume_progress.py` | Patch idempotente che aggiunge il progresso a volumi dei manga (`progressVolumes`). Da applicare dopo la precedente. |
| `README_Dashboard_Anime.md` | Questo file. |

## Come funziona il login

1. Apri la dashboard e clicchi "Accedi con AniList".
2. Vieni mandato su AniList, autorizzi con il tuo account.
3. AniList ti rimanda a un webhook di n8n che scambia il codice ricevuto per un token, chiede ad AniList chi sei, e controlla se il tuo username è nella whitelist.
4. Se sì, viene creata una sessione (un token casuale salvato solo nella memoria interna del workflow n8n, associato al tuo token AniList) e il browser la salva in `localStorage`. Se no, vedi una pagina di accesso negato.
5. Da quel momento ogni chiamata della dashboard porta quel token di sessione, e il workflow lo usa per interrogare AniList **con il tuo account**, non con uno fisso.

Le sessioni durano quanto il token AniList (di norma circa un anno) e restano salvate nei dati interni del workflow n8n — non serve nessun database esterno.

## Come metterlo in funzione

1. **Registra un'app OAuth su AniList**
   Vai su [anilist.co/settings/developer](https://anilist.co/settings/developer), crea un nuovo client. Come Redirect URL usa esattamente:
   ```
   https://tuo-dominio/webhook/anime-dashboard/auth/callback
   ```
   Salva e annota **Client ID** (pubblico) e **Client Secret** (mostrato una sola volta).

2. **Configura le variabili d'ambiente sul container n8n**
   Nello stesso posto dove già hai `TELEGRAM_BOT_TOKEN`, aggiungi:
   ```
   ANILIST_CLIENT_ID=il-tuo-client-id
   ANILIST_CLIENT_SECRET=il-tuo-client-secret
   ANILIST_ALLOWED_USERS=tuoUsername,amico1,amico2
   ```
   `ANILIST_ALLOWED_USERS` è la whitelist: solo questi username AniList (case-insensitive) potranno accedere alla dashboard. Riavvia il container dopo averle aggiunte.

3. **Importa il nuovo workflow in n8n**
   Apri n8n, crea un nuovo workflow e importa `API_Dashboard_Anime.json` (menu ⋯ → *Import from File*).

4. **Crea la credenziale di protezione**
   Come prima, crea una credenziale **Header Auth** chiamata "Dashboard Access Key" (es. header `X-Api-Key`, valore segreto a tua scelta) e assegnala a tutti i nodi Webhook che la richiedono all'import. Questa protegge l'accesso agli endpoint dati (oltre al login vero e proprio, è un secondo livello contro bot/scraping). Il webhook di login (`/auth/callback`) resta senza questa protezione perché è AniList stesso a chiamarlo tramite redirect del browser.

5. **Attiva il workflow**
   Metti il workflow su **Active**.

6. **Metti online `dashboard.html`**
   Come prima, esposta tramite lo stesso dominio/reverse proxy di n8n (path diverso, per evitare CORS).

7. **Configura la dashboard**
   Apri la pagina, icona ingranaggio, inserisci: URL base delle webhook, nome header, chiave, e ora anche **AniList Client ID** (quello ottenuto al passo 1 — non il secret, quello resta solo su n8n).

8. **Accedi**
   Clicca "Accedi con AniList" e autorizza con il tuo account. Manda il link agli amici in whitelist perché facciano lo stesso con il loro.

## Endpoint esposti (riferimento)

| Metodo | Path | Funzione | Richiede sessione utente |
|---|---|---|---|
| GET | `/auth/callback` | Riceve il redirect da AniList dopo il login | — |
| GET | `/session` | Verifica se la sessione salvata nel browser è ancora valida | no (ma richiede la Dashboard Access Key) |
| POST | `/logout` | Invalida la sessione corrente | no (ma richiede la Dashboard Access Key) |
| GET | `/library` | Serie in corso (CURRENT) dell'utente loggato | sì |
| GET | `/completed` | Serie completate | sì |
| GET | `/dropped` | Serie droppate | sì |
| GET | `/paused` | Serie in pausa | sì |
| GET | `/planning` | Serie "Da vedere" (PLANNING), dalla più recente; aggiunto con `WORKFLOWS/add_planning_endpoint.py` | sì |
| GET | `/upcoming` | Episodi disponibili e in uscita | sì |
| GET | `/stats` | Statistiche libreria (`scoreHist`, `byFormat`, `byYear`, generi con voto medio: vedi `WORKFLOWS/add_stats_charts.py`) | sì |
| GET | `/search?q=...` | Ricerca su AniList (dato pubblico) | sì |
| POST | `/add` `{mediaId}` | Aggiunge una serie alla libreria dell'utente loggato | sì |
| POST | `/progress` `{mediaId, action}` | Aggiorna il progresso (`action`: `inc`, `dec`, `max`, `set`+`value`) | sì |
| POST | `/status` `{mediaId, status}` | Cambia stato (`CURRENT`, `PLANNING`, `PAUSED`, `DROPPED`, `COMPLETED`); crea la voce se non esiste | sì |
| GET | `/entry?id=...` | Stato della serie nella lista dell'utente: `{entry: {status, progress, score, repeat, notes}}` o `{entry: null}` | sì |
| POST | `/remove` `{mediaId}` | Rimuove la serie dalla lista (`{ok, deleted}`) | sì |
| POST | `/score` `{mediaId, score?, notes?}` | Voto personale (`score` 0-100, `0` = togli) e note (`""` = cancella); solo per serie già in lista. Risponde `{ok, score, notes}` o `{ok:false, error}`. Aggiunto con `WORKFLOWS/add_score_endpoint.py` | sì |
| GET | `/friends` | Solo versione amici: `{me, friends:[{id,name,avatar}], requests:[...], sent:[...], others:[...]}`. `friends` = amicizie accettate; `requests` = richieste ricevute; `sent` = richieste inviate in attesa; `others` = registrati (Data Table `anime_utenti`) senza alcun rapporto con te. Mai token o chat. Aggiunto con `WORKFLOWS/add_friends_endpoint.py` | sì |
| POST | `/friends/request` `{id}` | Manda una richiesta di amicizia a un utente registrato; se quello ti aveva già scritto, l'amicizia scatta subito. `{ok, status, error?}` | sì |
| POST | `/friends/accept` `{id}` | Accetta una richiesta ricevuta da `id`. `{ok}` | sì |
| POST | `/friends/remove` `{id}` | Rimuove il rapporto con `id`, qualunque sia lo stato: rifiuta una richiesta ricevuta, annulla una inviata, o rimuove un'amicizia già accettata. `{ok}` | sì |
| GET | `/hidden` | Solo versione amici: consigli nascosti con "Non mi interessa", `{ids:[mediaId…]}` (Data Table `anime_nascosti`, creata da sola) | sì |
| POST | `/hidden` `{mediaId, hide}` | Nasconde (`hide: true`) o rimette (`false`) un consiglio; risponde `{ok, ids}`. Endpoint aggiunti con `WORKFLOWS/add_hidden_recs_endpoints.py` | sì |
| GET | `/news` | News (giochi, film, live action, editoria...) dal feed RSS di AnimeClick.it che citano un titolo o sinonimo presente nella libreria AniList dell'utente, qualunque sia lo stato (`items`, max 40), più le ultime news in generale (`latest`, ultimi 30 giorni, max 80): `{items:[…], latest:[{guid,title,link,pubDate,pubTs,image,tags:[…],matches:[{id,title,cover}]}]}` (`matches` vuoto se la news non cita la libreria). `latest` aggiunto con `WORKFLOWS/add_news_general.py`. Le news arrivano da una Data Table condivisa (`anime_news`), aggiornata ogni 30 minuti da un workflow a parte; l'endpoint non chiama mai il feed. Aggiunto con `WORKFLOWS/add_news_endpoint.py` | sì |

**Anime o manga (`?type=MANGA`):** dopo `python WORKFLOWS/add_manga_support.py <workflow.json>` gli endpoint di lista, ricerca, statistiche e progresso
leggono il parametro `type`: assente o qualsiasi altro valore = `ANIME` (comportamento di prima), `MANGA` = la lista manga dello stesso account AniList.
Lo mandano `/library`, `/completed`, `/dropped`, `/paused`, `/planning`, `/search`, `/stats`; gli endpoint che lavorano su un `mediaId`
(`/add`, `/status`, `/progress`, `/score`, `/remove`, `/entry`) funzionano per entrambi senza bisogno del parametro.
Nelle risposte `episodes` resta il totale delle unità (per un manga sono i capitoli, `null` se è ancora in pubblicazione) e si aggiungono
`chapters`, `volumes` e `kind` (`ANIME`/`MANGA`). Restano solo anime, per loro natura, `/upcoming` (calendario) e `/news` (feed RSS).

**Volumi (`progressVolumes`):** dopo `python WORKFLOWS/add_volume_progress.py <workflow.json>` le liste `/library`, `/paused` e `/dropped` riportano anche
`progressVolumes` (volumi letti) accanto a `progress`, e lo stesso fa `/entry`. Per aggiornarli si usa lo stesso `/progress` con un campo in più nel body:
`{mediaId, action, value?, field: "volumes"}` — senza `field` (o con qualsiasi altro valore) l'endpoint si comporta esattamente come prima e muove episodi/capitoli.
Le azioni sono le stesse (`inc`, `dec`, `max`, `set`), ma con i volumi totali dell'opera come tetto. I due contatori sono indipendenti: aggiornarne uno non tocca l'altro.

Le liste (`/library`, `/planning`, `/paused`, `/dropped`, `/completed`) riportano anche `updatedAt` (ultima modifica, in secondi) e `/completed` anche `completedAt` (`AAAA-MM-GG`, anche parziale) e `year`: servono alla dashboard per ordinare e filtrare, si aggiungono con `WORKFLOWS/add_list_dates.py`.

Gli endpoint `/entry` e `/remove` si aggiungono a un workflow esistente con `python WORKFLOWS/add_entry_endpoints.py <workflow.json>` (idempotente). Dopo l'import in n8n il workflow va **pubblicato** (pulsante Publish), altrimenti i webhook rispondono 404.

**News (`/news`):** oltre a `python WORKFLOWS/add_news_endpoint.py <workflow.json>` (che aggiunge l'endpoint al workflow API, come sopra), serve importare **anche** `WORKFLOWS/Aggiorna news anime.json` come workflow a parte (rigenerabile con `python WORKFLOWS/build_news_cron.py`): ogni 30 minuti scarica il feed RSS di AnimeClick.it (`https://www.animeclick.it/rss`) e lo salva nella Data Table `anime_news` (creata da sola). Va importato, **pubblicato** e messo su **Active** come gli altri workflow schedulati (es. "Notifica nuovi episodi"). Senza questo secondo workflow attivo, `/news` risponde sempre con lista vuota perché non c'è nessuna news salvata da filtrare.

Il confronto tra titolo/sinonimi AniList e testo della news è per corrispondenza esatta (case/accenti ignorati): funziona bene quando la news cita il titolo inglese o romaji per intero (es. "NieR:Automata"), meno se lo abbrevia o lo traduce in modo diverso da come compare su AniList. È una limitazione nota, accettabile per un primo giro: se serve, si può allargare a sinonimi aggiuntivi o a un confronto più permissivo (`WORKFLOWS/add_news_endpoint.py`, nodo "Prepara risposta news").

Tutti gli endpoint "sì" rispondono `401 {"error":"not_authenticated"}` se manca una sessione valida: la dashboard reindirizza automaticamente alla schermata di login in quel caso.

## Funzionalità della dashboard

- **Login con AniList** — ognuno entra col proprio account, badge con nome e avatar in alto, pulsante di logout
- **Impostazioni (⚙)** — aperte a tutti, salvate solo nel browser di chi le cambia e con effetto immediato: tema (automatico/chiaro/scuro, "automatico" segue il sistema), lingua dei titoli (inglese, romaji o originale giapponese), raggruppamento delle stagioni in cartelle, numero di serie per pagina, scheda da cui si parte e quali schede tenere nella barra (almeno una deve restare). "Ripristina" riporta tutto ai valori di partenza. La sezione **Avanzate** (URL delle webhook, header e chiave, Client ID AniList) la vedono solo gli username in `ADMIN_USERS` dentro `dashboard.js`, o chiunque se manca la configurazione di base.
  I titoli alternativi arrivano dall’API solo dopo aver applicato `WORKFLOWS/add_title_langs.py` ai due workflow dashboard (`titles: {english, romaji, native}` accanto al vecchio `title`) e averli reimportati e ripubblicati; senza quel passaggio la scelta della lingua vale solo dove i dati arrivano da AniList (scheda serie, classifiche, consigli, calendario, amici).
- **Anime o manga** — l'interruttore accanto al titolo cambia mondo: le stesse schede mostrano la lista manga dello stesso account AniList,
  le parole seguono ("episodi" → "capitoli", "In corso" → "In lettura", "Da vedere" → "Da leggere") e spariscono le schede che valgono solo
  per gli anime (In uscita, Classifiche, News, Telegram). La scelta resta salvata nel browser e ogni modalità ha la sua cache, quindi
  passare dall'una all'altra non ricarica tutto. Nella scheda di un manga al posto di episodi/stagione/studio compaiono capitoli e volumi.
  Richiede `WORKFLOWS/add_manga_support.py` applicato ai workflow dashboard.
- **Volumi** — per i manga il contatore principale (barra, +/−, "Segna al massimo") sono i **volumi**, più facili da ricordare dei capitoli; i capitoli
  restano su una riga secondaria della stessa card, sempre modificabili, e nella scheda di dettaglio ci sono due righe separate. Se un'opera non dichiara i
  volumi (capita spesso con quelle ancora in pubblicazione) e non ne hai segnato nessuno, restano primi i capitoli. Richiede `WORKFLOWS/add_volume_progress.py`.
  Con "Segna anche i capitoli" (impostazioni → Manga, attivo di default) i capitoli seguono i volumi nei due sensi: salgono aggiungendo un volume, scendono
  togliendolo. È una **stima**, perché AniList non dice quanti capitoli contiene ciascun volume e l'unica cosa possibile è spartirli in parti uguali
  (327 capitoli in 37 volumi → volume 13 = capitolo 115). Non scatta se l'opera non dichiara entrambi i totali; l'ultimo volume corrisponde sempre
  all'ultimo capitolo, quindi finendo l'opera i conti tornano. Il prezzo della simmetria: toccando i volumi la stima prende il posto di un numero di
  capitoli messo a mano, quindi chi vuole il valore esatto lo rimette dopo (o spegne l'impostazione).
- **In corso** — libreria con copertina, barra di progresso, +/− episodi, pausa/drop/completa; badge "N episodi da vedere" sulle serie in arretrato (oppure "In pari · prossimo: ep. X, giorno e ora") e totale arretrati sul pulsante della scheda
- **In uscita** — episodi già disponibili da recuperare, calendario settimanale (lun→dom, frecce per le settimane da −4 a +8) con gli episodi di "In corso" e "Da vedere" letti direttamente da AniList (`airingSchedules`), e sotto gli episodi con data oltre questa settimana
- **Ordina e filtra** — sopra ogni lista: filtro per titolo e ordinamento (In corso: aggiornate di recente, episodi da recuperare, prossima uscita, avanzamento, titolo; Da vedere: aggiunte di recente, voto medio, anno; Completati: finite di recente, tuo voto). Filtri in più: "solo con episodi da vedere" (In corso), già uscite / non ancora uscite (Da vedere), anno di completamento e fascia di voto (Completati). Le scelte restano salvate nel browser
- **Statistiche** — riquadri (serie, episodi, tempo, voto medio su 10) e grafici: composizione della lista per stato, distribuzione dei tuoi voti con la media, generi più seguiti con il tuo voto medio, anno di uscita, formati, studi, serie più lunghe. Grafici in HTML/CSS senza librerie, con tooltip; dati da `/stats`, arricchito con `WORKFLOWS/add_stats_charts.py`
- **In pausa / Droppati / Completati** — liste con possibilità di riprendere una serie
- **Voto e note** — nella scheda di una serie in lista: voto da 0 a 10 (a mezzi punti, salvato su AniList come `scoreRaw`, quindi vale qualunque formato voti usi il profilo) e note personali
- **Amici** — amicizia con richiesta/accettazione (non più "tutti quelli in whitelist"): richieste ricevute (accetta/rifiuta), richieste inviate (annulla), elenco registrati a cui mandarne una nuova, e i tuoi amici veri (con pulsante per rimuoverli). Solo con gli amici accettati: link al profilo AniList, la tua lista "Da vedere" incrociata con le loro liste (chi l'ha già vista e con che voto, chi vuole vederla), attività recenti; nella scheda di ogni serie un riquadro con stato, episodio e voto degli amici. Liste e attività sono lette dall'API pubblica di AniList: chi ha la lista privata compare con 🔒 e senza dati
- **Per te** — consigli dalle raccomandazioni AniList delle serie che hai visto (pesate col tuo voto); droppate e completate con voto basso tolgono punti ai titoli simili; "Non mi interessa" nasconde un consiglio per sempre (con Annulla); sezione "Piaciute agli amici" (voto ≥ 8, non nelle tue liste) e spinta ai consigli che piacciono anche agli amici
- **News** — notizie (giochi, film, live action, editoria, eventi...) dal feed RSS di AnimeClick.it, in due viste: "Tutte" (le ultime news in generale, quelle sulle tue serie evidenziate) e "Le tue serie" (solo quelle che citano la tua libreria), con filtro per argomento (anime, manga, videogiochi, film e live action, Giappone) ricavato dai tag di AnimeClick; ogni notizia apre l'articolo originale, ogni serie citata apre la sua scheda
- **Dove vederlo** — nella scheda di ogni serie i link di streaming presi da AniList (`externalLinks`): prima i servizi attivi in Italia (Crunchyroll, Netflix, Prime Video, Disney+, YouTube…), a parte gli altri; sempre il link "Cerca su JustWatch" (Italia) per la disponibilità reale, e il sito ufficiale in fondo
- **Cerca** — ricerca su AniList e aggiunta diretta alla libreria

## Versione multi-utente con bot Telegram condiviso (cartella `WORKFLOWS/AMICI`)

| File | Cosa fa |
|---|---|
| `API Dashboard Anime (amici).json` | Sostituisce la dashboard: sessioni e utenti salvati su Data Tables (`anime_sessioni`, `anime_utenti`) invece che nei dati interni del workflow, quindi sopravvivono ai reimport. Nuovi endpoint `GET /telegram` e `POST /telegram/unlink`. Contiene il ramo manuale "crea tabelle". |
| `Bot Anime Amici.json` | Bot unico per gli amici. Riconosce chi scrive dal `chat_id`, usa il token AniList di quella persona. Collegamento con `/start <codice>` generato dalla scheda Telegram della dashboard. Niente backup Gmail. |
| `Notifica nuovi episodi (amici).json` | Ogni 45 minuti controlla le notifiche AniList di ogni utente collegato e gli manda i nuovi episodi. Cursore per utente in `anime_utenti.notifCursor`. Al primo giro salva solo il punto di partenza (niente storico arretrato). |

I workflow personali (bot + notifiche col tuo account) restano separati in `WORKFLOWS/PERSONALE`, senza la cancellazione dei messaggi: sono quelli su cui provare le novità.

**Variabili d'ambiente in più sul container n8n:** `ANIME_BOT_TOKEN` (token del bot amici) e `ANIME_BOT_USERNAME` (username del bot, senza @).
**Credenziale in più:** "Telegram Bot Amici" (tipo Telegram API, stesso token), usata dal Telegram Trigger.

**Flusso di collegamento:** dashboard → scheda Telegram → "Collega Telegram" apre `t.me/<bot>?start=<codice>` → l'utente preme Avvia → il bot salva il `chat_id` nella riga dell'utente. Ogni apertura della scheda genera un codice nuovo.

**Amicizia con richiesta/accettazione:** `WORKFLOWS/add_friends_endpoint.py` aggiunge la Data Table `anime_amicizie` (`fromId`, `toId`, `status` pending/accepted, `requestedAt`; creata da sola — il nome non è `createdAt` perché n8n lo riserva come colonna di sistema) e gli endpoint `GET /friends` + `POST /friends/request|accept|remove`. Essere nella whitelist (`ANILIST_ALLOWED_USERS`) dà solo accesso alla dashboard, non più l'amicizia automatica: ognuno vede solo gli amici che ha richiesto ed è stato accettato, o viceversa.

## Bot v2: scheda serie e liste come sul sito

`python WORKFLOWS/add_bot_v2.py <bot.json>` (idempotente) vale per entrambi i bot: autenticazione AniList e token Telegram li copia dai nodi esistenti ("Lista anime", "Invia messaggio nuovo").

- **Scheda serie** — copertina con didascalia: formato, anno, episodi, voto medio, stato, episodi arretrati, prossimo episodio, il tuo voto, e la trama se la serie non è in lista o è in "Da vedere". I pulsanti modificano la scheda sul posto: ➖/➕, "Segna fino all'ep. X", ⭐ voto 1-10 (salvato come `scoreRaw`), Completata (nascosto finché la serie è in onda, come sul sito), Pausa, Droppa, Inizia, Da vedere, Riprendi, e "🌐 Apri sul sito" (`…/anime/#anime=<id>`). Arrivando all'ultimo episodio di una serie conclusa passa da sola a Completata. Callback `c:<id>` apre (anche i vecchi `settings:<id>`), `ca:<azione>:<id>[:<valore>]` modifica. Nodi `Scheda: …`.
- **Ricerca** — i risultati riportano formato, anno e l'icona dello stato se la serie è già in lista; toccandone uno si apre la scheda, dove si sceglie "Inizia" o "Da vedere" (prima il bot aggiungeva direttamente a In corso).
- **Liste** — `/lista` ordinata per arretrati, con 🔴 N da vedere / 🟢 in pari + prossima uscita; nuovo `/davedere`; `/completati` per anno di completamento e voti su 10; pausa e droppati aprono la scheda. Pulsanti su due colonne, al massimo 40.
- **Menu** su due colonne con tutte le liste, aiuto e link al sito; voto medio delle statistiche su 10.
- **Per te (`/perte`)** — stesso calcolo della scheda "Per te" del sito (raccomandazioni AniList delle serie viste pesate col voto, droppate e voti bassi in negativo, esclusi quelli già in lista e i nascosti): i primi 10 con il "perché". 🙈 nasconde un consiglio (diventa "↩️ Rimetti"), salvato nella stessa Data Table `anime_nascosti` della dashboard, quindi vale in entrambi i posti. Non include la sezione "Piaciute agli amici".
- **News (`/news`)** — dalla Data Table `anime_news` (aggiornata dal workflow "Aggiorna news anime"), le news degli ultimi 90 giorni che citano la tua libreria; se non ce ne sono, le ultime in generale. Pulsante per passare a "Tutte le ultime news" (30 giorni) e viceversa, e pulsanti ⭐ per aprire le serie citate. Il confronto è a parole intere (più severo del sito, per evitare che "mono" scatti dentro "monogatari").
- **Amici (`/amici`)** — amici accettati (Data Table `anime_amicizie`, come sul sito), richieste in attesa e le ultime 15 attività AniList degli amici, con pulsanti per aprire le serie. Richieste e amicizie si gestiscono dal sito.
- Il bot personale usa le stesse Data Table, con l'id AniList del tuo account: nascosti e amicizie sono gli stessi della dashboard.
- Per far comparire `/davedere`, `/perte`, `/news` e `/amici` nel menu comandi di Telegram va eseguito una volta a mano il ramo "Trigger manuale: imposta comandi".

## Limiti noti (accettabili per un uso tra pochi amici)

- Il token di sessione è generato con un generatore pseudocasuale semplice (non crittografico) — sufficiente per un piccolo gruppo fidato, ma non pensato per esporre il servizio su larga scala.
- Non c'è un controllo anti-CSRF sul parametro `state` dell'OAuth: chi intercetta il link di autorizzazione potrebbe in teoria forzare un redirect diverso, ma non potrebbe comunque ottenere un token valido senza completare il login su AniList.
- Nella versione originale le sessioni vivono nei dati interni del workflow n8n: se il workflow viene reimportato, tutti devono rifare il login. La versione "amici" le salva su Data Table e non ha questo problema.
- Manga: volumi e capitoli restano due conteggi separati su AniList. La dashboard può stimare i capitoli dai volumi (vedi sopra), ma non il contrario: segnare un capitolo non muove i volumi. Il profilo di un amico
  mostra sempre le sue statistiche anime, anche guardandolo in modalità manga; notifiche Telegram e bot restano sugli anime, tranne i nuovi capitoli manga (in prova, vedi Notifiche v2).
- Bot: dopo `/segui` (o "Cerca e aggiungi") il bot non salva più nessuno stato. La domanda "✏️ Scrivi il nome della serie" parte con `force_reply` e il nome viene riconosciuto perché è una risposta a quel messaggio (`reply_to_message`), quindi due persone insieme non si pestano più i piedi (parte 3 di `WORKFLOWS/add_bot_v2.py`). Se qualcuno chiude la modalità risposta e scrive il nome come messaggio normale, il bot lo ignora: basta rispondere alla domanda, o usare `/segui <nome>`. Anche `/annulla` funziona solo come risposta alla domanda; altrimenti il bot risponde che non c'era nulla da annullare.
- Notifiche amici: se un /controlla parte proprio mentre gira il controllo automatico, la stessa notifica può arrivare due volte.

## Notifiche v2 (per tutti)

| Pezzo | Cosa fa |
|---|---|
| `WORKFLOWS/AMICI/Notifiche anime v2 (amici).json` (id `amiciNotifiche02`, generato da `build_notifiche_v2.py`) | Ogni 15 minuti, per ogni utente collegato: nuovi episodi (confronto con l'istantanea del giro prima, non dipende dalle impostazioni AniList), "Da vedere" iniziata/finita, nuove stagioni annunciate (notifiche AniList `RELATED_MEDIA_ADDITION`), riepilogo del mattino e punto della domenica sera. Messaggi con copertina e pulsanti. Stato salvato prima dell'invio (niente doppioni). |
| Data Table `anime_notifiche` | `anilistId`, `prefs` (JSON preferenze), `state` (JSON: istantanea liste, cursore notifiche, ultimo riepilogo/punto settimanale). Creata automaticamente dai workflow. |
| `WORKFLOWS/AMICI/add_notif_buttons_bot.py` | Aggiunge al bot amici i pulsanti `seen:<id>:<ep>` (✅ Visto, solo in avanti), `lst:CURRENT|PLANNING:<id>` (▶️ Inizia / ➕ Da vedere) e `noop`. Il pulsante premuto diventa "✔️ …". |
| `WORKFLOWS/add_prefs_endpoints.py` | `GET/POST /prefs` sul workflow API: preferenze dell'utente, validate lato server. |
| Dashboard | Pannello preferenze nella scheda Telegram; il link `…/anime/#anime=<id>` apre la scheda dell'anime (anche dopo il login). |

**Stato: pronto per tutti lato codice, resta il deploy su n8n.** `SOLO_UTENTI`/`SOLO_MANGA` sono già vuoti in `build_notifiche_v2.py` e `NOTIF_V2_TEST = false` in `dashboard.js` (pannello preferenze già visibile a tutti). `build_amici.py` è stato corretto per far puntare il comando `/controlla` del bot al workflow v2 (`amiciNotifiche02`) invece che al legacy `amiciNotifiche01` — prima il generatore usava lo stesso id per entrambi gli scopi, rischiando di regredire silenziosamente al vecchio workflow ad ogni rigenerazione. Passi rimasti, solo su n8n: importare e **attivare** `Notifiche anime v2 (amici).json`; **disattivare** il vecchio "Notifica nuovi episodi (amici)" (`amiciNotifiche01`) per evitare doppie notifiche; reimportare `Bot Anime Amici.json` aggiornato.

Preferenze predefinite: tutto attivo, riepilogo alle 9, silenzio 23→8 (ora italiana).

**Nuovi capitoli manga (per tutti dal 2026-09-25, `SOLO_MANGA` vuoto in `build_notifiche_v2.py`; interruttore “📖 Nuovi capitoli manga” nel pannello notifiche, preferenza `manga` di `/prefs` aggiunta con `WORKFLOWS/add_manga_pref.py`).** AniList non conosce le date dei capitoli, quindi la fonte è MangaUpdates (API pubblica, senza chiave):
- **Feed MangaUpdates** (una chiamata a giro, fino a 5 pagine da 100): `POST /v1/releases/search` ordinato per `time_added`, solo se almeno un utente con i manga attivi ha già un cursore.
- **Uscite manga**: la query AniList di questi utenti include anche i manga In lettura / In rilettura. Le serie in corso o in pausa vengono abbinate a MangaUpdates per titolo (romaji, poi inglese; il titolo trovato deve coincidere con uno dei titoli/sinonimi AniList, stesso tipo novel/manga, anno ±1), al massimo 3 nuove per giro; se non si trova, si riprova dopo 7 giorni. Per ogni serie abbinata arriva un messaggio 📖 con l'ultimo capitolo uscito dopo il cursore, se non è già stato avvisato (anche se esce da un altro gruppo) e non l'hai già letto. Pulsanti: **✅ Letto cap. N** (riusa `seen:<mediaId>:<capitolo>`: il bot Telegram amici e il bot Discord riconoscono i manga dal `type` della serie e rispondono "letto fino al capitolo"; i capitoli .5 arrotondano per difetto), **📖 Leggi su …** con il sito di lettura ufficiale preso dagli `externalLinks` STREAMING di AniList (prima italiano, poi inglese, poi giapponese; a parità MANGA Plus, K MANGA, VIZ, Manga UP!…; se non ce n'è nessuno, la pagina MangaUpdates) e Dettagli. MangaDex non è usabile: è bloccato dagli operatori italiani.
- Stato in `state.mu` di `anime_notifiche`: `ts` (cursore del feed), `map` (mediaId AniList → id MangaUpdates, o `-riprovaDopo`), `last` (ultimo capitolo avvisato). Il primo giro imposta solo il cursore.
- Preferenza `manga` (default attiva), con l'interruttore nella dashboard.
- Limiti: MangaUpdates registra anche le scanlation, quindi il capitolo può arrivare prima dell'uscita ufficiale in italiano; le uscite registrate con una data più vecchia di un giorno rispetto al cursore non vengono viste.

## Crunchyroll auto-sync (per tutti)

| Pezzo | Cosa fa |
|---|---|
| `WORKFLOWS/AMICI/Crunchyroll (amici).json` (generato da `build_crunchyroll.py`) | Collegamento via device-code (`crunchyroll.com/activate`), scelta profilo per account condivisi; ogni 10 minuti legge la cronologia visione di ogni utente collegato, abbina le stagioni Crunchyroll ad AniList (mappa in cache + euristica su titolo/anno) e aggiorna in automatico il progresso, con conferma via Telegram. Import dello storico pregresso con anteprima e conferma manuale delle stagioni "dubbie". |
| Data Table `anime_cr_utenti` | Collegamento per utente: `stato` (linked/error), `refreshToken`, `profileId`, `seen`, `since`, `errore`. |
| Dashboard | Scheda Collegamenti: link/scollega, scelta profilo, wizard di import storico. |

**Stato: pronto per tutti.** `SOLO_UTENTI` è vuoto in `build_crunchyroll.py` e `CR_TEST = false` in `dashboard.js` (funzione già visibile a tutti, non solo admin). Aggiunta una pausa (~400ms) tra un utente e il successivo nel giro di sincronizzazione, per non mandare all'API Crunchyroll (non ufficiale) più richieste quasi simultanee quando il gruppo cresce.

**Limiti noti da comunicare al gruppo:** usa un'API Crunchyroll non ufficiale, che può cambiare senza preavviso — un'interruzione impatta tutti gli utenti collegati insieme; in caso di cambio password o "esci da tutti i dispositivi" su Crunchyroll, il collegamento va rifatto a mano dalla dashboard; l'abbinamento automatico delle stagioni è euristico e a volte segnala "non so a quale serie corrisponde", senza modificare nulla, in attesa di un abbinamento manuale.

## Discord (in costruzione)

Bozza completa in quattro fasi: collegamento/login, canale condiviso (#attività, #news, #uscite), notifiche nel canale #notifiche solo per chi le attiva, bot con slash command. **Stato: codice completo per tutte le fasi (0-4), Fase 0 e Fase 1 già deployate; Fasi 2-4 pronte, restano da importare e attivare su n8n** (vedi i passi di ciascuna fase più sotto).

**Da fare a mano una volta (Fase 0):** creare il server con i canali `#annunci`, `#attività`, `#news`, `#uscite`, `#notifiche`, `#bot` e il ruolo **Notifiche** (l'unico che vede `#notifiche`); sul [Discord Developer Portal](https://discord.com/developers/applications) creare un'Application, aggiungere il redirect OAuth `https://homelab.tailec9b6a.ts.net/webhook/anime-dashboard/discord/callback`, creare il bot e invitarlo nel server (Send Messages, Embed Links, Manage Roles, Create Instant Invite; il ruolo del bot deve stare **sopra** il ruolo Notifiche). Env sul container n8n: `DISCORD_APP_ID`, `DISCORD_CLIENT_SECRET`, `DISCORD_BOT_TOKEN`, `DISCORD_GUILD_ID`, `DISCORD_ROLE_NOTIFICHE` (le fasi successive aggiungeranno gli id dei canali: `DISCORD_CH_ATTIVITA`, `DISCORD_CH_NEWS`, `DISCORD_CH_USCITE`, `DISCORD_CH_ANNUNCI`, `DISCORD_CH_ADMIN`), poi restart. **Nota:** `DISCORD_PUBLIC_KEY` non va impostata come env — la chiave di verifica Ed25519 è incorporata direttamente nel codice generato da `build_discord_bot.py` (`PUBLIC_KEY`, non un segreto), non letta da `$env`.

**Fase 1 — `python WORKFLOWS/AMICI/add_discord_link.py <workflow amici.json>`** (idempotente). Data Table nuova `anime_discord_utenti` (`anilistId`, `discordId`, `discordName`, `linkCode`, `shareActivity`, `notifiche`; creata da sola, `anime_utenti` non si tocca).

| Metodo | Path | Funzione | Sessione |
|---|---|---|---|
| GET | `/discord?r=<url>` | `{configured, linked, discordName, shareActivity, notifiche, linkUrl}`; `linkUrl` porta all'autorizzazione Discord con un codice nuovo a ogni apertura | sì |
| POST | `/discord/unlink` | Scollega e toglie il ruolo Notifiche | sì |
| POST | `/discord/prefs` `{shareActivity?, notifiche?}` | Salva le scelte e assegna/toglie il ruolo Notifiche | sì |
| GET | `/discord/start?n=<nonce>&r=<url>` | Redirect al login Discord ("Accedi con Discord") | — |
| GET | `/discord/callback` | Lo chiama Discord. Collegamento: salva l'account e fa entrare l'utente nel server (`guilds.join`), poi `#discord=linked`. Login: cerca l'account collegato, ricontrolla la whitelist AniList e crea la sessione come il callback AniList (`#session=…&nonce=…`, stesso controllo anti-CSRF) | — |

Il ritorno (`r`/state) accetta solo pagine di `https://homelab.tailec9b6a.ts.net/`. Il login Discord funziona solo per chi ha già collegato l'account entrando con AniList; la sessione dura al massimo 180 giorni.

**Dashboard:** la scheda Telegram si chiama ora **Collegamenti** (chiave `telegram` invariata, le impostazioni salvate restano valide) e sotto Telegram mostra il riquadro Discord solo se `/discord` risponde; il pulsante "Accedi con Discord" della schermata di login compare solo con `DISCORD_LOGIN = true` in `dashboard.js`, da attivare dopo il deploy.

**Server Discord — `python WORKFLOWS/discord/setup_server.py [--apply] [--rimuovi-predefiniti]`.** Prepara il server "Anime Tracker" con le API del bot: nome, icona (Miku, solo se il server non ne ha già una), notifiche predefinite solo per le menzioni, ruolo **Notifiche** + 10 ruoli "gusti" (Shōnen, Seinen, Isekai, Slice of life, Romance, Mecha, Horror & thriller, Sport, Commedia, Lettori manga), categorie 📌 Info / 🎬 Anime / 🤖 Bot con i canali e i permessi (sola lettura dove scrive solo il bot, `#notifiche` visibile solo col ruolo), messaggi di benvenuto, regole e ruoli fissati in alto e primo annuncio. Senza `--apply` stampa solo cosa farebbe. È idempotente e non cancella nulla, tranne i canali predefiniti di Discord con `--rimuovi-predefiniti`. Legge `DISCORD_BOT_TOKEN` e `DISCORD_GUILD_ID` dalle variabili d'ambiente; scrive `server_state.json` (id per riconoscere canali/ruoli/messaggi anche se rinominati) e `discord_ids.env` (id da copiare nelle env di n8n). Per cambiare struttura o testi si modifica lo script e lo si rilancia. I ruoli "gusti" per ora li assegna un admin: la scelta in autonomia arriverà con i pulsanti del bot (Fase 4) o con la dashboard.

**Fase 2 — canali automatici: `python WORKFLOWS/AMICI/build_discord_feed.py`** → `Discord feed (amici).json` (id `amiciDiscordFeed`), ogni 15 minuti più un trigger manuale "Esegui ora". Nessun webhook: si importa da CLI e si pubblica dalla UI, senza riavviare n8n.
- **#attività**: attività AniList (anime e manga) di chi ha acceso "Condividi le mie attività", lette col token di quella persona (funziona anche con profilo privato); voto su 10 quando finisce una serie, link alla scheda sul sito.
- **#news**: news nuove da `anime_news` (massimo 5 per giro). Quelle che citano una serie nella lista di chi condivide le attività (droppate escluse) sono dorate e riportano "⭐ Serie — nella lista di …": le librerie si leggono solo nei giri con news nuove.
- **Thread per episodio in #chiacchiere**: quando esce un episodio di una serie che almeno 2 persone che condividono hanno in corso, messaggio con copertina e "Lo seguono: …" e un thread "<serie> ep. N (spoiler ammessi)" che si archivia dopo 3 giorni. Menzione solo per chi ha le notifiche Discord. Stato `eps` = {mediaId: ultimo episodio uscito}; con meno di 2 persone che condividono le serie in corso non vengono nemmeno lette.
- **#uscite**: il lunedì dalle 9 (ora italiana), una volta a settimana, episodi dei prossimi 7 giorni delle serie in corso/da vedere di chi condivide, per giorno.
- **Anteprima di stagione in #uscite**: da 7 giorni prima dell'inizio (1 gennaio/aprile/luglio/ottobre), dalle 9, una volta per stagione: le 30 serie TV/ONA più attese secondo AniList (popolarità), prima le nuove poi i seguiti, 8 per messaggio, con formato, episodi, data d'inizio, studio, generi, "seguito di" e i ruoli gusti adatti (pillole colorate, nessuna menzione: shonen/seinen/isekai dai tag AniList con rank ≥ 60, gli altri dai generi). Sotto ogni messaggio due menu gestiti dal bot: 📌 *Aggiungi a Da vedere* (anche più serie insieme; quelle già in lista non si toccano) e 📖 *Apri la scheda di…*. Se il workflow è fermo la manda fino a 21 giorni dopo l'inizio. Stato `season` (es. `2026-FALL`).
- **Classifica del mese in #annunci**: il giorno 1 dalle 10 (ora italiana; fino al 7 se il workflow era fermo, poi il mese si salta), per il mese appena finito, tra chi condivide le attività. Dalle attività AniList del mese (token di ciascuno, al massimo 10 pagine da 50): podio per episodi (con ore stimate da `duration`), capitoli manga, serie finite (solo se nello stesso mese ci sono episodi/capitoli o è un film: le liste sistemate in blocco non contano), serie del mese (più persone, poi più episodi), generi del mese, maratona (più episodi in un giorno), totale del gruppo. Nessun messaggio se nessuno ha visto niente. Stato `monthly` (es. `2026-09`).
- Stato in Data Table `anime_discord_stato` (`key`/`value`: `acts`, `newsTs`, `weekly`, `eps`, `season`, `monthly`), salvato prima dell'invio: niente doppioni. Il primo giro (per ogni utente, o a tabella vuota) salva solo il punto di partenza.
- ⚠ Il nome non è `anime_discord`: il "crea se non esiste" delle Data Table n8n va in errore "already exists" quando il nome è l'inizio del nome di un'altra tabella (`anime_discord_utenti`). Mai usare nomi che siano il prefisso di altri.

**Fase 4 — bot Discord: `python WORKFLOWS/AMICI/build_discord_bot.py`** → `Bot Anime Discord.json` (id `amiciDiscordBot1`), webhook `POST /webhook/anime-dashboard/discord/interactions`, impostato come *Interactions Endpoint URL* dell'app (anche via API: `PATCH /applications/@me`). Verifica la firma Ed25519 di Discord (serve `NODE_FUNCTION_ALLOW_BUILTIN=crypto`), risponde entro 3 secondi e fa il lavoro dopo, con `this.helpers.httpRequest` nei nodi Code.
- Pulsanti gusti in #ruoli (`gusto:<key>`, messaggio scritto da `setup_server.py`): aggiungono o tolgono il ruolo.
- Slash command (risposte visibili solo a chi chiede): `/lista`, `/davedere`, `/completati`, `/cerca <testo>` (10 risultati con il tuo stato, menu per aprire la scheda), `/scheda <serie>` (con suggerimenti), `/perte`, `/news`, `/amici`, `/controlla`, `/aiuto`.
- `/perte` ha il menu 🙈 "Non mi interessa…" (con ↩️ Annulla) che scrive in `anime_nascosti`, come sito e Telegram; `/amici` mostra le richieste ricevute con ✅ Accetta / ✖️ Rifiuta (scrive in `anime_amicizie`); `/controlla` lancia subito il workflow delle notifiche (come su Telegram) e dice quanti episodi nuovi ha trovato. Le scritture le fanno nodi Data Table dopo "Esegui": il messaggio si aggiorna solo se la scrittura è riuscita. Scheda con ➖/➕, segna fino all'ultimo uscito, voto (menu), completata/pausa/droppa/inizia/da vedere/riprendi. I comandi si registrano con il ramo manuale "Registra comandi" (comandi di server, attivi subito).

**Fase 3 — notifiche in #notifiche** (in `build_notifiche_v2.py`): chi accende "Notifiche su Discord" nella dashboard riceve gli stessi messaggi delle notifiche v2 anche in #notifiche, con la sua menzione (basta Discord, Telegram non serve). I pulsanti ✅ Visto / ▶️ Inizia / ➕ Da vedere hanno in coda l'id Discord del destinatario (`seen:<id>:<ep>:<discordId>`, `lst:<STATO>:<id>:<discordId>`): se li preme un altro il bot lo avvisa e non tocca niente. Il pulsante usato diventa "✔️ …" e l'esito arriva in un messaggio visibile solo a chi ha cliccato.

**Allarmi in 🛡️┃admin: `python WORKFLOWS/AMICI/build_discord_admin.py`** → `Allarmi Discord (admin).json` (id `amiciDiscordAdm1`). Il canale #admin lo crea `setup_server.py` (accesso `hidden`, lo vede solo il proprietario).
- **Errori**: è l'*Error Workflow* di tutti i workflow del progetto (`settings.errorWorkflow`, impostato con `python WORKFLOWS/AMICI/set_error_workflow.py <workflow.json…>` e già incluso nei generatori di notifiche, feed e bot). Scrive workflow, nodo, messaggio e link all'esecuzione, con la menzione del proprietario; lo stesso errore al massimo una volta all'ora. Ignora il 429 di Telegram quando un bot riattiva il webhook all'avvio di n8n.
- **Controllo salute ogni 30 minuti** (guasti silenziosi): notifiche episodi (`anime_notifiche` aggiornata negli ultimi 45 min, dalle 9 alle 23), feed Discord (`anime_discord_stato`, 45 min), news (`anime_news`, 90 min), webhook Telegram dei due bot (errori con messaggi rimasti in coda). Scrive solo quando qualcosa cambia (⚠️ problema con menzione, poi ✅ risolto). Stato in `anime_discord_stato` (chiavi `errori`, `salute`).
- ⚠ Per provarlo non usare `n8n execute` da riga di comando: in quel processo il modulo Data Table è disattivato e tutte le letture falliscono. Usare il trigger manuale "Controlla ora" dalla UI o aspettare il giro programmato.

## Sigle nella scheda anime

Solo frontend, per tutti (deployato il 2026-09-25; se AnimeThemes è giù la sezione semplicemente non compare): sezione "Sigle" sotto "Dove vederlo", con opening, ending e insert song da AnimeThemes (`api.animethemes.moe`, pubblica, CORS aperto, letta dal browser). Due richieste: prima l'anime AnimeThemes dall'id AniList (`filter[has]=resources&filter[site]=AniList&filter[external_id]=<id>`), poi le sigle di quell'anime per `filter[id]` **senza** `filter[site]`, che altrimenti toglierebbe anche i link Spotify delle canzoni. Per ogni sigla: ▶ ascolto nella scheda (audio .ogg di AnimeThemes; se il browser non lo legge si apre il video), link al brano Spotify (o "Cerca su Spotify" se AnimeThemes non lo conosce), YouTube Music e Apple Music quando ci sono. Il collegamento vero con Spotify (playlist, brani salvati) è stato valutato e scartato il 2026-09-25: l'app in modalità sviluppo accetta al massimo 5 utenti aggiunti a mano ed è troppo scomoda.

## Novità del 2026-09-25

**Serie 18+ nella dashboard (`WORKFLOWS/fix_adult_entries.py`).** `Media(id)` chiamato con il token dell'utente risponde 404 sui titoli isAdult se su AniList i contenuti 18+ sono spenti (verificato con World's End Harem). I nodi `Query voce`, `Dettagli episodio (API)`, `Trova voce (voto)`, `Trova voce (rimuovi)` ora sono nodi Code con lo stesso nome e lo stesso output: `MediaList(userId, mediaId)` col token, se non è in lista `Media(id)` senza token, se AniList fallisce la vecchia query. Nei bot corretto con `WORKFLOWS/AMICI/fix_adult_bot.py` (Telegram: ogni nodo HTTP "X" diventa "X (lista)" con `MediaList(userId, mediaId){… media{…}}` + un Code "X" che rimette il formato di prima; bot personale con `--uid` fisso perché il token sta in una credenziale) e in `build_discord_bot.py` (`cardMedia`). Attenzione: `MediaList(mediaId)` SENZA userId restituisce la voce di un altro utente.

**Che anime è? (trace.moe).** Una foto (o immagine come file) mandata al bot Telegram, o `/scena immagine:` su Discord, viene riconosciuta da [trace.moe](https://trace.moe): serie, episodio, minuto, somiglianza, anteprima del fotogramma e pulsanti "📋 Scheda serie" / "🎬 Guarda la scena". Sotto l'87% propone 3 ipotesi. I risultati 18+ sono scartati. Telegram: `WORKFLOWS/AMICI/add_trace_bot.py` (bot personale e amici; la foto passa da n8n in binario, così a trace.moe non arriva l'URL col token del bot). Discord: comando `scena` (opzione ATTACHMENT) in `build_discord_bot.py`, trace.moe legge direttamente l'URL della CDN Discord. **Limite: piano gratuito di trace.moe = 100 ricerche al mese** (per IP del server); a quota finita il bot lo dice.

**Telegram Mini App.** La dashboard si apre dentro Telegram dal pulsante "Dashboard" accanto alla chat del bot amici (impostato una volta con `setChatMenuButton`) e dai pulsanti "📱" dei messaggi (`WORKFLOWS/AMICI/add_webapp_buttons_bot.py`). Login automatico: `POST /anime-dashboard/telegram/webapp {initData}` (`WORKFLOWS/AMICI/add_tg_webapp_login.py`) controlla la firma HMAC con `ANIME_BOT_TOKEN` (initData di massimo 24 ore), trova l'utente da `anime_utenti.chatId` = id Telegram, ricontrolla la whitelist e crea una sessione di 180 giorni. Errori: `bad_signature`, `expired`, `not_linked`, `relogin`, `not_allowed`. Nel sandbox dei nodi Code non esiste `URLSearchParams`: l'initData si legge a mano. Frontend: `telegram-web-app.js` caricato sempre (fuori da Telegram `initData` è vuoto e non cambia niente), tema "automatico" = tema di Telegram, freccia indietro di Telegram = chiudi scheda/modale, schede con `?anime=<id>` perché l'hash lo usa Telegram.

**Dove guardarlo nei bot e nelle notifiche.** Scheda serie Telegram (`WORKFLOWS/AMICI/add_watch_bot.py`) e Discord (`build_discord_bot.py`): fino a 2 pulsanti "▶️ <sito>" dagli externalLinks STREAMING di AniList, con le priorità di `WATCH_IT` della dashboard. Notifica nuovo episodio (`build_notifiche_v2.py`): pulsante "▶️ <sito>" accanto a "✅ Visto".

**Il tuo anno (Wrapped).** `GET /anime-dashboard/wrapped?year=YYYY[&refresh=1]` (`WORKFLOWS/add_wrapped_endpoint.py`): attività AniList dell'anno (fino a 80 pagine da 50) aggregate come la classifica del mese; cache in Data Table `anime_wrapped_cache` (6 ore per l'anno in corso, 7 giorni per i passati). Dashboard, scheda Statistiche: riquadro "Il tuo anno" (a gennaio e febbraio anche l'anno prima), slide a tutto schermo (ore, serie dell'anno, generi, studio, mesi, record e giorni di fila, prima serie, manga, finite) e "Scarica l'immagine" 1080×1920 (su telefono si apre la condivisione). Discord: in #annunci il 1° gennaio dalle 10 (fino al 7) la classifica dell'anno del gruppo, raccolta mese per mese (`build_discord_feed.py`, stato `yearly`); la raccolta attività e l'embed sono condivisi con la classifica del mese (`gather`, `mergeP`, `rankingEmbed`).

**Trame in italiano.** `WORKFLOWS/trama_js.py` traduce con l'endpoint gratuito di Google Translate (`translate.googleapis.com/translate_a/single?client=gtx`, senza chiave, non ufficiale: se smette di andare resta l'inglese). Dashboard: `GET /anime-dashboard/trama?id=` (`WORKFLOWS/add_trama_endpoint.py`, cache per sempre nella Data Table `anime_trame`, una traduzione per serie per tutti); nella scheda "Tradotta automaticamente · mostra l'originale", scelta ricordata (`VIEW.plotLang`). Bot Telegram (`WORKFLOWS/AMICI/add_trama_bot.py`) e Discord (`build_discord_bot.py`): trama della scheda tradotta, cache nello staticData del workflow (300 trame).

**Compatibilità con gli amici (solo dashboard).** Calcolata nel browser dalle liste pubbliche AniList (le stesse già lette per la scheda Amici, più la tua): voti vicini sulle serie viste da entrambi (se almeno 3 votate da tutti e due), serie in comune rispetto alla lista più corta, e "stesso destino" (non droppata da uno solo). Con pochi voti è "stimata". Percentuale accanto a ogni amico e nel profilo, con "D'accordo su", "Non d'accordo su" e "Da <amico> per te" (serie finite dall'amico che tu non hai visto). Se la tua lista AniList è privata non compare.

**Amici v2 e utenti autorizzati (`WORKFLOWS/AMICI/add_friends_v2.py`).** Nessuno vede più l'elenco dei registrati: `GET /friends` restituisce `others: []` e `me.code`, il codice amico personale (8 caratteri, HMAC dell'id con `ANILIST_CLIENT_SECRET`: stabile e non indovinabile). Si aggiunge un amico con il suo codice, con il suo link d'invito (`…/anime/?amico=CODICE`, la richiesta parte da sola dopo il login) o con il suo nome AniList esatto; `POST /friends/request {id}` vale solo se c'è già un rapporto (per accettare). Le amicizie esistenti sono rimaste. Layout nuovo della scheda: "I tuoi amici" (con compatibilità) e "Aggiungi un amico" affiancati, attività recenti con nome, frase e ora nello stesso blocco di testo.
Whitelist: Data Table `anime_whitelist` (`name`, `status` allow|block, `by`, `ts`) sommata a `ANILIST_ALLOWED_USERS` (allow aggiunge, block toglie anche chi è nella env), letta dai tre ingressi (login AniList, login Discord, Mini App). Amministratori: env `ANIME_ADMINS` (predefinito `spadaccinonero7`), controllo lato server. `GET /admin/users` e `POST /admin/users {action: add|remove, name}`; nella scheda Amici il riquadro "👑 Utenti autorizzati" compare solo agli amministratori. "Togli accesso" = riga block + chiusura delle sessioni + rimozione da `anime_utenti` (bot e notifiche si fermano; le amicizie restano). Un amministratore non si può togliere.

**Insieme agli amici (solo dashboard).** Nel profilo di un amico, "Cosa guardare insieme": serie che state guardando tutti e due (prima quelle dove siete più vicini, con "tu ep. X · lui ep. Y"), serie che lui sta guardando e tu hai in "Da vedere", serie nei "Da vedere" di entrambi (prima quelle già uscite). "Chi è più avanti": badge "N episodi avanti a te / dietro di te / in pari" quando tutti e due la state guardando (in corso, rewatch o pausa), nel riquadro Amici della scheda serie e nel profilo; si aggiorna quando cambi il tuo progresso.

**Consiglia a un amico (`WORKFLOWS/AMICI/add_recommend.py`).** Nella scheda di una serie, riquadro Amici → "💌 Consiglia": scegli gli amici (quelli che ce l'hanno già sono indicati e non spuntati) e un messaggio facoltativo (200 caratteri). `POST /recommend {mediaId, to, msg}`: solo amici accettati, massimo 10 per volta e 30 al giorno; Data Table `anime_consigli` (fromId, toId, mediaId, msg, ts, status). Consegna immediata: bot Telegram amici (copertina, "➕ Da vedere" = `lst:PLANNING:<id>`, "📋 Scheda" = `c:<id>`, "📱 Apri nella dashboard") e #notifiche su Discord con menzione per chi ha le notifiche Discord attive (`lst:PLANNING:<id>:<discordId>`). Chi lo riceve lo trova anche in cima alla scheda Amici, "💌 Consigliati a te", con "➕ Da vedere" e "Ignora" (`GET /recommendations`, `POST /recommendations/dismiss`).
