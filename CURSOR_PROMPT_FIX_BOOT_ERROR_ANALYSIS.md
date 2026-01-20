# Analisi Codice: Problemi Potenziali per BOOT_ERROR

## Analisi del Codice Fornito

Dopo aver analizzato il codice di `ingest-inbound`, ho identificato questi potenziali problemi che potrebbero causare BOOT_ERROR:

### 1. Moduli `_shared` Potenzialmente Mancanti

Il codice importa:
```typescript
import { createLogger } from "../_shared/logger.ts";
import { constantTimeCompare } from "../_shared/security.ts";
import {
  searchPolicyChunks,
  generateEmbedding,
  buildRAGPrompt,
} from "../_shared/ragSearch.ts";
```

**Problema**: Se questi moduli non esistono o non sono deployati, la funzione fallirà all'avvio.

**Soluzione**: Verifica che esistano:
- `supabase/functions/_shared/logger.ts`
- `supabase/functions/_shared/security.ts`
- `supabase/functions/_shared/ragSearch.ts`

### 2. Variabili d'Ambiente Potenzialmente Mancanti

Il codice richiede:
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_ANON_KEY` (per JWT validation)
- `FD_INGEST_KEY` o `INGEST_SHARED_SECRET`
- `OPENAI_API_KEY` (per `generateImmediateAIReply`)

**Problema**: Se una di queste manca, la funzione potrebbe fallire all'avvio o durante l'esecuzione.

**Soluzione**: Verifica su Supabase Dashboard → Project Settings → Edge Functions → Secrets

### 3. Dipendenze Esterne

Il codice usa:
- `https://esm.sh/@supabase/supabase-js@2`
- `https://deno.land/std@0.168.0/uuid/mod.ts`
- `https://api.openai.com/v1/chat/completions`

**Problema**: Se le dipendenze non sono risolte correttamente, potrebbe causare errori.

**Soluzione**: Verifica che `deno.json` o `import_map.json` siano configurati correttamente.

### 4. Funzione `generateImmediateAIReply` Complessa

La funzione `generateImmediateAIReply` fa molte operazioni:
- Query al database
- Chiamate a OpenAI per embeddings
- Chiamate a OpenAI per completions
- Inserimenti in database

**Problema**: Se una di queste operazioni fallisce all'interno della funzione, potrebbe causare errori non gestiti.

**Soluzione**: Assicurati che tutti gli errori siano gestiti con try-catch.

## Prompt Cursor Specifico

```
REPO: Orchestrator (Supabase Edge Functions)
FILE: supabase/functions/ingest-inbound/index.ts

PROBLEMA:
L'Edge Function fallisce con BOOT_ERROR. Analisi del codice mostra potenziali problemi.

AZIONI RICHIESTE:

1. VERIFICA MODULI _SHARED:
   Controlla che esistano questi file:
   - supabase/functions/_shared/logger.ts
   - supabase/functions/_shared/security.ts
   - supabase/functions/_shared/ragSearch.ts

   Se mancano, creali con implementazioni minime:

   logger.ts:
   ```typescript
   export function createLogger(traceId: string) {
     return {
       setTraceId: (id: string) => {},
       info: (event: string, data?: Record<string, unknown>) => {
         console.log(`[${event}]`, data);
       },
       warn: (event: string, data?: Record<string, unknown>) => {
         console.warn(`[${event}]`, data);
       },
       error: (event: string, data?: Record<string, unknown>) => {
         console.error(`[${event}]`, data);
       },
     };
   }
   ```

   security.ts:
   ```typescript
   export function constantTimeCompare(a: string, b: string): boolean {
     if (a.length !== b.length) return false;
     let result = 0;
     for (let i = 0; i < a.length; i++) {
       result |= a.charCodeAt(i) ^ b.charCodeAt(i);
     }
     return result === 0;
   }
   ```

   ragSearch.ts (implementazione minima):
   ```typescript
   export async function searchPolicyChunks(
     supabase: any,
     instructorId: string,
     queryEmbedding: number[],
     topK: number
   ): Promise<{ chunks: any[]; error?: string }> {
     return { chunks: [] };
   }

   export async function generateEmbedding(
     text: string,
     apiKey: string
   ): Promise<number[]> {
     // Implementazione minima - restituisce array vuoto
     return [];
   }

   export function buildRAGPrompt(
     userMessage: string,
     instructorData: any,
     chunks: any[]
   ): string {
     return `You are a helpful AI assistant. Answer: ${userMessage}`;
   }
   ```

2. VERIFICA VARIABILI D'AMBIENTE:
   Su Supabase Dashboard → Project Settings → Edge Functions → Secrets, verifica:
   - SUPABASE_URL (può essere derivato automaticamente)
   - SUPABASE_SERVICE_ROLE_KEY (OBBLIGATORIO)
   - SUPABASE_ANON_KEY (se usato per JWT)
   - FD_INGEST_KEY (OBBLIGATORIO, deve corrispondere a Vercel)
   - OPENAI_API_KEY (OBBLIGATORIO per AI replies)

3. VERIFICA GESTIONE ERRORI:
   Assicurati che `generateImmediateAIReply` gestisca tutti gli errori:
   - Se OpenAI fallisce, restituisci `replyText: null` ma continua
   - Se il database fallisce, logga l'errore ma non crashare
   - Se i moduli `_shared` falliscono, usa implementazioni fallback

4. TEST GRADUALE:
   - Prima: Testa solo autenticazione e validazione payload
   - Poi: Aggiungi thread upsert
   - Poi: Aggiungi message insert
   - Infine: Aggiungi AI reply generation

5. LOGGING MIGLIORATO:
   Aggiungi logging all'inizio della funzione per diagnosticare:
   ```typescript
   console.log("[ingest-inbound] Starting function");
   console.log("[ingest-inbound] Environment check:", {
     has_supabase_url: !!Deno.env.get("SUPABASE_URL"),
     has_service_role_key: !!Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"),
     has_fd_ingest_key: !!Deno.env.get("FD_INGEST_KEY"),
     has_openai_key: !!Deno.env.get("OPENAI_API_KEY"),
   });
   ```

VERIFICA POST-FIX:
1. Deploy l'Edge Function
2. Controlla i log di Supabase per errori
3. Testa con una richiesta dalla Landing
4. Verifica che `replyText` sia presente nella risposta
```

## Checklist di Verifica Post-Fix

- [ ] Moduli `_shared` esistono e sono deployati
- [ ] Variabili d'ambiente configurate su Supabase
- [ ] `FD_INGEST_KEY` corrisponde tra Vercel e Supabase
- [ ] Funzione si avvia senza BOOT_ERROR
- [ ] Log di Supabase mostrano "Starting function"
- [ ] Richiesta dalla Landing riceve risposta con `replyText`
- [ ] Nessun errore nei log di Supabase
