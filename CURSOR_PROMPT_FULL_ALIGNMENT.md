# Cursor Prompt - Allineamento Completo Orchestrator, Landing, Main App

**Usa questo prompt su Cursor per ciascun progetto per sincronizzare il flusso AI**

---

## 🎯 ISTRUZIONI D'USO

1. **Apri Cursor sul progetto** (Orchestrator, Landing, o Main App)
2. **Copia tutto il contenuto di questo file**
3. **Incolla in Cursor**
4. **Sostituisci `[PROJECT_NAME]`** con:
   - `ORCHESTRATOR` per il progetto Orchestrator
   - `LANDING` per il progetto Landing
   - `MAIN_APP` per il progetto Main App
5. **Segui le istruzioni specifiche per il tuo progetto**

---

## 📖 FLUSSO COMPLETO - SPIEGAZIONE DETTAGLIATA

### 🎬 IL FLUSSO IN PILLOLE

```
1. MAESTRO (Main App) → Inserisce dati (servizi, meeting points, regole, policy)
   ↓
2. Dati salvati in SUPABASE (instructor_services, instructor_meeting_points, instructor_rules, policy_chunks)
   ↓
3. CLIENTE (Landing/WhatsApp) → Scrive un messaggio
   ↓
4. LANDING/WHATSAPP → Invia messaggio a Orchestrator (ingest-inbound)
   ↓
5. ORCHESTRATOR → Recupera TUTTI i dati del maestro da Supabase
   ↓
6. ORCHESTRATOR → Genera risposta AI usando i dati del maestro
   ↓
7. ORCHESTRATOR → Restituisce replyText alla Landing/WhatsApp
   ↓
8. LANDING/WHATSAPP → Mostra replyText al cliente
```

### 🔄 FLUSSO DETTAGLIATO CON TUTTE LE CASISTICHE

#### **CASISTICA 1: Flusso Normale (Messaggio → Risposta AI)**

```
1. Cliente scrive sulla Landing: "Quanto costa una lezione?"
   ↓
2. Landing chiama: POST /functions/v1/ingest-inbound
   Headers: { "x-fd-ingest-key": "zixxe8-Bazjib-nujkap" }
   Body: {
     channel: "landing",
     external_thread_id: "webchat-123",
     instructor_id: "497c7091-0aee-4a86-84a9-b737c187359a",
     text: "Quanto costa una lezione?"
   }
   ↓
3. Orchestrator (ingest-inbound):
   a) Verifica autenticazione (x-fd-ingest-key)
   b) Crea/aggiorna conversation_threads
   c) Inserisce messaggio in conversation_messages
   d) Verifica handoff_to_human (se true → skip AI)
   e) Se non in handoff:
      - Recupera dati istruttore (instructors)
      - Recupera servizi (instructor_services, is_active=true)
      - Recupera meeting points (instructor_meeting_points, is_active=true)
      - Recupera regole (instructor_rules, is_active=true)
      - Recupera policy chunks (policy_chunks, RAG search)
      - Recupera storia conversazione (ultimi 10 messaggi)
      - Genera embedding del messaggio utente
      - Cerca chunks rilevanti (similarity search)
      - Costruisce prompt completo con TUTTI i dati
      - Chiama OpenAI gpt-4o-mini
      - Riceve risposta AI
   f) Inserisce risposta AI in conversation_messages
   g) Restituisce replyText
   ↓
4. Landing riceve risposta:
   {
     ok: true,
     replyText: "Le lezioni private costano €80 all'ora...",
     handoff_to_human: false
   }
   ↓
5. Landing mostra replyText al cliente nella chat
```

#### **CASISTICA 2: Handoff to Human (Conversazione Passata a Istruttore)**

```
1. Cliente scrive: "Voglio parlare con un istruttore"
   ↓
2. Orchestrator:
   a) Verifica handoff_to_human nel thread
   b) Se handoff_to_human = true:
      - NON genera risposta AI
      - Restituisce: { replyText: null, handoff_to_human: true }
   ↓
3. Landing riceve:
   {
     ok: true,
     replyText: null,
     handoff_to_human: true
   }
   ↓
4. Landing mostra: "Ti metto in contatto con un istruttore. Ti risponderà a breve."
```

**Come si attiva handoff:**
- Istruttore imposta manualmente `handoff_to_human = true` nel thread
- Make.com può impostare handoff tramite webhook
- L'AI può suggerire handoff se il cliente lo richiede esplicitamente

#### **CASISTICA 3: Deduplication (Messaggio Duplicato)**

```
1. Cliente invia lo stesso messaggio due volte (es: doppio click)
   ↓
2. Orchestrator:
   a) Verifica external_message_id nel database
   b) Se messaggio già presente:
      - NON inserisce messaggio duplicato
      - NON genera nuova risposta AI
      - Restituisce: { deduped: true, replyText: "Messaggio già ricevuto." }
   ↓
3. Landing riceve:
   {
     ok: true,
     deduped: true,
     replyText: "Messaggio già ricevuto."
   }
```

#### **CASISTICA 4: Errore Autenticazione**

```
1. Landing chiama ingest-inbound SENZA x-fd-ingest-key o con key sbagliata
   ↓
2. Orchestrator:
   a) Verifica header x-fd-ingest-key
   b) Se key mancante o errata:
      - Restituisce: 401 Unauthorized
      - Body: { ok: false, error: "unauthorized" }
   ↓
3. Landing riceve errore 401
   ↓
4. Landing mostra messaggio di errore al cliente
```

#### **CASISTICA 5: Istruttore Non Trovato**

```
1. Landing chiama con instructor_id che non esiste
   ↓
2. Orchestrator:
   a) Cerca istruttore in instructors table
   b) Se non trovato:
      - Logga warning
      - Restituisce: { ok: true, replyText: null }
      - Oppure: genera risposta generica senza dati istruttore
   ↓
3. Landing riceve risposta senza replyText
   ↓
4. Landing mostra messaggio generico o errore
```

#### **CASISTICA 6: Nessun Dato Istruttore (Servizi/Meeting Points/Rules Vuoti)**

```
1. Cliente scrive: "Quanto costa una lezione?"
   ↓
2. Orchestrator:
   a) Recupera instructor_services → Array vuoto
   b) Recupera instructor_meeting_points → Array vuoto
   c) Recupera instructor_rules → Array vuoto
   d) Genera prompt AI con:
      - Dati istruttore base (name, email)
      - Policy chunks (se disponibili)
      - Storia conversazione
      - MA senza servizi/meeting points/regole
   e) AI genera risposta generica: "Contattami per informazioni sui prezzi"
   ↓
3. Landing riceve risposta generica
```

**IMPORTANTE:** L'AI deve gestire gracefully quando i dati sono vuoti.

#### **CASISTICA 7: Policy Chunks Non Trovati (RAG Vuoto)**

```
1. Cliente scrive: "Quali sono le vostre regole di cancellazione?"
   ↓
2. Orchestrator:
   a) Genera embedding del messaggio
   b) Cerca chunks rilevanti in policy_chunks
   c) Se nessun chunk trovato (similarity < threshold):
      - Genera prompt AI SENZA policy chunks
      - AI usa solo dati istruttore e servizi/regole
   d) AI genera risposta basata su dati disponibili
   ↓
3. Landing riceve risposta (può essere meno precisa se mancano policy)
```

#### **CASISTICA 8: Errore OpenAI (API Key Mancante o Rate Limit)**

```
1. Cliente scrive messaggio
   ↓
2. Orchestrator:
   a) Tenta generare risposta AI
   b) Se OPENAI_API_KEY mancante:
      - Logga warning
      - Restituisce: { ok: true, replyText: null }
   c) Se rate limit o errore API:
      - Logga errore
      - Restituisce: { ok: true, replyText: null }
      - Oppure: inserisce evento in conversation_events per retry
   ↓
3. Landing riceve replyText: null
   ↓
4. Landing mostra: "Risposta in elaborazione..." o messaggio di errore
```

#### **CASISTICA 9: Conversazione Lunga (Molti Messaggi)**

```
1. Cliente ha già inviato 20+ messaggi
   ↓
2. Orchestrator:
   a) Recupera ultimi 10 messaggi (limite per contesto)
   b) Genera prompt con:
      - Dati istruttore
      - Servizi/meeting points/regole
      - Policy chunks rilevanti
      - Ultimi 10 messaggi (non tutti)
   c) AI genera risposta considerando contesto recente
   ↓
3. Landing riceve risposta contestualizzata
```

#### **CASISTICA 10: Primo Messaggio (Nessuna Storia Conversazione)**

```
1. Cliente scrive il primo messaggio: "Ciao"
   ↓
2. Orchestrator:
   a) Crea nuovo thread in conversation_threads
   b) Recupera dati istruttore
   c) Recupera servizi/meeting points/regole
   d) Genera prompt SENZA storia conversazione
   e) AI genera risposta di benvenuto: "Ciao! Come posso aiutarti?"
   ↓
3. Landing riceve risposta di benvenuto
```

#### **CASISTICA 11: WhatsApp (Attualmente Senza AI Avanzata)**

```
1. Cliente scrive su WhatsApp: "Prenota una lezione"
   ↓
2. whatsapp-webhook riceve messaggio
   ↓
3. Orchestrator (whatsapp-webhook):
   a) Verifica firma webhook WhatsApp
   b) Inserisce messaggio in conversation_messages
   c) computeNextAction (keyword matching):
      - Cerca keyword: "prenota", "lezione", "book"
      - Se trova → Risposta predefinita: "Perfetto! Per prenotare..."
      - Altrimenti → Nessuna risposta automatica
   d) NON chiama ingest-inbound (quindi NO AI avanzata)
   ↓
4. WhatsApp riceve risposta predefinita (se keyword match)
```

**NOTA:** Per abilitare AI su WhatsApp, modificare `whatsapp-webhook` per chiamare `ingest-inbound`.

#### **CASISTICA 12: Messaggio Vuoto o Solo Spazi**

```
1. Cliente invia messaggio vuoto o solo spazi
   ↓
2. Orchestrator:
   a) Valida payload
   b) Se text è vuoto o solo spazi:
      - Restituisce: 400 Bad Request
      - Body: { ok: false, error: "text is required" }
   ↓
3. Landing riceve errore 400
   ↓
4. Landing mostra errore di validazione
```

#### **CASISTICA 13: Thread Esistente (Conversazione Continua)**

```
1. Cliente scrive secondo messaggio nella stessa conversazione
   ↓
2. Orchestrator:
   a) Trova thread esistente tramite external_thread_id
   b) Aggiorna conversation_threads (non crea nuovo)
   c) Inserisce nuovo messaggio in conversation_messages
   d) Recupera storia conversazione (include messaggi precedenti)
   e) Genera risposta AI con contesto completo
   ↓
3. Landing riceve risposta contestualizzata
```

#### **CASISTICA 14: Dati Istruttore Parziali (Alcuni Campi Mancanti)**

```
1. Cliente scrive: "Dove ci incontriamo?"
   ↓
2. Orchestrator:
   a) Recupera instructor_meeting_points
   b) Se meeting points vuoti MA instructor ha metadata.meeting_point_default:
      - Usa meeting point di default
   c) Se nessun meeting point disponibile:
      - AI genera risposta: "Contattami per concordare il punto di incontro"
   ↓
3. Landing riceve risposta appropriata
```

---

## 📋 PROMPT COMPLETO PER CURSOR

```
PROJECT: [PROJECT_NAME]

🎯 OBIETTIVO: Allineare e sincronizzare il flusso AI completo tra Orchestrator, Landing e Main App per garantire che l'AI generi risposte usando TUTTI i dati inseriti dall'istruttore nella Main App, gestendo tutte le casistiche possibili.

## 🎬 FLUSSO COMPLETO - SPIEGAZIONE DETTAGLIATA

### IL FLUSSO IN PILLOLE

```
1. MAESTRO (Main App) → Inserisce dati (servizi, meeting points, regole, policy)
   ↓
2. Dati salvati in SUPABASE (instructor_services, instructor_meeting_points, instructor_rules, policy_chunks)
   ↓
3. CLIENTE (Landing/WhatsApp) → Scrive un messaggio
   ↓
4. LANDING/WHATSAPP → Invia messaggio a Orchestrator (ingest-inbound)
   ↓
5. ORCHESTRATOR → Recupera TUTTI i dati del maestro da Supabase
   ↓
6. ORCHESTRATOR → Genera risposta AI usando i dati del maestro
   ↓
7. ORCHESTRATOR → Restituisce replyText alla Landing/WhatsApp
   ↓
8. LANDING/WHATSAPP → Mostra replyText al cliente
```

### ARCHITETTURA COMPLETA DEL SISTEMA

```
┌─────────────────────────────────────────────────────────────┐
│                    MAIN APP (Istruttore)                    │
│  /instructor-setup → Servizi, Meeting Points, Regole       │
│  /settings → Configurazioni generali                        │
│  /policy → Documenti policy                                 │
└───────────────────────┬─────────────────────────────────────┘
                        │
                        │ Salva dati in Supabase
                        ▼
┌─────────────────────────────────────────────────────────────┐
│                      SUPABASE DATABASE                      │
│  - instructors (name, email, metadata)                      │
│  - instructor_services (servizi offerti)                   │
│  - instructor_meeting_points (punti di incontro)           │
│  - instructor_rules (regole)                                │
│  - policy_docs → policy_chunks (RAG embeddings)            │
│  - conversation_threads (handoff_to_human, stato)          │
│  - conversation_messages (storia conversazione)            │
│  - conversation_events (eventi per Make.com)                │
└───────────────────────┬─────────────────────────────────────┘
                        │
                        │ AI legge dati
                        ▼
┌─────────────────────────────────────────────────────────────┐
│                  ORCHESTRATOR                               │
│  ingest-inbound → generateImmediateAIReply()                  │
│    ├─ Verifica autenticazione (x-fd-ingest-key)            │
│    ├─ Verifica deduplication (external_message_id)         │
│    ├─ Verifica handoff_to_human (se true → skip AI)        │
│    ├─ Recupera: instructors                                 │
│    ├─ Recupera: instructor_services (⚠️ MANCA)              │
│    ├─ Recupera: instructor_meeting_points (⚠️ MANCA)       │
│    ├─ Recupera: instructor_rules (⚠️ MANCA)                │
│    ├─ Recupera: policy_chunks (RAG) ✅                      │
│    ├─ Recupera: conversation_messages (storia) ✅            │
│    ├─ Genera embedding messaggio utente                     │
│    ├─ Cerca chunks rilevanti (similarity search)            │
│    ├─ Costruisce prompt completo con TUTTI i dati          │
│    └─ Chiama OpenAI gpt-4o-mini → Genera risposta           │
└───────────────────────┬─────────────────────────────────────┘
                        │
                        │ Restituisce replyText
                        ▼
┌─────────────────────────────────────────────────────────────┐
│              LANDING PAGE / WHATSAPP                         │
│  Mostra replyText immediatamente nella chat                 │
│  Gestisce handoff_to_human, errori, deduplication            │
└─────────────────────────────────────────────────────────────┘
```

## 🔄 TUTTE LE CASISTICHE POSSIBILI

### CASISTICA 1: Flusso Normale (Messaggio → Risposta AI) ✅

**Scenario:** Cliente scrive, AI risponde usando dati istruttore.

**Flusso:**
1. Cliente: "Quanto costa una lezione?"
2. Landing → POST /functions/v1/ingest-inbound
3. Orchestrator:
   - Verifica auth ✅
   - Crea/aggiorna thread ✅
   - Inserisce messaggio ✅
   - Verifica handoff (false) ✅
   - Recupera TUTTI i dati istruttore ✅
   - Genera risposta AI ✅
4. Landing riceve: `{ ok: true, replyText: "Le lezioni private costano €80..." }`
5. Landing mostra replyText ✅

### CASISTICA 2: Handoff to Human ⚠️

**Scenario:** Conversazione passata a istruttore umano.

**Flusso:**
1. Thread ha `handoff_to_human = true`
2. Orchestrator:
   - Verifica handoff → true
   - **SKIP** generazione AI
   - Restituisce: `{ replyText: null, handoff_to_human: true }`
3. Landing mostra: "Ti metto in contatto con un istruttore..."

**Come si attiva:**
- Istruttore imposta manualmente
- Make.com webhook
- AI suggerisce handoff

### CASISTICA 3: Deduplication 🔄

**Scenario:** Messaggio duplicato (doppio click).

**Flusso:**
1. Cliente invia stesso messaggio due volte
2. Orchestrator:
   - Verifica `external_message_id` esistente
   - **SKIP** inserimento duplicato
   - **SKIP** generazione AI
   - Restituisce: `{ deduped: true, replyText: "Messaggio già ricevuto." }`
3. Landing mostra messaggio deduplication

### CASISTICA 4: Errore Autenticazione 🔒

**Scenario:** Key mancante o errata.

**Flusso:**
1. Landing chiama SENZA `x-fd-ingest-key` o key sbagliata
2. Orchestrator:
   - Verifica auth → FAIL
   - Restituisce: `401 Unauthorized { ok: false, error: "unauthorized" }`
3. Landing mostra errore autenticazione

### CASISTICA 5: Istruttore Non Trovato ❌

**Scenario:** `instructor_id` non esiste nel database.

**Flusso:**
1. Landing chiama con `instructor_id` inesistente
2. Orchestrator:
   - Cerca istruttore → NOT FOUND
   - Logga warning
   - Restituisce: `{ ok: true, replyText: null }` (o risposta generica)
3. Landing mostra messaggio generico

### CASISTICA 6: Dati Vuoti (Nessun Servizio/Meeting Point/Regola) 📭

**Scenario:** Istruttore non ha ancora inserito dati.

**Flusso:**
1. Cliente: "Quanto costa una lezione?"
2. Orchestrator:
   - Recupera `instructor_services` → Array vuoto
   - Recupera `instructor_meeting_points` → Array vuoto
   - Recupera `instructor_rules` → Array vuoto
   - Genera prompt AI SENZA servizi/meeting points/regole
   - AI genera risposta generica: "Contattami per informazioni sui prezzi"
3. Landing riceve risposta generica

**IMPORTANTE:** L'AI deve gestire gracefully quando i dati sono vuoti.

### CASISTICA 7: Policy Chunks Non Trovati (RAG Vuoto) 📄

**Scenario:** Nessun documento policy caricato o chunks non rilevanti.

**Flusso:**
1. Cliente: "Quali sono le regole di cancellazione?"
2. Orchestrator:
   - Genera embedding messaggio
   - Cerca chunks rilevanti → Nessun chunk trovato (similarity < threshold)
   - Genera prompt AI SENZA policy chunks
   - AI usa solo dati istruttore e regole (se disponibili)
3. Landing riceve risposta (può essere meno precisa)

### CASISTICA 8: Errore OpenAI (API Key Mancante o Rate Limit) ⚠️

**Scenario:** OpenAI API non disponibile.

**Flusso:**
1. Orchestrator tenta generare risposta AI
2. Se `OPENAI_API_KEY` mancante:
   - Logga warning
   - Restituisce: `{ ok: true, replyText: null }`
3. Se rate limit o errore API:
   - Logga errore
   - Restituisce: `{ ok: true, replyText: null }`
   - Oppure: inserisce evento in `conversation_events` per retry
4. Landing mostra: "Risposta in elaborazione..." o errore

### CASISTICA 9: Conversazione Lunga (Molti Messaggi) 💬

**Scenario:** Cliente ha già inviato 20+ messaggi.

**Flusso:**
1. Orchestrator:
   - Recupera **ultimi 10 messaggi** (limite per contesto)
   - Genera prompt con contesto recente
   - AI genera risposta considerando solo ultimi messaggi
2. Landing riceve risposta contestualizzata

### CASISTICA 10: Primo Messaggio (Nessuna Storia) 👋

**Scenario:** Primo messaggio del cliente.

**Flusso:**
1. Cliente: "Ciao"
2. Orchestrator:
   - Crea nuovo thread
   - Recupera dati istruttore
   - Genera prompt SENZA storia conversazione
   - AI genera risposta di benvenuto: "Ciao! Come posso aiutarti?"
3. Landing riceve risposta di benvenuto

### CASISTICA 11: WhatsApp (Senza AI Avanzata) 📱

**Scenario:** Messaggio da WhatsApp (attualmente solo keyword matching).

**Flusso:**
1. Cliente scrive su WhatsApp: "Prenota una lezione"
2. `whatsapp-webhook` riceve messaggio
3. Orchestrator:
   - Verifica firma webhook ✅
   - Inserisce messaggio ✅
   - `computeNextAction` (keyword matching):
     - Cerca keyword: "prenota", "lezione", "book"
     - Se trova → Risposta predefinita
     - Altrimenti → Nessuna risposta
   - **NON chiama ingest-inbound** (quindi NO AI avanzata)
4. WhatsApp riceve risposta predefinita (se keyword match)

**NOTA:** Per abilitare AI su WhatsApp, modificare `whatsapp-webhook` per chiamare `ingest-inbound`.

### CASISTICA 12: Messaggio Vuoto o Solo Spazi 🚫

**Scenario:** Cliente invia messaggio vuoto.

**Flusso:**
1. Landing invia `text: ""` o `text: "   "`
2. Orchestrator:
   - Valida payload
   - Se text vuoto o solo spazi:
     - Restituisce: `400 Bad Request { ok: false, error: "text is required" }`
3. Landing mostra errore validazione

### CASISTICA 13: Thread Esistente (Conversazione Continua) 🔄

**Scenario:** Cliente scrive secondo messaggio nella stessa conversazione.

**Flusso:**
1. Cliente scrive secondo messaggio
2. Orchestrator:
   - Trova thread esistente tramite `external_thread_id`
   - Aggiorna thread (non crea nuovo)
   - Inserisce nuovo messaggio
   - Recupera storia conversazione (include messaggi precedenti)
   - Genera risposta AI con contesto completo
3. Landing riceve risposta contestualizzata

### CASISTICA 14: Dati Parziali (Alcuni Campi Mancanti) 📋

**Scenario:** Istruttore ha alcuni dati ma non tutti.

**Flusso:**
1. Cliente: "Dove ci incontriamo?"
2. Orchestrator:
   - Recupera `instructor_meeting_points` → Array vuoto
   - Verifica `instructor.metadata.meeting_point_default`
   - Se default disponibile → Usa default
   - Se nessun meeting point → AI: "Contattami per concordare il punto di incontro"
3. Landing riceve risposta appropriata

## IMPLEMENTAZIONE PER PROGETTO

### ⚙️ Se PROJECT = ORCHESTRATOR

**File da modificare:**

1. **`supabase/functions/ingest-inbound/index.ts`**
   - Funzione: `generateImmediateAIReply()` (linea ~624)
   - Aggiungere recupero di services, meeting_points, rules
   - Gestire tutte le casistiche (handoff, deduplication, errori)

2. **`supabase/functions/_shared/ragSearch.ts`**
   - Funzione: `buildRAGPrompt()` (linea ~95)
   - Modificare per includere services, meeting_points, rules nel prompt
   - Gestire gracefully quando dati sono vuoti

**CODICE DA AGGIUNGERE:**

In `generateImmediateAIReply()`, dopo aver recuperato `instructor` (linea ~650), aggiungere:

```typescript
// Recupera servizi (solo is_active=true, ordinati per display_order)
const { data: services } = await supabase
  .from("instructor_services")
  .select("*")
  .eq("instructor_id", instructorData.id)
  .eq("is_active", true)
  .order("display_order", { ascending: true, nullsFirst: false });

// Recupera meeting points (solo is_active=true, ordinati per display_order)
const { data: meetingPoints } = await supabase
  .from("instructor_meeting_points")
  .select("*")
  .eq("instructor_id", instructorData.id)
  .eq("is_active", true)
  .order("display_order", { ascending: true, nullsFirst: false });

// Recupera regole (solo is_active=true, ordinati per display_order)
const { data: rules } = await supabase
  .from("instructor_rules")
  .select("*")
  .eq("instructor_id", instructorData.id)
  .eq("is_active", true)
  .order("display_order", { ascending: true, nullsFirst: false });

// Gestisci gracefully se le tabelle non esistono o sono vuote
const servicesList = services || [];
const meetingPointsList = meetingPoints || [];
const rulesList = rules || [];
```

**Modificare chiamata a `buildRAGPrompt()`:**

```typescript
const ragPrompt = buildRAGPrompt(
  userMessage,
  instructorData,
  chunks,
  servicesList,
  meetingPointsList,
  rulesList
);
```

**Modificare `buildRAGPrompt()` in `_shared/ragSearch.ts`:**

```typescript
export function buildRAGPrompt(
  userMessage: string,
  instructorData: {
    id: string;
    name?: string;
    email?: string;
    metadata?: Record<string, unknown>;
  },
  chunks: Array<{
    chunk_text: string;
    doc_title: string;
    similarity: number;
  }>,
  services?: Array<{
    service_name: string;
    description?: string;
    price?: number;
    duration?: number;
    currency?: string;
  }>,
  meetingPoints?: Array<{
    name: string;
    address?: string;
    coordinates?: { lat: number; lng: number };
    what3words?: string;
  }>,
  rules?: Array<{
    rule_type: string;
    rule_title: string;
    rule_description?: string;
  }>
): string {
  let prompt = `You are an AI assistant helping a ski instructor respond to customer inquiries.\n\n`;

  // Instructor information
  prompt += `INSTRUCTOR INFORMATION:\n`;
  if (instructorData.name) {
    prompt += `- Name: ${instructorData.name}\n`;
  }
  if (instructorData.email) {
    prompt += `- Email: ${instructorData.email}\n`;
  }
  const metadata = instructorData.metadata || {};
  if (metadata.calendar_id) {
    prompt += `- Calendar ID: ${metadata.calendar_id}\n`;
  }
  if (metadata.timezone) {
    prompt += `- Timezone: ${metadata.timezone}\n`;
  }
  prompt += `\n`;

  // Services
  if (services && services.length > 0) {
    prompt += `SERVICES OFFERED:\n`;
    services.forEach((service, index) => {
      prompt += `${index + 1}. ${service.service_name}`;
      if (service.description) {
        prompt += `: ${service.description}`;
      }
      if (service.price !== undefined && service.price !== null) {
        const currency = service.currency || "EUR";
        prompt += ` - Price: ${service.price} ${currency}`;
      }
      if (service.duration) {
        prompt += `, Duration: ${service.duration} minutes`;
      }
      prompt += `\n`;
    });
    prompt += `\n`;
  }

  // Meeting points
  if (meetingPoints && meetingPoints.length > 0) {
    prompt += `MEETING POINTS:\n`;
    meetingPoints.forEach((point, index) => {
      prompt += `${index + 1}. ${point.name}`;
      if (point.address) {
        prompt += `: ${point.address}`;
      }
      if (point.coordinates) {
        prompt += ` (Coordinates: ${point.coordinates.lat}, ${point.coordinates.lng})`;
      }
      if (point.what3words) {
        prompt += `, What3Words: ${point.what3words}`;
      }
      prompt += `\n`;
    });
    prompt += `\n`;
  }

  // Rules
  if (rules && rules.length > 0) {
    prompt += `RULES:\n`;
    rules.forEach((rule, index) => {
      prompt += `${index + 1}. ${rule.rule_type}: ${rule.rule_title}`;
      if (rule.rule_description) {
        prompt += ` - ${rule.rule_description}`;
      }
      prompt += `\n`;
    });
    prompt += `\n`;
  }

  // Policy chunks
  if (chunks && chunks.length > 0) {
    prompt += `RELEVANT POLICY INFORMATION:\n`;
    chunks.forEach((chunk, index) => {
      prompt += `[${index + 1}] From: ${chunk.doc_title} (relevance: ${(chunk.similarity * 100).toFixed(1)}%)\n`;
      prompt += `${chunk.chunk_text}\n\n`;
    });
  }

  // User message
  prompt += `CUSTOMER MESSAGE:\n${userMessage}\n\n`;

  // Instructions
  prompt += `INSTRUCTIONS:\n`;
  prompt += `- Use the instructor information, services, meeting points, and rules to provide accurate responses\n`;
  prompt += `- Use the policy information to answer questions about policies\n`;
  prompt += `- Be concise and friendly\n`;
  prompt += `- Suggest relevant services and meeting points when appropriate\n`;
  prompt += `- If the customer needs human assistance, suggest they contact the instructor directly\n`;
  prompt += `- If you don't have specific information, say so politely and suggest contacting the instructor\n`;

  return prompt;
}
```

### 🌐 Se PROJECT = LANDING

**Verifica e correzione:**

1. **Chiamata a `ingest-inbound`:**
   - [ ] Include `instructor_id` nel payload
   - [ ] Header `x-fd-ingest-key: zixxe8-Bazjib-nujkap` è configurato
   - [ ] `external_thread_id` è stabile per la stessa conversazione
   - [ ] `external_message_id` è unico per ogni messaggio (per deduplication)

2. **Gestione risposta:**
   - [ ] Gestisce `replyText` nella risposta JSON
   - [ ] Mostra `replyText` immediatamente nella chat
   - [ ] Gestisce `handoff_to_human` flag (mostra messaggio appropriato)
   - [ ] Gestisce `deduped` flag (mostra messaggio deduplication)

3. **Gestione errori:**
   - [ ] Gestisce 401 (Unauthorized) - verifica key
   - [ ] Gestisce 400 (Bad Request) - verifica payload
   - [ ] Gestisce 503 (Service Unavailable) - retry con backoff
   - [ ] Gestisce 500 (Internal Server Error) - mostra errore generico
   - [ ] Mostra messaggi di errore user-friendly

**ESEMPIO IMPLEMENTAZIONE:**

```typescript
async function sendMessage(
  text: string,
  threadId: string,
  instructorId?: string
): Promise<void> {
  try {
    const response = await fetch(
      "https://ncvkipizapkhawnaqssm.supabase.co/functions/v1/ingest-inbound",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-fd-ingest-key": "zixxe8-Bazjib-nujkap",
        },
        body: JSON.stringify({
          channel: "landing",
          external_thread_id: threadId,
          instructor_id: instructorId,
          text: text,
          external_message_id: `landing-${Date.now()}-${Math.random()}`,
        }),
      }
    );

    if (!response.ok) {
      if (response.status === 401) {
        throw new Error("Errore di autenticazione. Verifica la configurazione.");
      }
      if (response.status === 400) {
        throw new Error("Messaggio non valido. Riprova.");
      }
      throw new Error(`Errore ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();

    if (!data.ok) {
      throw new Error(data.error || "Errore sconosciuto");
    }

    // ✅ GESTISCI replyText
    if (data.deduped) {
      // Messaggio duplicato
      addMessageToChat({
        text: "Messaggio già ricevuto.",
        role: "system",
        timestamp: new Date(),
      });
    } else if (data.handoff_to_human) {
      // Handoff attivo
      addMessageToChat({
        text: "Ti metto in contatto con un istruttore. Ti risponderà a breve.",
        role: "system",
        timestamp: new Date(),
      });
    } else if (data.replyText) {
      // Risposta AI
      addMessageToChat({
        text: data.replyText,
        role: "assistant",
        timestamp: new Date(),
      });
    } else {
      // Fallback (non dovrebbe accadere)
      addMessageToChat({
        text: "Risposta in elaborazione...",
        role: "system",
        timestamp: new Date(),
      });
    }
  } catch (error) {
    console.error("Errore invio messaggio:", error);
    showError("Errore nell'invio del messaggio. Riprova.");
    throw error;
  }
}
```

### 📱 Se PROJECT = MAIN_APP

**Verifica salvataggio in Supabase:**

1. **`instructors` table:**
   - [ ] Salva `name`, `email`
   - [ ] Salva `metadata` con `calendar_id`, `timezone`, `meeting_point_default`
   - [ ] Collega `auth_user_id` correttamente

2. **`instructor_services` table:**
   - [ ] Salva servizi con tutti i campi (service_name, description, price, duration)
   - [ ] Gestisce `is_active` (default: true)
   - [ ] Gestisce `display_order` per ordinamento
   - [ ] Permette disattivazione servizi (is_active = false)

3. **`instructor_meeting_points` table:**
   - [ ] Salva meeting points con tutti i campi (name, address, coordinates, what3words)
   - [ ] Gestisce `is_active` (default: true)
   - [ ] Gestisce `display_order` per ordinamento
   - [ ] Permette disattivazione meeting points

4. **`instructor_rules` table:**
   - [ ] Salva regole con tutti i campi (rule_type, rule_title, rule_description)
   - [ ] Gestisce `is_active` (default: true)
   - [ ] Gestisce `display_order` per ordinamento
   - [ ] Permette disattivazione regole

5. **`policy_docs` → `policy_chunks`:**
   - [ ] Carica documenti in `policy_docs`
   - [ ] Documenti vengono chunkizzati automaticamente
   - [ ] Chunks vengono embeddati e salvati in `policy_chunks`
   - [ ] Gestisce versioni documenti (se necessario)

## PROMPT AI COMPLETO (Esempio Output)

Dopo l'implementazione, il prompt generato dovrebbe essere:

```
You are an AI assistant helping a ski instructor respond to customer inquiries.

INSTRUCTOR INFORMATION:
- Name: Mario Rossi
- Email: mario@example.com
- Calendar ID: cal_123

SERVICES OFFERED:
1. Lezione Privata: Lezione individuale personalizzata - Price: 80 EUR, Duration: 60 minutes
2. Lezione di Gruppo: Lezione per 2-4 persone - Price: 50 EUR, Duration: 120 minutes

MEETING POINTS:
1. Pista Principale: Via Roma 1, Cortina d'Ampezzo (Coordinates: 46.5369,12.1354), What3Words: ///example.words.here
2. Hotel Cristallo: Via del Parco 1 (Coordinates: 46.5400,12.1400)

RULES:
1. cancellation: Cancellazione gratuita - Cancellazione gratuita fino a 24 ore prima della lezione
2. payment: Pagamento anticipato - Pagamento anticipato richiesto per lezioni private

RELEVANT POLICY INFORMATION:
[1] From: Terms and Conditions (relevance: 85.2%)
Le lezioni possono essere cancellate gratuitamente fino a 24 ore prima della data prevista...

CONVERSATION HISTORY:
User: Ciao
Assistant: Ciao! Come posso aiutarti?
User: Quanto costa una lezione?

CUSTOMER MESSAGE:
Quanto costa una lezione?

INSTRUCTIONS:
- Use the instructor information, services, meeting points, and rules to provide accurate responses
- Use the policy information to answer questions about policies
- Use the conversation history to maintain context
- Be concise and friendly
- Suggest relevant services and meeting points when appropriate
- If the customer needs human assistance, suggest they contact the instructor directly
- If you don't have specific information, say so politely and suggest contacting the instructor

Response:
```

## CHECKLIST FINALE

### ✅ Orchestrator
- [ ] `generateImmediateAIReply` recupera `instructor_services`
- [ ] `generateImmediateAIReply` recupera `instructor_meeting_points`
- [ ] `generateImmediateAIReply` recupera `instructor_rules`
- [ ] `buildRAGPrompt` include services, meeting_points, rules nel prompt
- [ ] Gestisce gracefully quando dati sono vuoti
- [ ] Gestisce handoff_to_human (skip AI se true)
- [ ] Gestisce deduplication (skip AI se deduped)
- [ ] Gestisce errori OpenAI gracefully
- [ ] Il prompt OpenAI è completo con tutti i dati
- [ ] Test: L'AI risponde usando servizi, meeting points e regole

### ✅ Landing
- [ ] Chiama `ingest-inbound` con `instructor_id`
- [ ] Header `x-fd-ingest-key` è configurato correttamente
- [ ] `external_thread_id` è stabile per la stessa conversazione
- [ ] `external_message_id` è unico per ogni messaggio
- [ ] Gestisce `replyText` nella risposta
- [ ] Mostra `replyText` immediatamente nella chat
- [ ] Gestisce `handoff_to_human` flag
- [ ] Gestisce `deduped` flag
- [ ] Gestisce errori gracefully (401, 400, 503, 500)

### ✅ Main App
- [ ] Salva dati in `instructors` table
- [ ] Salva dati in `instructor_services` table (con `is_active`, `display_order`)
- [ ] Salva dati in `instructor_meeting_points` table (con `is_active`, `display_order`)
- [ ] Salva dati in `instructor_rules` table (con `is_active`, `display_order`)
- [ ] Carica documenti policy che vengono chunkizzati automaticamente
- [ ] I dati sono accessibili via Supabase (RLS policies corrette)
- [ ] Permette disattivazione dati (is_active = false)

## TEST END-TO-END

### Test 1: Flusso Normale
1. **Main App:** Inserisci servizio "Lezione Privata - €80/ora"
2. **Landing:** Invia messaggio "Quanto costa una lezione?"
3. **Verifica:** La risposta AI menziona "€80" o "Lezione Privata"

### Test 2: Handoff
1. **Orchestrator:** Imposta `handoff_to_human = true` nel thread
2. **Landing:** Invia messaggio "Ciao"
3. **Verifica:** Landing riceve `handoff_to_human: true` e mostra messaggio appropriato

### Test 3: Deduplication
1. **Landing:** Invia stesso messaggio due volte (stesso `external_message_id`)
2. **Verifica:** Seconda risposta ha `deduped: true`

### Test 4: Dati Vuoti
1. **Main App:** Non inserire servizi
2. **Landing:** Invia messaggio "Quanto costa una lezione?"
3. **Verifica:** AI genera risposta generica (non crasha)

### Test 5: Policy RAG
1. **Main App:** Carica documento policy con testo "Le lezioni costano €80"
2. **Landing:** Invia messaggio "Quanto costa?"
3. **Verifica:** La risposta AI menziona "€80" dal documento policy

## VARIABILI D'AMBIENTE

**Orchestrator (Supabase Edge Functions):**
- `FD_INGEST_KEY=zixxe8-Bazjib-nujkap` ✅
- `OPENAI_API_KEY=sk-...` ✅
- `SUPABASE_SERVICE_ROLE_KEY=...` ✅
- `SUPABASE_URL=...` ✅

**Landing:**
- `VITE_FD_INGEST_KEY=zixxe8-Bazjib-nujkap` (deve corrispondere a Orchestrator)

## NOTE IMPORTANTI

- **Tutti i dati devono essere inseriti dalla Main App** - L'AI non ha dati predefiniti
- **L'AI legge solo da Supabase** - Non ha conoscenza hardcoded
- **I dati devono essere is_active=true** - Solo dati attivi vengono usati
- **display_order** - I dati devono essere ordinati correttamente
- **RAG per policy** - I documenti policy vengono cercati con similarity search
- **Gestione graceful** - Se le tabelle non esistono, restituire array vuoti (non crashare)
- **Handoff** - Se `handoff_to_human = true`, NON generare risposta AI
- **Deduplication** - Se messaggio duplicato, NON generare nuova risposta AI
- **Errori OpenAI** - Gestire gracefully, non crashare se API non disponibile

## RIFERIMENTI

- [AI Flow Documentation: `docs/AI_FLOW_DOCUMENTATION.md`](./AI_FLOW_DOCUMENTATION.md)
- [Environment Variables: `docs/ENVIRONMENT_VARIABLES.md`](./ENVIRONMENT_VARIABLES.md)
- [Production Setup: `docs/PRODUCTION_ENV_SETUP.md`](./PRODUCTION_ENV_SETUP.md)
- Schema tabelle: `supabase/migrations/`
- Funzione AI: `supabase/functions/ingest-inbound/index.ts`
- RAG Search: `supabase/functions/_shared/ragSearch.ts`
- Get Context: `supabase/functions/get-instructor-context/index.ts` (esempio recupero dati)
```

---

## ✅ RISULTATO ATTESO

Dopo aver applicato questo prompt su tutti e tre i progetti:

1. ✅ **Main App** salva tutti i dati in Supabase
2. ✅ **Orchestrator** recupera tutti i dati (services, meeting_points, rules)
3. ✅ **Orchestrator** genera prompt AI completo
4. ✅ **Orchestrator** gestisce tutte le casistiche (handoff, deduplication, errori)
5. ✅ **Landing** riceve `replyText` con risposte personalizzate
6. ✅ **Landing** gestisce tutte le casistiche (handoff, deduplication, errori)
7. ✅ **L'AI risponde usando i dati inseriti dall'istruttore**

---

## 🔗 FILE CORRELATI

- `docs/AI_FLOW_DOCUMENTATION.md` - Documentazione completa del flusso AI
- `docs/ENVIRONMENT_VARIABLES.md` - Variabili d'ambiente necessarie
- `docs/PRODUCTION_ENV_SETUP.md` - Setup rapido per produzione
