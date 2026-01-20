# Prompt Cursor per Sincronizzare Orchestrator

## Contesto

La Landing Page si aspetta che l'Orchestrator (Supabase Edge Function `ingest-inbound`) restituisca `replyText` nella risposta immediata. Attualmente, l'Orchestrator crea un task per Make e non restituisce `replyText` immediatamente, causando il problema che l'AI non risponde nella chat.

## Obiettivo

Modificare l'Orchestrator per generare e restituire `replyText` immediatamente nella risposta, mantenendo anche il flusso asincrono per Make (opzionale).

## Prompt per Cursor

```
REPO: Orchestrator (Supabase Edge Functions)
FILE: supabase/functions/ingest-inbound/index.ts

PROBLEMA:
La Landing Page si aspetta che `ingest-inbound` restituisca `replyText` nella risposta immediata (200 OK), ma attualmente l'Orchestrator:
1. Riceve il messaggio
2. Crea un task per Make
3. Restituisce solo { ok: true, conversation_id, trace_id, message_id }
4. NON restituisce replyText

Questo causa il problema che la Landing mostra "Your instructor will reply soon" invece della risposta AI.

REQUISITI:
1. L'Orchestrator DEVE generare una risposta AI immediata (sincrona) prima di creare il task
2. La risposta DEVE essere restituita nel campo `replyText` della risposta JSON
3. Il flusso asincrono con Make può continuare in parallelo (opzionale)
4. Se `handoff_to_human = true`, restituire `replyText: null` e `handoff_to_human: true`

FLUSSO RICHIESTO:
1. Ricevi messaggio da Landing
2. Valida payload (channel, external_thread_id, text, instructor_id, etc.)
3. Crea/aggiorna conversation_thread
4. Inserisci messaggio utente in conversation_messages
5. **GENERA RISPOSTA AI IMMEDIATAMENTE**:
   - Se handoff_to_human = true → replyText: null
   - Altrimenti:
     a. Chiama get-instructor-context (o recupera dati direttamente)
     b. Chiama OpenAI con prompt RAG (instructor data + policy chunks + conversation context)
     c. Genera replyText
6. Inserisci messaggio AI in conversation_messages (role: "assistant")
7. Crea task per Make (opzionale, per azioni asincrone)
8. **RESTITUISCI RISPOSTA**:
   {
     "ok": true,
     "conversation_id": "...",
     "trace_id": "...",
     "message_id": "...",
     "replyText": "Risposta AI generata...",  // ✅ OBBLIGATORIO
     "handoff_to_human": false
   }

CONSTRAINTS:
- Timeout massimo: 25 secondi (per evitare timeout Vercel di 30s)
- Se OpenAI fallisce, restituire replyText: null (non bloccare)
- Mantenere compatibilità con il SYSTEM_CONTRACT.md
- Usare trace_id per logging e correlazione
- Includere x-request-id header nella risposta se possibile

IMPLEMENTAZIONE SUGGERITA:
1. Dopo aver inserito il messaggio utente, controlla handoff_to_human
2. Se false, chiama OpenAI direttamente (non aspettare Make):
   - Usa get-instructor-context per recuperare dati
   - Costruisci prompt RAG
   - Chiama OpenAI gpt-4o-mini o gpt-4-turbo
   - Estrai replyText dalla risposta
3. Inserisci messaggio AI in conversation_messages
4. Crea task per Make (per azioni asincrone come Google Calendar)
5. Restituisci risposta con replyText

ERROR HANDLING:
- Se OpenAI fallisce: restituire replyText: null, ma comunque ok: true
- Se get-instructor-context fallisce: usare dati minimi, generare risposta generica
- Se timeout: restituire replyText: null con timeout error

TEST:
- Invia messaggio dalla Landing
- Verifica che replyText sia presente nella risposta
- Verifica che il messaggio AI appaia nella chat
- Verifica che il task venga creato per Make (opzionale)

RIFERIMENTI:
- SYSTEM_CONTRACT.md sezione 4 (Canonical Ingest API)
- SYSTEM_CONTRACT.md sezione 6 (Concierge AI Behavior Contract)
- CONCIERGE_CHAT_IMPLEMENTATION.md per il flusso Make
```

## Note Aggiuntive

### Variabili d'Ambiente Necessarie

L'Orchestrator deve avere:
- `OPENAI_API_KEY` - Per generare risposte AI
- `FD_INGEST_KEY` - Per autenticazione
- `SUPABASE_URL` - URL del progetto
- `SUPABASE_SERVICE_ROLE_KEY` - Per accesso al database

### Prompt OpenAI Suggerito

```typescript
const systemPrompt = `You are a concierge AI assistant for FrostDesk, helping potential students book lessons with instructors.

Instructor Information:
- Name: ${instructor.name}
- Bio: ${instructor.bio || 'No bio available'}
${policyChunks.length > 0 ? `\nRelevant Policies:\n${policyChunks.map(c => c.content).join('\n\n')}` : ''}

Conversation Context:
${conversationMessages.map(m => `${m.role}: ${m.text}`).join('\n')}

Instructions:
- Answer questions about lessons, pricing, availability
- Be friendly and helpful
- If you don't know something, suggest contacting the instructor
- Keep responses concise (max 200 words)
- Respond in the same language as the user's message`;

const userMessage = lastUserMessage.text;
```

### Esempio di Risposta

```typescript
// Dopo aver generato la risposta AI
const aiResponse = await callOpenAI(systemPrompt, userMessage);

// Inserisci messaggio AI
await supabase.from('conversation_messages').insert({
  conversation_id: conversation.id,
  role: 'assistant',
  text: aiResponse.replyText,
  trace_id: traceId,
});

// Restituisci risposta
return new Response(
  JSON.stringify({
    ok: true,
    conversation_id: conversation.id,
    trace_id: traceId,
    message_id: aiMessage.id,
    replyText: aiResponse.replyText, // ✅ OBBLIGATORIO
    handoff_to_human: false,
  }),
  { status: 200, headers: { 'Content-Type': 'application/json' } }
);
```

## Verifica Post-Implementazione

Dopo aver implementato le modifiche:

1. **Test dalla Landing**:
   - Invia un messaggio
   - Verifica che `replyText` sia presente nella risposta
   - Verifica che il messaggio AI appaia nella chat

2. **Verifica Log**:
   - Browser console: `has_replyText: true`
   - Vercel logs: `replyText_length > 0`
   - Supabase logs: Messaggio AI inserito in `conversation_messages`

3. **Verifica Performance**:
   - Tempo di risposta < 25 secondi
   - Nessun timeout
   - Risposta AI di qualità
