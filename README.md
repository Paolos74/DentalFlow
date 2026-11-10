# DentalFlow

Progressive Web App per igienista dentale: registra pazienti e incassi per giorno, studio e trattamento, mostra riepiloghi e grafici ed esporta il CSV da confrontare con gli studi. Funziona offline, si installa sul telefono e non richiede account.

Sito statico in HTML, CSS e JavaScript, senza build e senza librerie esterne.

## Cos'è DentalFlow

| Sezione | Cosa fa |
|---|---|
| **Oggi** | Schermata iniziale: saluto, recap del mese (incasso, pazienti, giorni, confronto con lo stesso punto del mese scorso, trattamenti principali), in quale studio lavori oggi con "Inserisci la giornata", azioni rapide, giorni **da compilare** (previsti dal calendario negli ultimi 30 giorni e senza dati: un tocco apre Inserisci, ⋯ → "Non ho lavorato"; le prime 3 e poi "Mostra tutti"), prossimi giorni di lavoro, promemoria backup. |
| **Inserisci** | Data con scorciatoie Oggi / Ieri e frecce, studio con un tocco (lo studio previsto dal calendario è già selezionato, "da calendario"). Nella lista compaiono **solo i trattamenti della giornata**: **Aggiungi trattamento** apre l'elenco dei trattamenti dello studio (in ordine d'uso, con ricerca se sono più di 6, e "Altri trattamenti o nuovo…"); il trattamento parte da 1 paziente con il cursore sull'incasso. La **✕** toglie una riga non salvata o elimina subito una riga salvata, con "Annulla". Appena i pazienti sono più di 0 compare l'**importo totale** (es. 13/02/2026, Igiene dentale, 7 pazienti, 210 €). Una giornata già registrata si riapre con i valori salvati; "+ Altra riga" per una seconda riga dello stesso trattamento. Nota facoltativa sulla giornata. |
| **Registro** | Vista **Elenco** per giornata (data, studio, totale, nota) e vista **Mese** con i giorni registrati, il segno rosso sui giorni previsti senza dati e la nota. Ogni inserimento è modificabile in ogni campo ed eliminabile; "Modifica giornata" sposta o elimina un'intera giornata. Dopo un'eliminazione c'è **Annulla**. |
| **Recap → Numeri** | Periodo a frecce (mese, anno, tutto, personalizzato), uno studio o tutti: incasso, pazienti, giorni lavorati, medie per paziente e per giornata con confronto col periodo precedente; card **Da incassare** calcolata su tutti i mesi con inserimenti fino a oggi, qualunque sia il periodo mostrato (totale e mesi non pagati per studio); una riga per studio con quota e da incassare (toccandola: CSV del periodo, Incassi, solo questo studio); foglio **Incassi** di uno studio con tutti i suoi mesi, prima quelli da incassare e poi quelli pagati; trattamenti; giornate previste e mancanti; "Il tuo anno". |
| **Recap → Esporta CSV** | Scegli il periodo (di base il mese scorso) e **i singoli studi**: un file per studio con colonne `Data`, `Trattamento`, `Numero pazienti`, `Costo trattamento (€)`, date `GG/MM/AAAA` e virgola decimale. Facoltativo: un CSV unico di tutti gli studi con la colonna `Studio`. Due formati: *virgola* (Numbers, Google Fogli, anteprima dell'iPhone) ed *Excel in italiano* (punto e virgola, da scegliere per i file da aprire con Excel sul computer); il foglio lo ricorda accanto alla scelta. Con un solo file il download parte subito; con più file si apre il foglio **File CSV pronti**, con *Scarica* e *Condividi* per ogni file e *Condividi tutti* dove il telefono lo permette. |
| **Recap → Grafici** | Peso dei trattamenti (incasso, pazienti o €/paziente, scelti tra i filtri) e andamento nel tempo totale, per trattamento o **per studio**, con il confronto con l'anno prima per vedere la stagionalità. Raggruppamento per giorno, settimana, mese o anno. |
| **Recap → Tasse** | Stima del **regime forfettario** per anno solare: compensi (pagati e da incassare, per data della prestazione) + marche da bollo addebitate, reddito al 78 %, contributi INPS Gestione Separata (26,07 % o 24 %), imposta sostitutiva (5 % predefinito; con la **data di apertura della partita IVA** diventa automatica: 5 % nell'anno di apertura e nei 4 successivi, poi 15 %), netto, peso in percentuale sul reddito e sui ricavi, quota da mettere da parte e media al mese, scadenze dell'anno dopo (30 giugno: saldo + 1° acconto; 30 novembre: 2° acconto). Nelle scadenze puoi inserire le **tasse vere dell'anno prima** (imposta e contributi, dalla dichiarazione o dagli F24): gli acconti già versati si calcolano da quelle invece che dalla stima. Avvisi oltre 85.000 € e 100.000 €. **Parametri** modificabili (anche una percentuale fissa "da mettere da parte", es. 32 %: i numeri in alto usano quella, il calcolo con le regole resta sotto per confronto), salvati nell'account: con la sincronizzazione valgono su tutti i dispositivi, ed entrano nel backup. La marca da bollo si spunta in **Incassi**, sotto il mese pagato, quando lo studio ti ha pagato anche i 2 € (fatture oltre 77,47 €). È una stima: va confermata dal commercialista. |
| **Altro → Calendario di lavoro** | Vista del mese con i giorni di lavoro di tutti gli studi (filtro per studio). Giorni singoli, anche più giorni insieme; ogni giorno singolo si modifica (studio, data, orario) o si elimina. "Togli questo giorno" per un giorno in cui non lavori: le altre date restano. Le ripetizioni **non** si impostano qui ma nella scheda dello studio. Menu ⋯ → esportazione `.ics` per il calendario del telefono. |
| **Altro → Studi / Trattamenti** | Studi con colore, giorni di lavoro e trattamenti offerti (Offerto / Archiviato / Non offerto). Nella scheda dello studio, **Giorni di lavoro**: le ripetizioni (ogni settimana, anche ogni N settimane, con più giorni nella stessa ripetizione e **un orario diverso per ogni giorno**, es. lunedì 9–13 e mercoledì 14–19; ogni mese per data o per posizione; ogni anno; fine mai, fino a una data o dopo N volte) e i **prossimi giorni**, ognuno con "Togli" per eliminare solo quella giornata. **Archivia** (i dati restano) oppure **Elimina definitivamente** (con doppia conferma). |
| **Altro → Note** | Note libere su cose da ricordare: **+** per una nuova nota, un tocco per modificarla, "Elimina nota" con **Annulla**. La prima riga fa da titolo; la più recente in alto. Si sincronizzano ed entrano nel backup. |
| **Altro → Backup e ripristino** | Esporta e importa tutti i dati (calendario, note e incassi compresi) in un file JSON. Prima di un'importazione l'app salva una copia dei dati attuali, ripristinabile; quando non serve più, **Elimina la copia** la cancella. |
| **Altro → Sincronizzazione** | Facoltativa, con Firebase gratuito (vedi sotto). Disattivata finché non la configuri. |
| **Altro → Aspetto** | Tema Automatico, Chiaro o Scuro. |

I vecchi indirizzi (`#riepilogo`, `#grafici`, `#gestione`) portano alle nuove sezioni.

Gli importi sono gestiti in centesimi interi, così i totali sono sempre esatti.

## Pubblicare su GitHub Pages

1. Su GitHub crea un repository **pubblico** (GitHub Pages gratuito richiede un repository pubblico), ad esempio `dentalflow`.
2. Carica il **contenuto** della cartella `igienista-pwa/` nella radice del repository (pulsante *Add file → Upload files*, trascinando file e cartelle).
   - **Non caricare la cartella `.agents/`**: contiene solo file di lavoro dello sviluppo, non fa parte dell'app.
   - Le cartelle `tests/` e `tools/` e il file `package.json` sono facoltativi: servono solo per i test e per rigenerare le icone.
   - Il file `.nojekyll` (vuoto) evita l'elaborazione Jekyll. Finder ed Esplora risorse nascondono i file che iniziano con il punto, quindi il caricamento web potrebbe saltarlo: puoi crearlo con *Add file → Create new file*, nome `.nojekyll`, contenuto vuoto. Per questa app è comunque facoltativo, perché nessun percorso inizia con `_`.
3. Vai in **Settings → Pages**. In *Build and deployment* scegli *Deploy from a branch*, branch `main`, cartella `/ (root)`, poi *Save*.
4. Dopo uno o due minuti l'app è su `https://<utente>.github.io/<repo>/`.

Tutti i percorsi dell'app sono relativi, quindi funziona anche dentro la sotto-cartella `/<repo>/`.

## Installare l'app

- **Android / Chrome (anche desktop)**: apri il sito, poi *Altro → Installa app* oppure il menu del browser → *Installa app* / *Aggiungi a schermata Home*.
- **iPhone / iPad (Safari)**: pulsante *Condividi* → *Aggiungi alla schermata Home*.

L'app installata si apre a schermo intero, come un'app normale.

## Provare l'offline

1. Apri il sito una volta con la connessione attiva (al primo avvio l'app salva i suoi file sul dispositivo).
2. Attiva la modalità aereo.
3. Riapri l'app (o ricarica la pagina): funziona e mostra i tuoi dati. In alto compare il badge "Offline".

I dati sono sempre salvati sul dispositivo, quindi puoi inserire anche senza connessione.

## Aggiornamenti

Quando pubblichi una nuova versione, cambia la riga `const VERSION = 'dentalflow-v21';` in `sw.js` (es. `dentalflow-v22`). Al prossimo avvio l'app mostra l'avviso **"Nuova versione"** sopra la barra delle schede. Il pulsante **Aggiorna** carica la nuova versione. L'app non si ricarica mai da sola, così non perdi un inserimento a metà.

## Backup

- *Altro → Backup e ripristino → Esporta backup* scarica `DentalFlow-backup-AAAA-MM-GG.json`.
- *Importa backup* sostituisce tutti i dati attuali con quelli del file, dopo una conferma. Un backup della prima versione (senza calendario) lascia il calendario com'è.
- Dopo un'importazione la copia dei dati di prima resta in *Backup e ripristino*: **Ripristina la copia di prima** la rimette, **Elimina la copia** la cancella.
- Se l'ultimo backup ha più di 14 giorni e hai modificato i dati, la schermata Oggi te lo ricorda.
- I dati vivono nel browser del dispositivo: se cancelli i dati del sito o disinstalli il browser, si perdono. **Esporta un backup regolarmente** (ad esempio ogni mese) e conservalo, per esempio nel cloud o via email.

## Sincronizzazione con Firebase (gratuita, facoltativa)

> **Non testata in questo ambiente di sviluppo**: i server Firebase non erano raggiungibili. La logica è coperta solo da test automatici con un Firebase simulato. L'app funziona completamente anche senza.

Serve solo se vuoi gli stessi dati su più dispositivi. Usa il piano gratuito **Spark** di Firebase.

1. Vai su [console.firebase.google.com](https://console.firebase.google.com), crea un progetto (piano Spark, nessuna carta richiesta; Google Analytics può restare disattivato).
2. Nel progetto aggiungi un'app **Web** (icona `</>`), senza Firebase Hosting. Dalla configurazione mostrata copia `apiKey` e `projectId`.
3. **Authentication** → *Inizia* → *Metodo di accesso* → abilita **Email/password**. Poi *Users* → *Add user*: crea il tuo utente (email e password).
4. **Firestore Database** → *Crea database* → modalità produzione, località in Europa. Poi scheda **Regole**, incolla queste regole e premi *Pubblica*:

   ```
   rules_version = '2';
   service cloud.firestore {
     match /databases/{database}/documents {
       match /users/{uid}/records/{recordId} {
         allow read, write: if request.auth != null && request.auth.uid == uid;
       }
     }
   }
   ```

5. Facoltativo: in Google Cloud Console → *API e servizi → Credenziali*, limita la chiave API ai referrer `https://<utente>.github.io/*`.
6. Facoltativo: nelle impostazioni di Authentication disattiva la creazione di nuovi utenti, se l'opzione è disponibile.
7. Nell'app: *Altro → Sincronizzazione* → incolla API key e Project ID, inserisci email e password → **Accedi e sincronizza**. Ripeti sugli altri dispositivi con gli stessi dati.

Note:
- Quote gratuite: vedi [firebase.google.com/pricing](https://firebase.google.com/pricing) e [firebase.google.com/docs/firestore/pricing](https://firebase.google.com/docs/firestore/pricing). L'uso di una sola persona resta molto sotto i limiti gratuiti.
- Sicurezza: la API key di Firebase non è segreta (identifica solo il progetto); i dati sono protetti dalle regole qui sopra. La password non viene salvata; sul dispositivo resta un token di accesso (refresh token) nel browser.
- In caso di modifiche dello stesso dato da due dispositivi vince la più recente.
- **Disconnetti** mantiene i dati locali. Gli elementi eliminati mentre sei disconnesso possono ricomparire dopo la riconnessione, perché la copia online li ha ancora: eliminali di nuovo dopo la sincronizzazione.

## Test automatici

Servono solo per lo sviluppo. Con Node.js 22 o superiore (nessuna installazione di pacchetti):

```
node --test tests/*.test.js
```

Per rigenerare le icone (solo Python, nessuna libreria esterna): `python3 tools/make_icons.py`.

## Verifica con Lighthouse

Dopo la pubblicazione apri il sito in Chrome → *Strumenti per sviluppatori* (F12) → scheda **Lighthouse** → seleziona *Progressive Web App* (se presente) e *Performance* → *Analyze page load*. Nelle versioni recenti di Chrome la categoria PWA non c'è più: l'installabilità si controlla in *Strumenti per sviluppatori → Application → Manifest* (sezione "Installability") e *Application → Service workers*. Nell'ambiente di sviluppo Lighthouse non era disponibile.
