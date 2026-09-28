# Riepilogo: Dashboard multi-utente per la libreria anime

*Conversazione del 22 settembre 2026*

## Punto di partenza

Esisteva già un pacchetto (`API_Dashboard_Anime.json` + `dashboard.html` + README) che aggiunge una dashboard web parallela al bot Telegram esistente, per gestire la libreria anime su AniList. Il workflow non era ancora stato importato in n8n.

Il bot Telegram esistente (workflow **"Aggiungi serie v2 - sicurezza e pulizia"**, più **"Notifica nuovi episodi"** e **"Controllo webhook Telegram"**) resta invariato: usa un'unica credenziale AniList fissa, un solo chat Telegram, un solo account Gmail per i backup. Non è multi-utente e non doveva diventarlo.

## Obiettivo

Aprire la **dashboard web** (non il bot) a un paio di amici, ognuno con il proprio account AniList, senza toccare il bot Telegram.

## Decisioni prese durante la conversazione

1. **Modello scelto**: ogni amico traccia la propria libreria con il proprio account AniList (non una libreria condivisa, non sola lettura).
2. **Dominio**: `https://homelab.tailec9b6a.ts.net` (Tailscale), reso pubblico tramite **Tailscale Funnel** — necessario perché AniList deve poter reindirizzare il browser dell'amico dopo il login, e un dominio `*.ts.net` privato non sarebbe raggiungibile da chi non è nel tailnet.
3. **Redirect URL OAuth**: `https://homelab.tailec9b6a.ts.net/webhook/anime-dashboard/auth/callback`.
4. **Autenticazione**: login OAuth reale con AniList (non una password condivisa). Whitelist degli username autorizzati tramite variabile d'ambiente, non gestione utenti in un database.
5. **Storage delle sessioni**: dati interni del workflow n8n (`$getWorkflowStaticData`), niente database esterno — sufficiente per pochi utenti.
6. **Livelli di protezione mantenuti**: la vecchia chiave condivisa "Dashboard Access Key" resta come secondo livello su quasi tutti gli endpoint (tranne `/auth/callback`, che deve restare aperto perché è AniList a chiamarlo via redirect del browser).

## Prerequisiti creati dall'utente

- App OAuth registrata su AniList (Client ID + Client Secret).
- Variabili d'ambiente sul container n8n: `ANILIST_CLIENT_ID`, `ANILIST_CLIENT_SECRET` (già impostate durante la conversazione).
- Da impostare ancora: `ANILIST_ALLOWED_USERS` (whitelist, comma-separated, es. `tuoUsername,amico1,amico2`).

## Cosa è stato costruito

### `API_Dashboard_Anime.json` (workflow n8n)
- I 10 endpoint originali (`/library`, `/completed`, `/dropped`, `/paused`, `/upcoming`, `/stats`, `/search`, `/add`, `/progress`, `/status`) sono stati modificati per:
  - richiedere una sessione valida (header `Authorization: Bearer <token>`);
  - usare il token AniList della persona loggata invece di un token fisso;
  - le 6 query di lista non fanno più una chiamata "Chi sono" separata: usano l'id AniList già salvato nella sessione al momento del login.
- Nuovi endpoint aggiunti:
  - `GET /auth/callback` — riceve il redirect da AniList, scambia il codice per un token, verifica la whitelist, crea la sessione, reindirizza al sito.
  - `GET /session` — dice al frontend se la sessione salvata nel browser è ancora valida.
  - `POST /logout` — invalida la sessione.

### `dashboard.html`
- Schermata di login ("Accedi con AniList") mostrata se non si è autenticati.
- Badge con nome/avatar dell'utente loggato e pulsante di logout.
- Nuovo campo "AniList Client ID" nelle impostazioni.
- Ogni chiamata alle API include ora il token di sessione; una risposta 401 riporta automaticamente alla schermata di login.

### `README_Dashboard_Anime.md`
- Istruzioni aggiornate: registrazione app OAuth, nuove variabili d'ambiente, nuovi endpoint, funzionamento del login, limiti noti.

## Limiti noti, dichiarati esplicitamente

- Il token di sessione è generato con un generatore pseudocasuale semplice, non crittografico — adeguato per un piccolo gruppo fidato, non per un servizio esposto su larga scala.
- Nessun controllo anti-CSRF sul parametro `state` dell'OAuth (rischio marginale: non permette comunque di ottenere un token valido senza completare il login vero su AniList).
- Le sessioni vivono nei dati interni del workflow: se il workflow viene ricreato o i suoi dati resettati, tutti dovranno rifare il login (nessun dato AniList viene perso).

## Prossimi passi (lato utente)

1. Impostare `ANILIST_ALLOWED_USERS` come variabile d'ambiente e riavviare il container n8n.
2. Importare `API_Dashboard_Anime.json` in n8n.
3. Creare la credenziale Header Auth "Dashboard Access Key" e assegnarla ai nodi Webhook che la richiedono.
4. Attivare il workflow.
5. Pubblicare `dashboard.html` sullo stesso dominio di n8n (path diverso).
6. Aprire la dashboard, inserire URL base / header / chiave / Client ID nelle impostazioni, e provare il login — prima con il proprio account, poi con quello degli amici in whitelist.

*Nota: il workflow e la dashboard sono stati scritti seguendo la documentazione ufficiale AniList e la struttura del progetto esistente, ma non testati su un'istanza n8n reale — in caso di errori all'import o all'esecuzione, va bene segnalarli per sistemarli.*
