# Orchestrator BOOT_ERROR - Guida Diagnostica

## Problema

L'Orchestrator (Supabase Edge Function `ingest-inbound`) sta fallendo con:

```json
{
  "code": "BOOT_ERROR",
  "message": "Function failed to start (please check logs)"
}
```

**Status**: 503 Service Unavailable

## Cosa Significa

`BOOT_ERROR` indica che l'Edge Function **non riesce nemmeno ad avviarsi**. Questo è diverso da un errore runtime - la funzione fallisce prima di eseguire qualsiasi codice.

## Cause Comuni

### 1. Errore di Sintassi nel Codice

**Sintomo**: La funzione non compila

**Soluzione**:
1. Vai su Supabase Dashboard → Edge Functions → `ingest-inbound`
2. Controlla i log di deploy
3. Cerca errori di sintassi TypeScript/JavaScript
4. Verifica che tutti gli import siano corretti

### 2. Variabili d'Ambiente Mancanti o Errate

**Sintomo**: La funzione richiede variabili d'ambiente che non sono configurate

**Soluzione**:
1. Vai su Supabase Dashboard → Project Settings → Edge Functions → Secrets
2. Verifica che siano presenti:
   - `FD_INGEST_KEY` (deve corrispondere a quello su Vercel)
   - `OPENAI_API_KEY` (se usato)
   - `SUPABASE_URL` (se usato)
   - `SUPABASE_SERVICE_ROLE_KEY` (se usato)
3. Verifica che i valori siano corretti (no spazi, no caratteri speciali)

### 3. Import/Dipendenze Mancanti

**Sintomo**: La funzione importa moduli che non esistono o non sono installati

**Soluzione**:
1. Controlla il file `deno.json` o `import_map.json` dell'Edge Function
2. Verifica che tutti gli import siano corretti:
   ```typescript
   import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
   ```
3. Verifica che le versioni delle dipendenze siano corrette

### 4. Errore nell'Handler Function

**Sintomo**: La funzione esportata non è valida

**Soluzione**:
1. Verifica che ci sia un export default valido:
   ```typescript
   Deno.serve(async (req: Request) => {
     // handler code
   });
   ```
2. Verifica che il tipo di ritorno sia corretto (`Response`)

### 5. Timeout di Avvio

**Sintomo**: La funzione impiega troppo tempo ad avviarsi

**Soluzione**:
1. Verifica che non ci siano operazioni sincrone pesanti all'avvio
2. Sposta l'inizializzazione dentro l'handler se possibile

## Come Diagnosticare

### Step 1: Controlla i Log di Supabase

1. Vai su **Supabase Dashboard** → **Edge Functions** → `ingest-inbound`
2. Clicca su **"Logs"**
3. Filtra per **"Error"** o **"Fatal"**
4. Cerca errori che iniziano con:
   - `SyntaxError`
   - `TypeError`
   - `ReferenceError`
   - `Module not found`
   - `Environment variable not found`

### Step 2: Verifica il Codice dell'Edge Function

1. Vai su **Supabase Dashboard** → **Edge Functions** → `ingest-inbound`
2. Clicca su **"View Source"** o **"Edit"**
3. Controlla:
   - Sintassi corretta
   - Import corretti
   - Export default presente
   - Handler function valida

### Step 3: Verifica le Variabili d'Ambiente

1. Vai su **Supabase Dashboard** → **Project Settings** → **Edge Functions** → **Secrets**
2. Verifica che tutte le variabili richieste siano presenti
3. Controlla che i valori siano corretti (no spazi, no caratteri speciali)

### Step 4: Test Locale (Opzionale)

Se hai accesso al codice dell'Orchestrator:

```bash
# Installa Supabase CLI
npm install -g supabase

# Test locale
supabase functions serve ingest-inbound
```

## Soluzioni Rapide

### Soluzione 1: Re-deploy dell'Edge Function

1. Vai su Supabase Dashboard → Edge Functions → `ingest-inbound`
2. Clicca su **"Deploy"** o **"Redeploy"**
3. Attendi che il deploy completi
4. Testa di nuovo

### Soluzione 2: Verifica Variabili d'Ambiente

1. Vai su Supabase Dashboard → Project Settings → Edge Functions → Secrets
2. Verifica che `FD_INGEST_KEY` corrisponda a quello su Vercel:
   - Vercel: `FD_INGEST_KEY` (Environment Variable)
   - Supabase: `FD_INGEST_KEY` (Edge Function Secret)
3. Se non corrispondono, aggiorna uno dei due

### Soluzione 3: Controlla il Codice Base

Verifica che l'Edge Function abbia almeno questo codice minimo:

```typescript
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

Deno.serve(async (req: Request) => {
  try {
    // Verifica metodo
    if (req.method !== "POST") {
      return new Response(
        JSON.stringify({ ok: false, error: "Method not allowed" }),
        { status: 405, headers: { "Content-Type": "application/json" } }
      );
    }

    // Verifica header di autenticazione
    const ingestKey = req.headers.get("x-fd-ingest-key");
    const expectedKey = Deno.env.get("FD_INGEST_KEY");
    
    if (!ingestKey || ingestKey !== expectedKey) {
      return new Response(
        JSON.stringify({ ok: false, error: "Unauthorized" }),
        { status: 401, headers: { "Content-Type": "application/json" } }
      );
    }

    // Parse body
    const body = await req.json();
    
    // TODO: Implementare logica di ingest
    
    return new Response(
      JSON.stringify({ ok: true, conversation_id: null, trace_id: body.trace_id }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error:", error);
    return new Response(
      JSON.stringify({ ok: false, error: error.message }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
});
```

## Checklist di Verifica

- [ ] Edge Function `ingest-inbound` è deployata su Supabase?
- [ ] I log di Supabase mostrano errori di sintassi?
- [ ] Le variabili d'ambiente sono configurate correttamente?
- [ ] `FD_INGEST_KEY` corrisponde tra Vercel e Supabase?
- [ ] Il codice dell'Edge Function ha un export default valido?
- [ ] Tutti gli import sono corretti?
- [ ] L'handler function restituisce una `Response`?

## Prossimi Passi

1. **Controlla i log di Supabase** per vedere l'errore esatto
2. **Verifica le variabili d'ambiente** su Supabase
3. **Re-deploy l'Edge Function** se necessario
4. **Testa di nuovo** dalla Landing

## Riferimenti

- [Supabase Edge Functions Docs](https://supabase.com/docs/guides/functions)
- [Deno Runtime Docs](https://deno.land/manual)
- [SYSTEM_CONTRACT.md](./docs/SYSTEM_CONTRACT.md) - Sezione 4 (Canonical Ingest API)

## Nota Importante

Il problema `BOOT_ERROR` è **dell'Orchestrator**, non della Landing. La Landing sta inviando correttamente le richieste, ma l'Orchestrator non riesce ad avviarsi. Devi risolvere questo problema nel repository Orchestrator.
