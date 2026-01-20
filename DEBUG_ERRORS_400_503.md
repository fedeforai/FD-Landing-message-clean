# Debug: Errori 400 e 503

## Problema
La console mostra errori 400 (Bad Request) e 503 (Service Unavailable) su `/api/ingest`.

## Logging Migliorato

Ho aggiunto logging dettagliato in 3 punti:

### 1. Client-side (`pages/index.js`)
- **Log prima di inviare**: Mostra tutti i campi del payload
- **Validazione**: Controlla che tutti i campi richiesti siano presenti

### 2. Server-side (`pages/api/ingest.js`)
- **Log validazione**: Mostra esattamente quale campo fallisce e perché
- **Log environment**: Verifica che le variabili d'ambiente siano presenti
- **Log payload**: Mostra il payload completo prima di inviarlo all'Orchestrator
- **Log errori upstream**: Dettagli completi degli errori dall'Orchestrator

### 3. API Client (`lib/api.js`)
- **Log errori dettagliati**: Mostra status, error_code, e messaggio completo
- **Log 400 specifici**: Dettagli aggiuntivi per errori di validazione

---

## Come Diagnosticare

### Step 1: Apri Browser Console (F12)

Cerca questi log quando invii un messaggio:

#### ✅ Log Attesi (Successo):
```
[CLIENT] Sending message payload: {
  external_thread_id: "...",
  instructor_id: "...",
  text_length: 123,
  has_idempotency_key: true,
  trace_id: "...",
  ...
}
```

#### ❌ Log di Errore 400:
```
[API] 400 Bad Request details: {
  error: "Invalid or missing channel. Must be 'landing', got: undefined",
  error_code: "INVALID_CHANNEL",
  trace_id: "...",
  ...
}
```

#### ❌ Log di Errore 503:
```
[API] Request failed: {
  status: 503,
  error: "Service temporarily unavailable...",
  ...
}
```

---

### Step 2: Verifica Vercel Logs

1. Vai su Vercel Dashboard → Functions → `/api/ingest`
2. Cerca questi log:

#### ✅ Log Validazione (Successo):
```
[INGEST] Validating payload: {
  has_channel: true,
  channel_value: "landing",
  has_external_thread_id: true,
  has_instructor_id: true,
  has_text: true,
  ...
}
```

#### ❌ Log Validazione (Fallimento):
```
[INGEST] Validation failed: INVALID_CHANNEL {
  channel: undefined,
  trace_id: "..."
}
```

#### ❌ Log Environment (Fallimento):
```
[INGEST] Missing SUPABASE_URL environment variable
```

#### ❌ Log Upstream Error (503):
```
[INGEST] Upstream error: {
  status: 503,
  statusText: "Service Unavailable",
  error: "...",
  edgeFunctionUrl: "https://...supabase.co/functions/v1/ingest-inbound",
  ...
}
```

---

## Cause Comuni

### 1. Errore 400: Campo Mancante o Invalido

**Sintomo**: Log mostra `[INGEST] Validation failed: INVALID_*`

**Possibili Cause**:
- `channel` non è `"landing"` o è `undefined`
- `external_thread_id` è `undefined` o non è una stringa
- `instructor_id` è `undefined` o non è una stringa
- `text` è vuoto o non è una stringa

**Soluzione**:
1. Controlla il log `[CLIENT] Sending message payload:` per vedere cosa viene inviato
2. Verifica che tutti i campi siano presenti e corretti
3. Controlla che `threadId` e `selectedInstructorId` siano salvati in `localStorage`

### 2. Errore 400: Variabili d'Ambiente Mancanti

**Sintomo**: Log mostra `[INGEST] Missing SUPABASE_URL` o `[INGEST] Missing FD_INGEST_KEY`

**Soluzione**:
1. Vai su Vercel Dashboard → Settings → Environment Variables
2. Verifica che siano presenti:
   - `SUPABASE_URL`
   - `FD_INGEST_KEY`
3. Se mancano, aggiungili e ri-deploy

### 3. Errore 503: Orchestrator Non Disponibile

**Sintomo**: Log mostra `[INGEST] Upstream error: { status: 503 }`

**Possibili Cause**:
- L'Orchestrator (Supabase Edge Function) è down
- L'Orchestrator è sovraccarico
- Timeout della connessione
- URL dell'Orchestrator errato

**Soluzione**:
1. Verifica che `SUPABASE_URL` sia corretto su Vercel
2. Controlla i log di Supabase Edge Functions per vedere se ci sono errori
3. Verifica che l'Edge Function `ingest-inbound` sia deployata e attiva
4. Controlla che `FD_INGEST_KEY` corrisponda a quello configurato nell'Orchestrator

### 4. Errore 503: Timeout

**Sintomo**: Nessuna risposta dopo 30 secondi

**Possibili Cause**:
- L'Orchestrator impiega troppo tempo a rispondere
- Make scenario è lento
- OpenAI API è lenta

**Soluzione**:
- Verifica i log di Supabase per vedere dove si blocca
- Considera di aumentare il timeout (attualmente 30s) se necessario
- Verifica che Make scenario sia configurato correttamente

---

## Checklist di Diagnostica

### Client-side:
- [ ] `[CLIENT] Sending message payload:` mostra tutti i campi?
- [ ] `threadId` è presente in `localStorage`?
- [ ] `selectedInstructorId` è presente in `localStorage`?
- [ ] `trace_id` viene generato?

### Server-side (Vercel):
- [ ] `[INGEST] Validating payload:` mostra tutti i campi come `true`?
- [ ] `[INGEST] Environment check passed` appare?
- [ ] `[INGEST] Sending to Orchestrator:` mostra il payload completo?
- [ ] `[INGEST] Orchestrator response:` mostra una risposta?

### Orchestrator (Supabase):
- [ ] Edge Function `ingest-inbound` è deployata?
- [ ] Log di Supabase mostrano richieste in arrivo?
- [ ] Log di Supabase mostrano errori?
- [ ] `FD_INGEST_KEY` corrisponde tra Vercel e Supabase?

---

## Prossimi Passi

1. **Invia un messaggio** e controlla i log nel browser console
2. **Identifica l'errore specifico** (400 o 503)
3. **Segui la sezione "Cause Comuni"** corrispondente
4. **Verifica i log di Vercel** per dettagli aggiuntivi
5. **Se necessario, verifica i log di Supabase** per errori dell'Orchestrator

---

## Esempio di Log Completo (Successo)

```
[CLIENT] Sending message payload: {
  external_thread_id: "thread_123",
  instructor_id: "instr_456",
  text_length: 50,
  has_idempotency_key: true,
  trace_id: "trc_...",
  ...
}

[INGEST] Validating payload: {
  has_channel: true,
  channel_value: "landing",
  has_external_thread_id: true,
  ...
}

[INGEST] Environment check passed: {
  has_supabase_url: true,
  has_fd_ingest_key: true,
  ...
}

[INGEST] Sending to Orchestrator: {
  payload: { ... }
}

[INGEST] Orchestrator response: {
  status: 200,
  has_replyText: true,
  replyText_length: 150,
  ...
}

[API] Response from /api/ingest: {
  ok: true,
  has_replyText: true,
  ...
}
```

---

## Esempio di Log Completo (Errore 400)

```
[CLIENT] Sending message payload: {
  external_thread_id: "thread_123",
  instructor_id: undefined,  // ❌ PROBLEMA
  ...
}

[INGEST] Validating payload: {
  has_instructor_id: false,  // ❌ PROBLEMA
  ...
}

[INGEST] Validation failed: INVALID_INSTRUCTOR_ID {
  instructor_id: undefined,
  type: "undefined",
  ...
}

[API] 400 Bad Request details: {
  error: "Invalid or missing instructor_id. Type: undefined",
  error_code: "INVALID_INSTRUCTOR_ID",
  ...
}
```

---

## Esempio di Log Completo (Errore 503)

```
[INGEST] Sending to Orchestrator: {
  payload: { ... }
}

[INGEST] Upstream error: {
  status: 503,
  statusText: "Service Unavailable",
  error: "...",
  edgeFunctionUrl: "https://...supabase.co/functions/v1/ingest-inbound",
  ...
}

[API] Request failed: {
  status: 503,
  error: "Service temporarily unavailable...",
  ...
}
```
