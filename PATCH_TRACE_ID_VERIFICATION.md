# Patch: Verifica trace_id e x-request-id coerente

## Problema
Assicurarsi che ogni chiamata a `ingest-inbound` includa sempre `x-request-id` (trace_id) coerente e che venga salvato localmente per debug. Se manca, generare UUID v4 lato client.

## File da modificare

### 1. `lib/storage.js`

**Aggiungere funzione per salvare trace_id per debug:**

```javascript
// Aggiungere dopo getOrCreateTraceId()

const TRACE_DEBUG_KEY = "frostdesk_trace_debug_log";

/**
 * Save trace_id to debug log (max 100 entries)
 * @param {string} traceId - Trace ID to log
 */
export function saveTraceIdForDebug(traceId) {
  if (!traceId || typeof window === "undefined") return;
  
  try {
    const existing = JSON.parse(window.localStorage.getItem(TRACE_DEBUG_KEY) || "[]");
    const entry = {
      trace_id: traceId,
      timestamp: Date.now(),
      date: new Date().toISOString(),
    };
    
    // Add to beginning, keep max 100 entries
    const updated = [entry, ...existing].slice(0, 100);
    window.localStorage.setItem(TRACE_DEBUG_KEY, JSON.stringify(updated));
  } catch (e) {
    // Ignore errors
  }
}

/**
 * Get trace_id debug log
 * @returns {Array} Array of trace_id entries
 */
export function getTraceIdDebugLog() {
  if (typeof window === "undefined") return [];
  
  try {
    return JSON.parse(window.localStorage.getItem(TRACE_DEBUG_KEY) || "[]");
  } catch (e) {
    return [];
  }
}
```

### 2. `lib/api.js`

**Modificare sendChatMessage per generare trace_id se manca:**

```javascript
// Aggiungere import all'inizio del file
import { generateUUID } from "./utils";
import { saveTraceIdForDebug } from "./storage";

// Modificare funzione sendChatMessage (circa linea 72)

export async function sendChatMessage({ 
  external_thread_id, 
  instructor_id, 
  text, 
  idempotency_key,
  trace_id, // Può essere undefined
  external_message_id,
  submit_time,
  honeypot,
}) {
  // ✅ Genera trace_id se manca (UUID v4 lato client)
  const finalTraceId = trace_id || generateUUID();
  
  // ✅ Salva trace_id per debug
  saveTraceIdForDebug(finalTraceId);

  // Validate message length
  if (text.length > MAX_MESSAGE_LENGTH) {
    return {
      ok: false,
      error: `Message too long. Maximum ${MAX_MESSAGE_LENGTH} characters allowed.`,
      error_code: 'MESSAGE_TOO_LONG',
      trace_id: finalTraceId,
    };
  }

  const payload = {
    channel: "landing",
    external_thread_id,
    instructor_id,
    text,
    idempotency_key,
    trace_id: finalTraceId, // ✅ Sempre presente
    external_message_id,
    submit_time,
    honeypot,
  };

  trackTelemetry('message_send_start', { 
    external_thread_id, 
    instructor_id, 
    has_idempotency_key: !!idempotency_key,
    trace_id: finalTraceId, // ✅ Usa finalTraceId
  });

  // ... resto del codice invariato ...
  
  // In tutti i punti dove si usa trace_id, usare finalTraceId
  // (già presente nel payload, quindi automatico)
}
```

### 3. `pages/api/ingest.js`

**Verificare che x-request-id sia sempre presente (già implementato, ma aggiungere log per debug):**

```javascript
// Circa linea 270, già presente ma aggiungere verifica:

const upstreamRes = await fetch(edgeFunctionUrl, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "x-fd-ingest-key": fdIngestKey,
    "x-request-id": traceId, // ✅ Sempre presente (già implementato)
  },
  body: JSON.stringify(payload),
  signal: controller.signal,
});

// ✅ Aggiungere log per debug (opzionale, solo in development)
if (process.env.NODE_ENV === 'development') {
  console.log('[DEBUG] Calling ingest-inbound with x-request-id:', traceId);
}
```

## Verifica

### Test 1: trace_id mancante dal client
```javascript
// Chiamata senza trace_id
await sendChatMessage({
  external_thread_id: 'test-123',
  instructor_id: 'instructor-123',
  text: 'Hello',
  // trace_id non fornito
});

// Verifica:
// ✅ trace_id generato (UUID v4)
// ✅ trace_id salvato in debug log
// ✅ x-request-id incluso nell'header
```

### Test 2: trace_id fornito dal client
```javascript
// Chiamata con trace_id
await sendChatMessage({
  external_thread_id: 'test-123',
  instructor_id: 'instructor-123',
  text: 'Hello',
  trace_id: 'trc_custom_123',
});

// Verifica:
// ✅ trace_id usato invariato
// ✅ trace_id salvato in debug log
// ✅ x-request-id = 'trc_custom_123'
```

### Test 3: Debug log
```javascript
// In console browser
import { getTraceIdDebugLog } from './lib/storage';
console.log(getTraceIdDebugLog());
// Dovrebbe mostrare array di trace_id usati
```

## File Paths

1. **`lib/storage.js`** - Aggiungere `saveTraceIdForDebug()` e `getTraceIdDebugLog()`
2. **`lib/api.js`** - Modificare `sendChatMessage()` per generare trace_id se manca
3. **`pages/api/ingest.js`** - Aggiungere log debug (opzionale)

## Note

- ✅ `x-request-id` è già incluso nell'header (linea 275 di `pages/api/ingest.js`)
- ✅ Il server genera trace_id se manca (già implementato)
- ✅ Questa patch garantisce che il client generi sempre trace_id prima di inviare
- ✅ Debug log salvato in localStorage con max 100 entries
