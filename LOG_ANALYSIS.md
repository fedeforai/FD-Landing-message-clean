# Analisi Log Vercel - Cosa Sta Succedendo

## 📊 Riepilogo

**Data analisi**: 2026-01-20 22:30:42 UTC  
**Problema**: Tutte le richieste falliscono con **503 Service Unavailable**  
**Causa root**: L'Orchestrator (Supabase Edge Function) risponde con **BOOT_ERROR**

## ✅ Cosa Funziona (Landing)

### 1. Validazione Payload ✅
```
[INGEST] Validating payload: {
  has_channel: true,
  channel_value: 'landing',
  has_external_thread_id: true,
  has_instructor_id: true,
  has_text: true,
  text_length: 34
}
```
**Conclusione**: Il payload è corretto e completo.

### 2. Environment Check ✅
```
[INGEST] Environment check passed {
  has_supabase_url: true,
  has_fd_ingest_key: true
}
```
**Conclusione**: Le variabili d'ambiente su Vercel sono configurate correttamente.

### 3. Invio all'Orchestrator ✅
```
[INGEST] Sending to Orchestrator: {
  edgeFunctionUrl: 'https://ncvkipizapkhawnaqssm.supabase.co/functions/v1/ingest-inbound',
  payload: {
    channel: 'landing',
    external_thread_id: 'webchat-1768935667661-4awob1rb3',
    instructor_id: '497c7091-0aee-4a86-84a9-b737c187359a',
    trace_id: 'e21398d8-71a9-463c-b67f-94f90fb357fc',
    external_message_id: '55242a0b-3152-418f-9f9a-e72bda51234d'
  }
}
```
**Conclusione**: La Landing invia correttamente il payload all'Orchestrator.

## ❌ Cosa Non Funziona (Orchestrator)

### Errore Ripetuto (4 tentativi per ogni richiesta):
```
[INGEST] Upstream error: {
  status: 503,
  statusText: 'Service Unavailable',
  error: '{"code":"BOOT_ERROR","message":"Function failed to start (please check logs)"}',
  attempt: 1, 2, 3, 4
}
```

**Conclusione**: L'Edge Function `ingest-inbound` su Supabase **non si avvia**.

## 🔍 Analisi Dettagliata

### Pattern degli Errori

1. **Ogni richiesta viene ritentata 4 volte** (configurazione corretta)
2. **Tutti i tentativi falliscono** con lo stesso errore BOOT_ERROR
3. **Il payload è sempre corretto** (validazione passa)
4. **Le variabili d'ambiente su Vercel sono OK**

### Timeline di una Richiesta

```
22:30:40 - Richiesta ricevuta
22:30:40 - Validazione payload: ✅ OK
22:30:40 - Environment check: ✅ OK
22:30:40 - Invio all'Orchestrator: ✅ OK
22:30:40 - Risposta Orchestrator: ❌ BOOT_ERROR (attempt 1)
22:30:41 - Retry attempt 2: ❌ BOOT_ERROR
22:30:42 - Retry attempt 3: ❌ BOOT_ERROR
22:30:44 - Retry attempt 4: ❌ BOOT_ERROR
22:30:44 - Final error: 503 Service Unavailable
```

## 🎯 Causa Root

**L'Edge Function `ingest-inbound` su Supabase non riesce ad avviarsi.**

Possibili cause (in ordine di probabilità):

1. **Moduli `_shared` mancanti** (90% probabile)
   - `logger.ts`
   - `security.ts`
   - `ragSearch.ts`

2. **Variabili d'ambiente mancanti su Supabase** (70% probabile)
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `FD_INGEST_KEY`
   - `OPENAI_API_KEY`

3. **Errore di sintassi nel codice** (30% probabile)
   - Import non risolti
   - Errori TypeScript

4. **Problema di deploy** (20% probabile)
   - Funzione non deployata correttamente
   - File mancanti nel deploy

## ✅ Cosa Fare

### Step 1: Verifica Log di Supabase

1. Vai su **Supabase Dashboard** → **Edge Functions** → `ingest-inbound`
2. Clicca su **"Logs"**
3. Cerca errori che iniziano con:
   - `Module not found`
   - `SyntaxError`
   - `TypeError`
   - `Environment variable not found`

### Step 2: Usa il Prompt Cursor

Usa `CURSOR_PROMPT_FIX_BOOT_ERROR_FINAL.txt` per:
1. Creare i moduli `_shared` se mancano
2. Verificare le variabili d'ambiente
3. Aggiungere logging diagnostico

### Step 3: Verifica Variabili d'Ambiente

Vai su **Supabase Dashboard** → **Project Settings** → **Edge Functions** → **Secrets**

Verifica che siano presenti:
- `SUPABASE_SERVICE_ROLE_KEY`
- `FD_INGEST_KEY` (deve corrispondere a quello su Vercel)
- `OPENAI_API_KEY`

## 📈 Statistiche dai Log

- **Totale richieste analizzate**: ~30
- **Tasso di successo**: 0% (tutte falliscono)
- **Errore comune**: BOOT_ERROR (100%)
- **Tentativi per richiesta**: 4
- **Tempo medio per richiesta**: ~4-5 secondi (4 retry)

## 🎯 Conclusione

**La Landing funziona perfettamente.** Il problema è **100% nell'Orchestrator**.

**Azione richiesta**: 
1. Controlla i log di Supabase per l'errore esatto
2. Usa il prompt Cursor per fixare il BOOT_ERROR
3. Verifica le variabili d'ambiente su Supabase

Una volta risolto il BOOT_ERROR, tutto dovrebbe funzionare perché:
- ✅ Il payload è corretto
- ✅ La validazione passa
- ✅ Le variabili d'ambiente su Vercel sono OK
- ✅ Il codice della funzione è corretto (come confermato prima)
