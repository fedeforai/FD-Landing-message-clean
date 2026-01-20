# Prompt Cursor: Fix Orchestrator BOOT_ERROR

## Contesto

L'Edge Function `ingest-inbound` su Supabase sta fallendo con `BOOT_ERROR`, impedendo alla Landing di ricevere risposte AI.

## Analisi del Codice Fornito

Il codice usa:
- Moduli `_shared`: `logger.ts`, `security.ts`, `ragSearch.ts`
- Variabili d'ambiente: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `FD_INGEST_KEY`, `OPENAI_API_KEY`
- Funzione `generateImmediateAIReply` per generare risposte AI sincrone

## Prompt Completo per Cursor

```
REPO: Orchestrator (Supabase Edge Functions)
FILE: supabase/functions/ingest-inbound/index.ts

PROBLEMA:
L'Edge Function `ingest-inbound` fallisce con BOOT_ERROR. La funzione non si avvia.

ANALISI RICHIESTA:
1. Verifica che tutti i moduli `_shared` esistano:
   - `supabase/functions/_shared/logger.ts`
   - `supabase/functions/_shared/security.ts`
   - `supabase/functions/_shared/ragSearch.ts`

2. Verifica che tutte le variabili d'ambiente siano configurate su Supabase:
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `SUPABASE_ANON_KEY` (se usato)
   - `FD_INGEST_KEY` (deve corrispondere a Vercel)
   - `OPENAI_API_KEY`

3. Controlla i log di Supabase per errori specifici:
   - Vai su Supabase Dashboard → Edge Functions → ingest-inbound → Logs
   - Cerca errori di sintassi, import mancanti, o variabili d'ambiente mancanti

AZIONI:
1. Se i moduli `_shared` mancano:
   - Crealili con implementazioni minime se necessario
   - O rimuovi gli import se non critici per il boot

2. Se le variabili d'ambiente mancano:
   - Aggiungile su Supabase Dashboard → Project Settings → Edge Functions → Secrets
   - Verifica che `FD_INGEST_KEY` corrisponda a quello su Vercel

3. Se ci sono errori di sintassi:
   - Correggili
   - Verifica che tutti gli import siano corretti

4. Testa la funzione:
   - Deploy su Supabase
   - Testa con una richiesta dalla Landing
   - Verifica che `replyText` sia presente nella risposta

CODICE DI TEST MINIMALE:
Se la funzione completa non si avvia, crea una versione minimale per testare:

```typescript
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

Deno.serve(async (req: Request) => {
  // CORS
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "content-type, x-fd-ingest-key",
      },
    });
  }

  try {
    // Verifica variabili d'ambiente
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const sharedSecret = Deno.env.get("FD_INGEST_KEY");

    if (!supabaseUrl || !supabaseKey) {
      return new Response(
        JSON.stringify({ ok: false, error: "Missing Supabase configuration" }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    // Verifica autenticazione
    const ingestKey = req.headers.get("x-fd-ingest-key");
    if (!ingestKey || ingestKey !== sharedSecret) {
      return new Response(
        JSON.stringify({ ok: false, error: "Unauthorized" }),
        { status: 401, headers: { "Content-Type": "application/json" } }
      );
    }

    // Parse body
    const body = await req.json();
    const traceId = body.trace_id || crypto.randomUUID();
    
    // Restituisci risposta di test
    return new Response(
      JSON.stringify({
        ok: true,
        trace_id: traceId,
        conversation_id: null,
        replyText: "Test reply - function is working",
      }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
      }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({
        ok: false,
        error: error instanceof Error ? error.message : "Unknown error",
      }),
      {
        status: 500,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
      }
    );
  }
});
```

Se questa versione minimale funziona, aggiungi gradualmente:
1. Validazione payload
2. Thread upsert
3. Message insert
4. AI reply generation

VERIFICA POST-FIX:
1. Deploy l'Edge Function
2. Invia un messaggio dalla Landing
3. Verifica che la risposta includa `replyText`
4. Controlla i log di Supabase per errori
```

## Checklist di Verifica

- [ ] Moduli `_shared` esistono e sono deployati
- [ ] Variabili d'ambiente configurate su Supabase
- [ ] `FD_INGEST_KEY` corrisponde tra Vercel e Supabase
- [ ] Funzione si avvia senza errori
- [ ] `replyText` viene generato e restituito per messaggi utente
- [ ] Log di Supabase non mostrano errori

## Riferimenti

- [ORCHESTRATOR_BOOT_ERROR.md](./ORCHESTRATOR_BOOT_ERROR.md) - Guida diagnostica completa
- [CURSOR_PROMPT_SYNC.txt](./CURSOR_PROMPT_SYNC.txt) - Prompt per sincronizzare replyText
- [SYSTEM_CONTRACT.md](./docs/SYSTEM_CONTRACT.md) - Contratto di sistema
