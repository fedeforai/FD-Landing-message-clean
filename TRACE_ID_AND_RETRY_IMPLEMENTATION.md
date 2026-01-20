# Trace ID e Retry con Idempotenza - Implementazione

## Riepilogo Modifiche

### Obiettivo
Garantire che ogni messaggio abbia:
- `trace_id` generato lato server (proxy) alla prima interazione
- `trace_id` sempre propagato verso `ingest-inbound`
- `external_message_id` per idempotenza nei retry
- Retry logic con idempotenza garantita

## Modifiche Implementate

### 1. Server Route (`pages/api/ingest.js`)

#### Generazione Trace ID
- **Genera trace_id lato server** alla prima interazione
- **Accetta trace_id dal client** se fornito e lo propaga invariato
- **Fallback**: Se il client non fornisce trace_id, il server ne genera uno

```javascript
// Generate trace_id lato server alla prima interazione
const clientTraceId = req.body?.trace_id;
const serverTraceId = generateUUID();
const traceId = clientTraceId || serverTraceId;
```

#### External Message ID per Idempotenza
- **Genera `external_message_id`** se non fornito dal client
- **Usa sempre lo stesso `external_message_id`** in tutti i retry
- Garantisce che il messaggio non venga duplicato anche con retry multipli

```javascript
// Genera external_message_id se non fornito (per idempotenza nei retry)
const external_message_id = clientExternalMessageId || generateUUID();
```

#### Retry con Idempotenza
- **3 tentativi massimi** con exponential backoff
- **Stesso `external_message_id`** usato in tutti i retry
- **Idempotenza garantita**: Orchestrator non creerà duplicati

```javascript
// Retry configuration
const MAX_RETRIES = 3;
const INITIAL_BACKOFF_MS = 500;
const MAX_BACKOFF_MS = 10000;

// Loop di retry con stesso payload (stesso external_message_id)
for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
  // Usa stesso external_message_id in ogni retry
  const payload = {
    // ... altri campi
    trace_id: traceId, // Sempre presente
    external_message_id: external_message_id, // Sempre presente, stesso in tutti i retry
  };
  
  // Chiamata a ingest-inbound con retry
  // Se fallisce, ritenta con stesso external_message_id
}
```

#### Propagazione Trace ID
- **Sempre incluso nel payload** verso `ingest-inbound`
- **Sempre incluso nella risposta** al client
- **Loggato in Sentry** per debugging

### 2. Client (`pages/index.js` e `lib/api.js`)

#### Generazione Identificatori
- Genera `trace_id` (UUID v4) lato client
- Genera `external_message_id` (UUID v4) lato client
- Passa entrambi al server route

#### Payload Completo
```javascript
const payload = {
  channel: "landing",
  external_thread_id: threadId,
  instructor_id: selectedInstructorId,
  text: text,
  idempotency_key: idempotencyKey,
  trace_id: traceId, // Generato lato client
  external_message_id: externalMessageId, // Generato lato client
  submit_time: formRenderTimeRef.current,
  honeypot: honeypot,
};
```

## Flusso Dati

### Scenario 1: Client Genera Trace ID

```
Client → Server Route
  ↓
trace_id: "client-uuid" (generato lato client)
external_message_id: "client-msg-uuid" (generato lato client)
  ↓
Server Route accetta trace_id invariato
Server Route usa external_message_id fornito
  ↓
Server Route → Supabase Edge Function
  ↓
Payload include:
  - trace_id: "client-uuid" (propagato invariato)
  - external_message_id: "client-msg-uuid" (usato per idempotenza)
```

### Scenario 2: Client Non Genera Trace ID

```
Client → Server Route
  ↓
trace_id: undefined (non fornito)
external_message_id: undefined (non fornito)
  ↓
Server Route genera trace_id: "server-uuid"
Server Route genera external_message_id: "server-msg-uuid"
  ↓
Server Route → Supabase Edge Function
  ↓
Payload include:
  - trace_id: "server-uuid" (generato server-side)
  - external_message_id: "server-msg-uuid" (generato server-side)
```

### Scenario 3: Retry con Idempotenza

```
Tentativo 1 (fallisce con 500):
  - trace_id: "uuid-123"
  - external_message_id: "msg-uuid-456"
  - Risultato: 500 Internal Server Error
  ↓
Backoff: 500ms
  ↓
Tentativo 2 (stesso external_message_id):
  - trace_id: "uuid-123" (stesso)
  - external_message_id: "msg-uuid-456" (STESSO - idempotenza)
  - Risultato: 200 OK
  
Orchestrator:
  - Verifica se esiste messaggio con external_message_id = "msg-uuid-456"
  - Se esiste: ritorna messaggio esistente (no duplicati)
  - Se non esiste: crea nuovo messaggio
```

## Codice Chiave

### Server Route - Generazione Trace ID

```javascript
export default async function handler(req, res) {
  // Generate trace_id lato server alla prima interazione
  // Se il client fornisce trace_id, lo accettiamo e passiamo invariato
  const clientTraceId = req.body?.trace_id;
  const serverTraceId = generateUUID();
  const traceId = clientTraceId || serverTraceId;
  
  // ... validazione ...
  
  // Genera external_message_id se non fornito
  const external_message_id = clientExternalMessageId || generateUUID();
  
  // Payload sempre include trace_id e external_message_id
  const payload = {
    channel: 'landing',
    external_thread_id: external_thread_id.trim(),
    instructor_id: instructor_id.trim(),
    text: text.trim(),
    idempotency_key: idempotency_key || null,
    trace_id: traceId, // Sempre presente
    external_message_id: external_message_id, // Sempre presente per idempotenza
  };
  
  // Retry loop con stesso external_message_id
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    // Usa stesso payload (stesso external_message_id) in ogni tentativo
    const upstreamRes = await fetch(edgeFunctionUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-fd-ingest-key": ingestSharedSecret,
      },
      body: JSON.stringify(payload), // Stesso payload = stesso external_message_id
    });
    
    if (upstreamRes.ok) {
      return res.status(upstreamRes.status).json({
        ...parsed,
        trace_id: parsed.trace_id || traceId,
        external_message_id: external_message_id,
      });
    }
    
    // Retry con backoff, stesso external_message_id garantisce idempotenza
    if (attempt < MAX_RETRIES) {
      const backoff = calculateBackoff(attempt);
      await new Promise((resolve) => setTimeout(resolve, backoff));
      continue;
    }
  }
}
```

### Client - Invio con Identificatori

```javascript
// Generate identifiers
const traceId = generateUUID(); // Generato lato client
const externalMessageId = generateUUID(); // Generato lato client
const idempotencyKey = generateIdempotencyKey();

// Invia al server route
const result = await sendChatMessage({
  external_thread_id: threadId,
  instructor_id: selectedInstructorId,
  text,
  idempotency_key: idempotencyKey,
  trace_id: traceId, // Passato al server
  external_message_id: externalMessageId, // Passato al server
  submit_time: formRenderTimeRef.current,
  honeypot: honeypot,
});
```

## Garanzie

1. **Trace ID Sempre Presente**
   - Generato lato server se non fornito
   - Accettato e propagato invariato se fornito dal client
   - Sempre incluso in tutte le chiamate a `ingest-inbound`
   - Sempre incluso in tutte le risposte

2. **External Message ID per Idempotenza**
   - Sempre presente (generato server-side se mancante)
   - Stesso ID usato in tutti i retry
   - Orchestrator può deduplicare basandosi su questo ID

3. **Retry con Idempotenza**
   - Fino a 3 retry con exponential backoff
   - Stesso `external_message_id` in ogni tentativo
   - Nessun rischio di messaggi duplicati

4. **Propagazione Garantita**
   - `trace_id` sempre propagato a `ingest-inbound`
   - `trace_id` sempre incluso nelle risposte
   - Loggato in Sentry per debugging end-to-end

## Test di Verifica

### Test 1: Trace ID Generato Server-Side

```bash
curl -X POST http://localhost:3000/api/ingest \
  -H "Content-Type: application/json" \
  -d '{
    "channel": "landing",
    "external_thread_id": "test-thread-123",
    "instructor_id": "550e8400-e29b-41d4-a716-446655440000",
    "text": "Hello"
  }'
```

**Expected:**
- Risposta include `trace_id` (generato server-side)
- Payload a `ingest-inbound` include `trace_id`
- Payload include `external_message_id` (generato server-side)

### Test 2: Trace ID dal Client Accettato

```bash
curl -X POST http://localhost:3000/api/ingest \
  -H "Content-Type: application/json" \
  -d '{
    "channel": "landing",
    "external_thread_id": "test-thread-123",
    "instructor_id": "550e8400-e29b-41d4-a716-446655440000",
    "text": "Hello",
    "trace_id": "client-provided-uuid-123",
    "external_message_id": "client-msg-uuid-456"
  }'
```

**Expected:**
- Risposta include `trace_id: "client-provided-uuid-123"` (propagato invariato)
- Payload a `ingest-inbound` include `trace_id: "client-provided-uuid-123"`
- Payload include `external_message_id: "client-msg-uuid-456"` (usato invariato)

### Test 3: Retry con Idempotenza

```bash
# Simula errore 500 (Orchestrator down)
# Server route fa retry automatico
```

**Expected:**
- Tutti i retry usano stesso `external_message_id`
- Orchestrator riceve stesso `external_message_id` in ogni tentativo
- Nessun messaggio duplicato creato

## Variabili d'Ambiente

### Richieste
- `SUPABASE_URL` - URL del progetto Supabase
- `INGEST_SHARED_SECRET` - Chiave segreta per autenticazione (**SECRET**)

### Opzionali
- `NEXT_PUBLIC_SENTRY_DSN` - Per logging errori in Sentry

## Note Importanti

1. **Trace ID**: Il server accetta trace_id dal client ma ne genera sempre uno come fallback
2. **External Message ID**: Sempre presente, garantisce idempotenza nei retry
3. **Retry**: Stesso `external_message_id` in tutti i tentativi previene duplicati
4. **Propagazione**: `trace_id` sempre propagato a `ingest-inbound` per tracciabilità end-to-end
