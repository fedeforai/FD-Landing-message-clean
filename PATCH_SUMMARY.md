# Patch: Verifica trace_id e x-request-id coerente

## Modifiche Applicate

### File Modificati

1. **`lib/storage.js`**
   - ✅ Aggiunta funzione `saveTraceIdForDebug(traceId)` per salvare trace_id in localStorage
   - ✅ Aggiunta funzione `getTraceIdDebugLog()` per recuperare log debug
   - ✅ Log limitato a 100 entries (FIFO)

2. **`lib/api.js`**
   - ✅ Import di `generateUUID` e `saveTraceIdForDebug`
   - ✅ Generazione `finalTraceId` se `trace_id` manca (UUID v4 lato client)
   - ✅ Salvataggio trace_id per debug prima di ogni chiamata
   - ✅ Uso di `finalTraceId` in tutti i punti (payload, telemetry, return values)
   - ✅ Garantito che trace_id sia sempre presente in tutte le risposte

3. **`pages/api/ingest.js`**
   - ✅ Aggiunta verifica che trace_id sia presente prima di chiamare ingest-inbound
   - ✅ `x-request-id` header già presente (verificato)

## Comportamento

### Prima della Patch
- Se `trace_id` mancava dal client, veniva generato solo lato server
- Nessun log locale per debug
- Possibilità di trace_id null/undefined in alcuni casi

### Dopo la Patch
- ✅ `trace_id` sempre generato lato client se manca (UUID v4)
- ✅ `trace_id` salvato in localStorage per debug (max 100 entries)
- ✅ `x-request-id` sempre presente nell'header verso ingest-inbound
- ✅ `trace_id` sempre presente in tutte le risposte API

## Test

### Test 1: trace_id mancante
```javascript
await sendChatMessage({
  external_thread_id: 'test-123',
  instructor_id: 'instructor-123',
  text: 'Hello',
  // trace_id non fornito
});
// ✅ trace_id generato (UUID v4)
// ✅ trace_id salvato in debug log
// ✅ x-request-id incluso nell'header
```

### Test 2: trace_id fornito
```javascript
await sendChatMessage({
  external_thread_id: 'test-123',
  instructor_id: 'instructor-123',
  text: 'Hello',
  trace_id: 'trc_custom_123',
});
// ✅ trace_id usato invariato
// ✅ trace_id salvato in debug log
// ✅ x-request-id = 'trc_custom_123'
```

### Test 3: Debug log
```javascript
// In console browser
import { getTraceIdDebugLog } from './lib/storage';
console.log(getTraceIdDebugLog());
// Mostra array di trace_id usati con timestamp
```

## Verifica x-request-id

L'header `x-request-id` è già incluso in `pages/api/ingest.js` (linea ~275):
```javascript
headers: {
  "x-fd-ingest-key": fdIngestKey,
  "x-request-id": traceId, // ✅ Sempre presente
}
```

Aggiunta verifica per logging:
```javascript
if (!traceId) {
  console.error('[ERROR] trace_id missing, cannot set x-request-id header');
}
```

## Risultato

✅ **Ogni chiamata a ingest-inbound include x-request-id coerente**  
✅ **trace_id sempre generato lato client se manca (UUID v4)**  
✅ **trace_id salvato localmente per debug (localStorage)**  
✅ **trace_id sempre presente in tutte le risposte API**
