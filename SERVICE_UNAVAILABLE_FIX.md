# Fix: "Service temporarily unavailable" Error

## 🔴 Problema

La landing page mostra:
```
Service temporarily unavailable. The server is overloaded. Please try again in a moment.
```

## 🔍 Causa Root

L'errore **503 Service Unavailable** viene dall'**Orchestrator** (Supabase Edge Function `ingest-inbound`) che sta ancora dando **BOOT_ERROR**.

### Flusso dell'Errore:

```
1. Landing Page → POST /api/ingest
   ↓
2. /api/ingest → POST Supabase Edge Function ingest-inbound
   ↓
3. Orchestrator (ingest-inbound) → BOOT_ERROR ❌
   ↓
4. Orchestrator → Restituisce 503 Service Unavailable
   ↓
5. /api/ingest → Propaga 503 al client
   ↓
6. Landing Page → Mostra "Service temporarily unavailable"
```

## ✅ Soluzione

Il problema è nell'**Orchestrator**, non nella Landing. Devi applicare il prompt Cursor per fixare il `BOOT_ERROR`.

### Step 1: Apri il Repository Orchestrator

```bash
cd /path/to/orchestrator-repo
```

### Step 2: Applica il Prompt Cursor

Copia il contenuto di `CURSOR_PROMPT_FIX_BOOT_ERROR_FINAL.txt` e incollalo in Cursor sul repository Orchestrator.

Il prompt ti guiderà a:
1. ✅ Verificare che i moduli `_shared` esistano (`logger.ts`, `security.ts`, `ragSearch.ts`)
2. ✅ Creare i moduli mancanti con implementazioni minime
3. ✅ Verificare le variabili d'ambiente su Supabase Dashboard
4. ✅ Aggiungere logging diagnostico

### Step 3: Verifica le Variabili d'Ambiente su Supabase

Vai su **Supabase Dashboard** → **Project Settings** → **Edge Functions** → **Secrets**

Verifica che siano presenti:
- ✅ `SUPABASE_URL`
- ✅ `SUPABASE_SERVICE_ROLE_KEY` (OBBLIGATORIO)
- ✅ `FD_INGEST_KEY=zixxe8-Bazjib-nujkap` (OBBLIGATORIO - deve corrispondere a Vercel)
- ✅ `OPENAI_API_KEY` (OBBLIGATORIO per AI replies)

### Step 4: Test

Dopo aver fixato l'Orchestrator:

1. **Testa l'Edge Function direttamente:**
   ```bash
   curl -X POST https://YOUR_SUPABASE_URL/functions/v1/ingest-inbound \
     -H "Content-Type: application/json" \
     -H "x-fd-ingest-key: zixxe8-Bazjib-nujkap" \
     -d '{
       "channel": "landing",
       "external_thread_id": "test-123",
       "instructor_id": "YOUR_INSTRUCTOR_ID",
       "text": "Test message"
     }'
   ```

2. **Verifica i log su Supabase:**
   - Vai su **Supabase Dashboard** → **Edge Functions** → **ingest-inbound** → **Logs**
   - Cerca errori `BOOT_ERROR` o altri errori

3. **Testa dalla Landing:**
   - Apri la landing page
   - Invia un messaggio
   - Verifica che non compaia più l'errore 503

## 📋 Checklist

- [ ] Aperto repository Orchestrator in Cursor
- [ ] Applicato `CURSOR_PROMPT_FIX_BOOT_ERROR_FINAL.txt`
- [ ] Verificati moduli `_shared` (logger.ts, security.ts, ragSearch.ts)
- [ ] Verificate variabili d'ambiente su Supabase Dashboard
- [ ] Testato Edge Function direttamente
- [ ] Verificati log Supabase (nessun BOOT_ERROR)
- [ ] Testato dalla Landing (nessun errore 503)

## 🔗 File Correlati

- `CURSOR_PROMPT_FIX_BOOT_ERROR_FINAL.txt` - Prompt per fixare BOOT_ERROR
- `ORCHESTRATOR_BOOT_ERROR.md` - Guida diagnostica completa
- `LOG_ANALYSIS.md` - Analisi dei log che mostra il problema

## ⚠️ Nota Importante

**Il problema NON è nella Landing Page.** La Landing funziona correttamente e gestisce gli errori come previsto. Il problema è che l'Orchestrator non riesce ad avviarsi a causa di:
- Moduli `_shared` mancanti
- Variabili d'ambiente mancanti o errate
- Errori di sintassi nel codice Edge Function

Una volta fixato l'Orchestrator, la Landing funzionerà automaticamente.
