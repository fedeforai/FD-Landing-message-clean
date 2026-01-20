# Debug: AI Non Risponde

## Problema
L'AI non risponde ai messaggi inviati dalla landing page.

## Logging Aggiunto

Ho aggiunto logging dettagliato in 3 punti del flusso:

### 1. Server-side (`/api/ingest.js`)
- Log del payload inviato all'Orchestrator
- Log della risposta ricevuta dall'Orchestrator
- Verifica presenza di `replyText` nella risposta

### 2. Client API (`lib/api.js`)
- Log della risposta ricevuta da `/api/ingest`
- Verifica presenza di `replyText` e `handoff_to_human`

### 3. Client UI (`pages/index.js`)
- Log della gestione della risposta nel componente
- Verifica se `replyText` viene aggiunto alla chat

## Come Diagnosticare

### Step 1: Controlla i Log del Browser
1. Apri la console del browser (F12)
2. Invia un messaggio
3. Cerca questi log:
   - `[API] Response from /api/ingest:` - Mostra cosa riceve il client dal proxy
   - `[CLIENT] Message response:` - Mostra come viene gestita la risposta
   - `[CLIENT] Adding AI reply to chat:` - Conferma che il messaggio AI viene aggiunto

### Step 2: Controlla i Log di Vercel
1. Vai su Vercel Dashboard
2. Seleziona il progetto
3. Vai su "Functions" > `/api/ingest`
4. Cerca questi log:
   - `[INGEST] Sending to Orchestrator:` - Mostra il payload inviato
   - `[INGEST] Orchestrator response:` - Mostra la risposta ricevuta

### Step 3: Verifica il Payload
Il payload inviato all'Orchestrator deve includere:
```json
{
  "channel": "landing",
  "external_thread_id": "...",
  "instructor_id": "...",
  "text": "...",
  "idempotency_key": "...",
  "trace_id": "...",
  "external_message_id": "...",
  "channel_metadata": {
    "client_name": "...",
    "phone": "..."
  }
}
```

### Step 4: Verifica la Risposta dell'Orchestrator
L'Orchestrator deve rispondere con:
```json
{
  "ok": true,
  "conversation_id": "...",
  "trace_id": "...",
  "replyText": "Risposta dell'AI qui...",
  "handoff_to_human": false
}
```

## Possibili Cause

### 1. Orchestrator non restituisce `replyText` (PIÙ PROBABILE)
- **Sintomo**: Log mostra `has_replyText: false`
- **Causa**: L'Orchestrator crea un task per Make ma NON genera una risposta immediata
- **Problema**: Il flusso è asincrono (Orchestrator → Task → Make → Risposta), ma la Landing si aspetta `replyText` nella risposta immediata
- **Soluzione**: 
  - **Opzione A**: L'Orchestrator deve generare una risposta immediata (sincrona) prima di creare il task
  - **Opzione B**: Implementare polling o webhooks nella Landing per ricevere la risposta asincrona
  - **Opzione C**: Make deve inviare la risposta immediatamente dopo la generazione (non asincrono)

### 2. Payload non corretto
- **Sintomo**: Log mostra errori 400 o 500 dall'Orchestrator
- **Causa**: Il payload non rispetta il formato atteso
- **Soluzione**: Verifica che tutti i campi richiesti siano presenti

### 3. Variabili d'ambiente mancanti
- **Sintomo**: Log mostra errori 500 o "Missing config"
- **Causa**: `SUPABASE_URL` o `FD_INGEST_KEY` non configurati su Vercel
- **Soluzione**: Verifica le variabili d'ambiente su Vercel

### 4. Timeout dell'Orchestrator
- **Sintomo**: Log mostra timeout dopo 30 secondi
- **Causa**: L'Orchestrator impiega troppo tempo a rispondere
- **Soluzione**: Verifica le performance dell'Orchestrator e del Make scenario

### 5. Errore nella gestione della risposta
- **Sintomo**: Log mostra `has_replyText: true` ma il messaggio non appare
- **Causa**: Bug nella logica di rendering del messaggio AI
- **Soluzione**: Verifica la logica in `pages/index.js` alla riga ~347

## Checklist di Verifica

- [ ] Variabili d'ambiente configurate su Vercel:
  - [ ] `SUPABASE_URL`
  - [ ] `FD_INGEST_KEY`
- [ ] Orchestrator (Supabase Edge Function) deployato e funzionante
- [ ] Make scenario configurato e attivo
- [ ] Payload include tutti i campi richiesti
- [ ] Risposta dell'Orchestrator include `replyText`
- [ ] Log mostrano il flusso completo senza errori

## Prossimi Passi

1. **Invia un messaggio e controlla i log**:
   - Browser console: `[CLIENT] Message response:` - Verifica se `has_replyText: false`
   - Vercel logs: `[INGEST] Orchestrator response:` - Verifica se l'Orchestrator restituisce `replyText`

2. **Verifica il flusso asincrono**:
   - L'Orchestrator crea un task per Make?
   - Make processa il task e invia la risposta?
   - La risposta arriva tramite `ingest-inbound` chiamato da Make?

3. **Soluzione immediata**:
   - Se l'Orchestrator non restituisce `replyText` immediatamente, la Landing mostra "Your instructor will reply soon"
   - Questo è il comportamento atteso se il flusso è completamente asincrono

4. **Soluzione a lungo termine**:
   - Implementare polling nella Landing per controllare nuovi messaggi
   - Oppure implementare webhooks per notificare la Landing quando la risposta è pronta
   - Oppure modificare l'Orchestrator per generare una risposta immediata (sincrona)

## Nota Importante

**Il flusso attuale è asincrono:**
- Landing → Orchestrator → Crea Task → Make processa → Make invia risposta
- La Landing NON riceve `replyText` nella risposta immediata
- La risposta arriva quando Make chiama `ingest-inbound` di nuovo

**Per avere risposte immediate:**
- L'Orchestrator deve generare `replyText` prima di creare il task
- Oppure implementare un meccanismo di polling/webhook nella Landing
