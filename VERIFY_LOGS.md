# Guida: Verifica Log per Diagnostica AI Reply

## Step 1: Verifica Log del Browser

1. **Apri la Landing Page** in produzione o sviluppo
2. **Apri la Console del Browser** (F12 → Console tab)
3. **Invia un messaggio** dalla chat
4. **Cerca questi log** nell'ordine:

### Log Attesi:

```
[API] Response from /api/ingest: {
  ok: true/false,
  has_replyText: true/false,
  replyText: "..." o null,
  handoff_to_human: true/false,
  conversation_id: "...",
  trace_id: "...",
  status: 200
}
```

```
[CLIENT] Message response: {
  ok: true/false,
  has_replyText: true/false,
  replyText: "..." o null,
  handoff_to_human: true/false,
  conversation_id: "...",
  trace_id: "..."
}
```

```
[CLIENT] Adding AI reply to chat: "..."  // Solo se has_replyText: true
```

oppure

```
[CLIENT] No replyText received, showing waiting message  // Se has_replyText: false
```

### Cosa Cercare:

- ✅ **Se `has_replyText: true`**: L'Orchestrator ha restituito una risposta
- ❌ **Se `has_replyText: false`**: L'Orchestrator NON ha restituito `replyText`
- ⚠️ **Se `ok: false`**: C'è un errore (controlla `error` e `statusCode`)

---

## Step 2: Verifica Log di Vercel

1. **Vai su Vercel Dashboard**: https://vercel.com/dashboard
2. **Seleziona il progetto**: `fd-landing-message-clean`
3. **Vai su "Functions"** → `/api/ingest`
4. **Clicca su "View Logs"** o "Real-time Logs"
5. **Invia un messaggio** dalla landing
6. **Cerca questi log**:

### Log Attesi:

```
[INGEST] Sending to Orchestrator: {
  edgeFunctionUrl: "https://...supabase.co/functions/v1/ingest-inbound",
  payload: {
    channel: "landing",
    external_thread_id: "...",
    instructor_id: "...",
    text_length: 123,
    has_idempotency_key: true,
    has_channel_metadata: true,
    trace_id: "...",
    external_message_id: "..."
  }
}
```

```
[INGEST] Orchestrator response: {
  trace_id: "...",
  has_replyText: true/false,
  replyText_length: 123 o 0,
  conversation_id: "...",
  handoff_to_human: true/false,
  response_keys: ["ok", "trace_id", "conversation_id", ...]
}
```

### Cosa Cercare:

- ✅ **Se `has_replyText: true`**: L'Orchestrator ha restituito `replyText`
- ❌ **Se `has_replyText: false`**: L'Orchestrator NON ha restituito `replyText`
- ⚠️ **Se vedi errori**: Controlla il messaggio di errore e lo status code

---

## Step 3: Verifica Log di Supabase (Orchestrator)

1. **Vai su Supabase Dashboard**: https://supabase.com/dashboard
2. **Seleziona il progetto**
3. **Vai su "Edge Functions"** → `ingest-inbound`
4. **Clicca su "Logs"**
5. **Filtra per `trace_id`** (dal log di Vercel)
6. **Cerca**:
   - Creazione del task
   - Eventuali errori
   - Risposta inviata

### Cosa Cercare:

- ✅ **Task creato**: `INSERT INTO tasks ...`
- ❌ **Errori**: Qualsiasi errore durante l'elaborazione
- ⚠️ **Risposta**: Se l'Orchestrator restituisce `replyText` nella risposta

---

## Step 4: Verifica Make Scenario

1. **Vai su Make Dashboard**: https://www.make.com/
2. **Apri lo scenario** che processa i task
3. **Controlla l'execution history**
4. **Cerca**:
   - Task ricevuto?
   - Context recuperato?
   - OpenAI chiamato?
   - Risposta inviata?

### Cosa Cercare:

- ✅ **Task processato**: Lo scenario ha ricevuto e processato il task
- ✅ **Risposta inviata**: Make ha chiamato `ingest-inbound` con la risposta
- ❌ **Errori**: Qualsiasi errore nello scenario

---

## Interpretazione dei Risultati

### Scenario 1: `has_replyText: false` in tutti i log
**Problema**: L'Orchestrator non restituisce `replyText` immediatamente
**Causa**: Il flusso è asincrono (Orchestrator → Task → Make → Risposta)
**Soluzione**: Modificare l'Orchestrator per generare risposta immediata (vedi prompt Cursor)

### Scenario 2: `has_replyText: true` nei log Vercel ma `false` nel browser
**Problema**: La risposta viene persa tra server e client
**Causa**: Bug nella propagazione della risposta
**Soluzione**: Verifica il codice in `pages/api/ingest.js` e `lib/api.js`

### Scenario 3: Errori 500 o timeout
**Problema**: L'Orchestrator non risponde o fallisce
**Causa**: Configurazione errata o errore nell'Orchestrator
**Soluzione**: Verifica variabili d'ambiente e log di Supabase

### Scenario 4: Errori 401 o 403
**Problema**: Autenticazione fallita
**Causa**: `FD_INGEST_KEY` non corrisponde o mancante
**Soluzione**: Verifica variabili d'ambiente su Vercel e Supabase

---

## Checklist Rapida

- [ ] Browser console mostra `[CLIENT] Message response:`
- [ ] Vercel logs mostrano `[INGEST] Orchestrator response:`
- [ ] `has_replyText` è `true` o `false`?
- [ ] Se `false`, l'Orchestrator crea un task?
- [ ] Make processa il task?
- [ ] Make invia la risposta?
- [ ] La risposta arriva alla Landing?

---

## Prossimi Passi

1. **Raccogli i log** da browser, Vercel e Supabase
2. **Identifica dove si interrompe il flusso**
3. **Usa il prompt Cursor** per sincronizzare l'Orchestrator se necessario
4. **Testa di nuovo** dopo le modifiche
