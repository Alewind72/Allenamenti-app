# Allenamenti

Web app (PWA) in italiano per **intervals.icu**, ottimizzata per smartphone Android.
È fatta solo di HTML, CSS e JavaScript: nessun server, nessuna libreria esterna. Funziona su GitHub Pages e si può installare sul telefono come un'app.

## Funzioni

- **Impostazioni**: chiave API e Athlete ID, salvati **solo** nel `localStorage` del telefono. Nel codice non c'è nessuna chiave. Il pulsante «Prova connessione» verifica le credenziali; «Cancella dati» elimina tutto dal dispositivo.
- **Analisi**: scarica le attività degli ultimi 30 giorni e mostra:
  - durata, distanza, potenza media, frequenza cardiaca media e massima, carico totale;
  - grafico del carico giornaliero;
  - fitness (CTL), fatica (ATL) e forma (TSB), presi dai dati wellness;
  - tempo nelle zone di potenza e cardio;
  - elenco delle attività.
  Gli ultimi dati scaricati restano in cache, così si vedono anche offline.
- **Crea allenamento**: editor di allenamenti in bici a zone (Z1–Z7, sweet spot, % FTP, rampe) con ripetute, profilo grafico, durata e carico stimato. Ci sono modelli pronti (Z2, tempo, sweet spot, soglia, VO2max, 30/30). L'allenamento viene caricato nel calendario di intervals.icu con `POST /api/v1/athlete/{id}/events` e il formato testo del workout builder di intervals.icu, quindi lo puoi sincronizzare su Garmin, Wahoo, Zwift, ecc.

## Dove trovo chiave API e Athlete ID

Su [intervals.icu](https://intervals.icu): **Settings → Developer Settings**. Lì trovi l'Athlete ID (inizia con `i`, es. `i123456`) e puoi generare la chiave API.
L'app si autentica con Basic Auth: username `API_KEY`, password = la tua chiave.

## Attivare GitHub Pages

1. Su GitHub apri il repository e vai su **Settings → Pages**.
2. In **Build and deployment → Source** scegli **Deploy from a branch**.
3. In **Branch** seleziona il branch con i file dell'app (es. `main`) e la cartella **`/ (root)`**, poi **Save**.
4. Dopo 1–2 minuti l'app è online su `https://<tuo-utente>.github.io/<nome-repository>/`. L'indirizzo esatto compare in cima alla pagina Settings → Pages.

> Per un repository privato GitHub Pages richiede un piano a pagamento. In alternativa puoi rendere pubblico il repository: le chiavi non sono nel codice, quindi non vengono esposte.

## Installare l'app su Android

1. Apri l'indirizzo di GitHub Pages con **Chrome**.
2. Menu **⋮ → Installa app** (oppure **Aggiungi a schermata Home**).
3. Apri l'app dall'icona, vai su **Impostazioni**, inserisci chiave API e Athlete ID e premi **Salva**.

## Struttura

```
index.html            pagina unica con le tre sezioni
css/style.css         stile (tema scuro, layout mobile)
js/api.js             client intervals.icu (Basic Auth, credenziali da localStorage)
js/charts.js          grafici SVG
js/workout.js         modello allenamenti, modelli pronti, conversione in testo intervals.icu
js/app.js             interfaccia e navigazione
sw.js                 service worker (uso offline; le chiamate API non vanno mai in cache)
manifest.webmanifest  manifest PWA
icons/                icone
```

## Aggiornamenti

Dopo aver modificato i file, cambia il nome della cache in `sw.js` (es. `allenamenti-v2`), così i telefoni scaricano la nuova versione.

## Note sulla privacy

- La chiave API viene inviata solo a `intervals.icu` tramite HTTPS.
- Chi ha accesso fisico al telefono sbloccato potrebbe leggere il `localStorage` del browser. Usa «Cancella dati» se presti il dispositivo, e rigenera la chiave su intervals.icu se pensi che sia stata compromessa.
