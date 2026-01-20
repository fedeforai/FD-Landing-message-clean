# FrostDesk System Contract
## Source of Truth (Landing • Orchestrator • Main App)

**Version:** 1.0  
**Effective Date:** 2025-02-01  
**Status:** Authoritative Specification

---

## 1. Purpose of This Document

This document is the **single source of truth** for how the FrostDesk system works across three repositories: Landing, Orchestrator, and FrostDesk Main App.

### Who Must Follow This Document

- **Engineers** implementing features in any of the three repositories
- **Automation builders** (Make.com) integrating with the system
- **Operators** debugging production issues
- **Release managers** approving deployments

### What This Document Overrides

- All informal agreements and verbal specifications
- Outdated API documentation in individual repositories
- Assumptions about system behavior
- Ad-hoc integration patterns

### What This Document Defines

- **Exact API contracts** that must be implemented
- **Security boundaries** that must never be violated
- **Data ownership** rules that must be enforced
- **Failure modes** that must be handled
- **Observability standards** that must be met

**This document is law for the system. Deviations require explicit approval and contract amendment.**

---

## 2. System Components & Ownership

### Landing

**What It Owns:**
- Public-facing website UI
- Lead capture forms
- Client-side JavaScript
- Landing page deployment infrastructure

**What It MUST Do:**
- Send inbound messages to Orchestrator via canonical ingest API
- Include `idempotency_key` in all requests
- Authenticate using `x-fd-ingest-key` header
- Respect rate limiting (429 responses)
- Handle error responses gracefully

**What It MUST NEVER Do:**
- Access Supabase database directly
- Store or transmit service role keys
- Bypass Orchestrator for message delivery
- Store conversation state locally
- Make assumptions about instructor assignment

**Integration Point:**
- `POST https://{supabase-project}.supabase.co/functions/v1/ingest-inbound`
- See Section 4 for exact contract

---

### Orchestrator

**What It Owns:**
- All conversation data (`conversation_threads`, `conversation_messages`, `conversation_events`)
- Task queue (`tasks` table)
- Policy documents (`policy_docs`, `policy_chunks`, `doc_versions`)
- Inbound message ingestion logic
- AI reply generation (RAG + LLM)
- Outbound message delivery (WhatsApp)
- Human handoff state management

**What It MUST Do:**
- Accept messages via canonical ingest API (Section 4)
- Create or find conversation threads atomically
- Enforce `instructor_id` set-once rule (never overwrite existing)
- Generate `trace_id` for every request
- Log all operations to `conversation_events`
- Create tasks for external automation (Make)
- Process `ai_reply` tasks using RAG + LLM
- Send outbound messages via WhatsApp Cloud API
- Respect `handoff_to_human` flag (no AI replies when true)

**What It MUST NEVER Do:**
- Expose service role keys to client code
- Allow client-side code to bypass RLS
- Store secrets in client-accessible locations
- Modify conversation data without `trace_id`
- Create duplicate messages (idempotency required)
- Call Make.com directly (only write tasks)

**Components:**
- **Supabase Edge Functions:**
  - `ingest-inbound`: Canonical ingest endpoint (v1)
  - `whatsapp-webhook`: WhatsApp webhook handler
  - `orchestrator-command`: Instructor commands (handoff, send_message, resync)
  - `task-worker`: Processes queued tasks (requires cron scheduling)
  - `policy-ingest`: Policy document upload and chunking
- **Fastify Server** (optional, legacy): `/ingest`, `/ingest/landing`, debug endpoints

---

### FrostDesk Main App

**What It Owns:**
- Instructor authentication UI (Supabase Auth)
- Instructor dashboard and inbox UI
- Manual message sending UI
- Thread viewing UI (RLS-protected)
- Handoff triggering UI

**What It MUST Do:**
- Authenticate instructors via Supabase Auth (JWT)
- Query conversation data via Supabase client (anon key, RLS-protected)
- Call `orchestrator-command` Edge Function for actions (handoff, send_message, resync)
- Display threads filtered by `instructor_id` (RLS enforces)
- Handle authentication errors gracefully

**What It MUST NEVER Do:**
- Use service role keys (client-side or server-side)
- Bypass RLS policies
- Directly modify `conversation_threads` or `conversation_messages`
- Store conversation data locally
- Make assumptions about thread ownership

**Integration Points:**
- **Direct Supabase queries** (RLS-protected):
  - `SELECT * FROM conversation_threads WHERE instructor_id = ...` (RLS filters)
  - `SELECT * FROM conversation_messages WHERE thread_id = ...` (RLS filters)
- **Edge Function:** `POST /functions/v1/orchestrator-command` (JWT authenticated)

---

### Make (Automation Layer)

**What It Owns:**
- External automation workflows
- Integration with third-party services (calendar, CRM, email, etc.)
- Task execution logic (outside Orchestrator)

**What It MUST Do:**
- Poll `tasks` table for `status = 'queued'` tasks
- Atomically claim tasks: `UPDATE tasks SET status = 'running' WHERE id = ? AND status = 'queued'`
- Execute task actions (create calendar event, update CRM, send email, etc.)
- Write results: `UPDATE tasks SET status = 'succeeded'/'failed', result = ?, error = ?, completed_at = now()`
- Respect `idempotency_key` (skip if task with same key already succeeded)
- Handle failures gracefully (retry logic, dead letter queue)

**What It MUST NEVER Do:**
- Modify conversation data directly (`conversation_threads`, `conversation_messages`, `conversation_events`)
- Store service role keys in Make.com scenarios (use environment variables)
- Create duplicate external actions (use `idempotency_key`)
- Bypass task queue to call Orchestrator APIs directly
- Store sensitive credentials in Make.com data stores

**Integration Pattern:**
1. **Poll tasks:** `SELECT * FROM tasks WHERE status = 'queued' ORDER BY created_at ASC LIMIT 1 FOR UPDATE SKIP LOCKED`
2. **Claim task:** `UPDATE tasks SET status = 'running', started_at = now() WHERE id = ? AND status = 'queued'`
3. **Execute action:** Call external APIs, update external systems
4. **Update result:** `UPDATE tasks SET status = 'succeeded', result = {...}, completed_at = now() WHERE id = ?`
5. **Handle failure:** `UPDATE tasks SET status = 'failed', error = '...', retries = retries + 1 WHERE id = ?`

**Task Types (as defined by Orchestrator):**
- `create_gcal_event`: Create Google Calendar event
- `update_gcal_event`: Update Google Calendar event
- `cancel_gcal_event`: Cancel Google Calendar event
- `send_email`: Send email via external service
- `update_crm`: Update CRM system
- `ai_reply`: Processed by Orchestrator (not Make)

**Sending Messages via Make:**
- Make MUST call canonical ingest API: `POST /functions/v1/ingest-inbound`
- Include `idempotency_key` in request
- Authenticate using `x-fd-ingest-key` header

---

## 3. Trust Boundaries & Security Model

### Service Role Key Rules

**Where Service Role Keys ARE Allowed:**
- **Orchestrator Edge Functions:** All Edge Functions may use `SUPABASE_SERVICE_ROLE_KEY`
- **Orchestrator Fastify Server:** Server-side only, never exposed to clients
- **Make.com scenarios:** Server-side environment variables only, never in Make data stores

**Where Service Role Keys ARE FORBIDDEN:**
- **Landing:** Never, under any circumstances
- **FrostDesk Main App:** Never, under any circumstances
- **Client-side JavaScript:** Never, in any repository
- **Public repositories:** Never commit service role keys
- **Environment variable files:** Never commit `.env` files with service role keys

### Shared Secret Rules

**`INGEST_SHARED_SECRET`:**
- Used for: Landing → Orchestrator authentication
- Format: 32+ character string
- Storage: Supabase Edge Function secrets, Landing server environment variables
- Validation: Exact match required (case-sensitive)
- Rotation: Must be coordinated across Landing and Orchestrator

**`WHATSAPP_WEBHOOK_SECRET`:**
- Used for: WhatsApp webhook signature verification
- Format: HMAC-SHA256 secret
- Storage: Supabase Edge Function secrets, Meta Business Dashboard
- Validation: HMAC-SHA256 signature verification
- Rotation: Must be coordinated with Meta Business Dashboard

### RLS (Row Level Security) Rules

**Components That Bypass RLS:**
- **Orchestrator Edge Functions:** Use service role key, bypass RLS
- **Orchestrator Fastify Server:** Use service role key, bypass RLS
- **Make.com:** Uses service role key, bypass RLS (read-only access to `tasks`)

**Components That MUST Respect RLS:**
- **FrostDesk Main App:** Uses anon key, RLS enforced
- **Any client-side code:** RLS enforced

**RLS Policy Summary:**
- **`conversation_threads`:** Instructors can SELECT/UPDATE only their own threads (`instructor_id` matches)
- **`conversation_messages`:** Instructors can SELECT messages in their threads, INSERT outbound/internal messages
- **`conversation_events`:** Instructors can SELECT events in their threads, INSERT internal events
- **`tasks`:** No RLS (service role only)
- **`policy_docs`:** Instructors can SELECT/INSERT/UPDATE only their own documents

### Authentication Expectations

**Landing → Orchestrator:**
- Header: `x-fd-ingest-key: {INGEST_SHARED_SECRET}`
- No JWT required
- Rate limited per `external_thread_id` and per IP

**FrostDesk Main App → Orchestrator:**
- JWT token in `Authorization: Bearer {jwt}` header
- Token validated via Supabase Auth
- Thread ownership verified via RLS

**WhatsApp → Orchestrator:**
- HMAC-SHA256 signature in `X-Hub-Signature-256` header
- Signature verified against `WHATSAPP_WEBHOOK_SECRET`
- No JWT required

**Make → Orchestrator:**
- Header: `x-fd-ingest-key: {INGEST_SHARED_SECRET}` (for sending messages)
- Service role key for database access (for reading tasks)

---

## 4. Canonical Ingest API (v1)

**This is the ONLY allowed entry point for new messages.**

### Endpoint

```
POST https://{supabase-project}.supabase.co/functions/v1/ingest-inbound
```

**Alternative (legacy, deprecated):**
- `POST /functions/v1/ingest-v1` (alias, same implementation)

### HTTP Method

`POST` (only)

### Required Headers

```http
Content-Type: application/json
x-fd-ingest-key: {INGEST_SHARED_SECRET}
```

**Alternative header name (backward compatibility):**
- `x-ingest-key` (accepted, but `x-fd-ingest-key` preferred)

### Authentication

**Scheme:** Shared secret authentication

**Validation:**
- Header value must exactly match `INGEST_SHARED_SECRET` environment variable
- Case-sensitive
- Required in production
- Optional in development (if `INGEST_SHARED_SECRET` not set)

**Error Response (401):**
```json
{
  "ok": false,
  "error": "Invalid or missing x-fd-ingest-key",
  "trace_id": "uuid"
}
```

### Request Payload Schema

```typescript
{
  // Required fields
  channel: "landing" | "webchat" | "whatsapp" | "instagram" | "email",
  external_thread_id: string,  // Max 255 characters, stable per channel
  text: string,                // Max 5000 characters, non-empty after trim
  
  // Idempotency (strongly recommended)
  idempotency_key?: string,    // Max 255 characters, unique per message
  
  // Optional metadata
  instructor_id?: string,       // UUID format, set-once on thread
  channel_metadata?: {
    // For Landing:
    client_name?: string,
    phone?: string,
    email?: string,
    
    // For Make/webhooks:
    provider_message_id?: string,
    from_handle?: string,
    from_display_name?: string,
    from_phone_or_email?: string,
    timestamp?: string,        // ISO 8601 datetime
  },
  
  // Optional context
  metadata?: Record<string, unknown>  // Arbitrary key-value pairs
}
```

### Field Validation Rules

1. **`channel`**: Must be one of: `"landing"`, `"webchat"`, `"whatsapp"`, `"instagram"`, `"email"`
2. **`external_thread_id`**: 
   - Required, non-empty string
   - Max 255 characters
   - Must be stable across requests for same conversation
3. **`text`**: 
   - Required, non-empty after trimming whitespace
   - Max 5000 characters
   - Whitespace-only strings rejected (400 error)
4. **`idempotency_key`**: 
   - Optional but strongly recommended
   - If provided, must be unique per message
   - Used for deduplication (see Idempotency Rules below)
5. **`instructor_id`**: 
   - Must be valid UUID format (if provided)
   - Only set if thread has no existing `instructor_id` (set-once behavior)
   - If thread already has `instructor_id`, provided value is ignored (no error)

### Idempotency Rules

**If `idempotency_key` is provided:**
1. Check for existing message with same `(thread_id, provider_message_id = idempotency_key)`
2. If found, return existing message (200 OK, `message_id` of existing message)
3. If not found, insert new message

**If `idempotency_key` is NOT provided:**
1. Generate: `provider_message_id = "{channel}:{trace_id}"`
2. Insert message (may fail on duplicate if same trace_id used twice)

**Database Constraint:**
- Unique index on `(thread_id, provider_message_id)` where `provider_message_id IS NOT NULL`
- Prevents duplicate messages at database level

### Response Schema

**Success (200 OK):**
```json
{
  "ok": true,
  "trace_id": "uuid",
  "conversation_id": "uuid",  // thread_id
  "message_id": "uuid"
}
```

**Error (400 Bad Request):**
```json
{
  "ok": false,
  "error": "Missing required field: text",
  "trace_id": "uuid"
}
```

**Error (401 Unauthorized):**
```json
{
  "ok": false,
  "error": "Invalid or missing x-fd-ingest-key",
  "trace_id": "uuid"
}
```

**Error (429 Too Many Requests):**
```json
{
  "ok": false,
  "error": "Rate limit exceeded",
  "trace_id": "uuid"
}
```

**Error (500 Internal Server Error):**
```json
{
  "ok": false,
  "error": "Internal server error",
  "trace_id": "uuid"
}
```

### Error Codes

| Code | Meaning | Action |
|------|---------|--------|
| 400 | Validation error | Fix payload schema |
| 401 | Authentication failed | Verify `x-fd-ingest-key` header |
| 403 | Forbidden (CORS) | Verify origin in `ALLOWED_ORIGINS` |
| 429 | Rate limit exceeded | Wait and retry with backoff |
| 500 | Internal server error | Check Orchestrator logs, use `trace_id` |

### Rate Limiting

**Per `external_thread_id`:** Configurable (default: 10 requests per 60 seconds)
**Per IP address:** Configurable (default: 100 requests per 60 seconds)

**Rate limit storage:** `rate_limits` table (distributed across Edge Function instances)

**Rate limit response (429):**
- `Retry-After` header indicates seconds to wait
- Client should implement exponential backoff

### CORS

**If `ALLOWED_ORIGINS` environment variable is set:**
- Only requests from listed origins are allowed
- Preflight `OPTIONS` requests are handled automatically

**If `ALLOWED_ORIGINS` is not set:**
- CORS is permissive (all origins allowed)
- **Not recommended for production**

---

## 5. Conversation & Message Model

### Conversation (Thread)

**Definition:** A conversation is a persistent thread between a customer and an instructor (or system) across a single channel.

**Database Table:** `conversation_threads`

**Required Identifiers:**
- **`id`** (UUID): Internal thread identifier, primary key
- **`channel`** (text): Source channel (`"landing"`, `"webchat"`, `"whatsapp"`, `"instagram"`, `"email"`)
- **`external_thread_id`** (text): Stable identifier per channel (e.g., phone number, email, user ID)
- **`instructor_id`** (UUID, nullable): Assigned instructor (set-once, never overwritten)

**Unique Constraint:** `UNIQUE (channel, external_thread_id)` - One thread per channel/external_thread_id combination

**State Fields:**
- **`handoff_to_human`** (boolean): If `true`, AI replies are disabled
- **`last_message_at`** (timestamptz): Timestamp of most recent message
- **`last_activity_at`** (timestamptz): Timestamp of most recent activity

**State Machine (Simplified):**
- **`new_lead`**: Thread created, no instructor assigned
- **`assigned`**: Instructor assigned (`instructor_id` set)
- **`in_handoff`**: Human takeover (`handoff_to_human = true`)
- **`resolved`**: Conversation closed (not yet implemented)

### Message

**Definition:** A single message within a conversation thread.

**Database Table:** `conversation_messages`

**Required Identifiers:**
- **`id`** (UUID): Internal message identifier, primary key
- **`thread_id`** (UUID): Foreign key to `conversation_threads.id`
- **`provider_message_id`** (text, nullable): External message ID (used for idempotency)

**Content Fields:**
- **`direction`** (`"inbound"` | `"outbound"`): Message direction
- **`text`** (text, nullable): Message content
- **`payload`** (jsonb): Additional metadata

**Idempotency:** Unique index on `(thread_id, provider_message_id)` where `provider_message_id IS NOT NULL`

### Roles

- **`user`**: Customer (sends inbound messages)
- **`assistant`**: AI system (sends automated outbound messages)
- **`instructor`**: Human instructor (sends manual outbound messages)
- **`system`**: System events (logged to `conversation_events`)

**Role Determination:**
- **Inbound messages:** Always `user` role
- **Outbound messages:** 
  - `assistant` if `payload.auto_reply = true`
  - `instructor` if `payload.auto_reply = false` or missing

### Event

**Definition:** An internal event logged for observability and audit.

**Database Table:** `conversation_events`

**Required Fields:**
- **`id`** (UUID): Event identifier
- **`thread_id`** (UUID): Foreign key to `conversation_threads.id`
- **`trace_id`** (UUID): Request trace identifier
- **`direction`** (`"inbound"` | `"outbound"` | `"internal"`): Event direction
- **`event_type`** (text): Event type (see Section 9)
- **`payload`** (jsonb): Event-specific data

**Event Types:** See Section 9 (Observability & Diagnostics)

---

## 6. Concierge AI Behavior Contract

### Data Sources (Priority Order)

The AI MUST use data in the following priority order:

1. **Structured Instructor Data** (highest priority)
   - Instructor profile: name, email, specialties, availability
   - Source: `instructors` table (via `conversation_threads.instructor_id`)
   - Usage: Personalize replies, include instructor-specific information

2. **Policy Documents** (high priority)
   - Policy chunks retrieved via RAG (vector similarity search)
   - Source: `policy_chunks` table (filtered by `instructor_id`)
   - Usage: Answer questions about policies, pricing, cancellation rules
   - Retrieval: Top 5 most similar chunks (cosine similarity)

3. **Conversation Context** (medium priority)
   - Recent messages in thread
   - Source: `conversation_messages` table (last 10 messages)
   - Usage: Maintain conversation continuity, reference previous messages

### When AI MUST Refuse to Answer

The AI MUST refuse to answer (and escalate to human) if:

1. **Thread is in handoff:** `conversation_threads.handoff_to_human = true`
   - Action: Return `replyText: null`, do not generate reply

2. **No instructor assigned:** `conversation_threads.instructor_id IS NULL`
   - Action: Return generic reply asking customer to wait for assignment

3. **Query requires sensitive data:** Customer asks for payment info, personal data, etc.
   - Action: Politely decline, suggest contacting instructor directly

4. **Query is outside scope:** Question unrelated to ski lessons, policies, or booking
   - Action: Politely redirect to relevant topics or suggest human handoff

### When AI MUST Escalate to Human

The AI MUST escalate (set `handoff_to_human = true`) if:

1. **Customer explicitly requests human:** "I want to talk to a person", "human please", etc.
2. **Booking intent detected:** Customer wants to book a lesson (requires human confirmation)
3. **Complaint detected:** Customer expresses dissatisfaction or complaint
4. **Uncertainty threshold exceeded:** AI confidence < 0.7 AND no relevant policy chunks found

### Uncertainty Handling

**If policy chunks found (similarity > 0.7):**
- Use chunks in prompt, generate reply with high confidence

**If policy chunks found but low similarity (< 0.7):**
- Use chunks but add disclaimer: "Based on general policies, but please confirm with your instructor"

**If no policy chunks found:**
- Generate generic helpful reply
- Suggest customer contact instructor for specific questions
- Do not make up information

### AI Reply Generation Process

1. **Check handoff status:** If `handoff_to_human = true`, return `null`
2. **Retrieve instructor data:** Load instructor profile if `instructor_id` exists
3. **Generate query embedding:** Use OpenAI `text-embedding-3-small` model
4. **Search policy chunks:** Call `search_policy_chunks(instructor_id, query_embedding, top_k=5)`
5. **Build RAG prompt:** Combine instructor data + policy chunks + conversation context + user message
6. **Call LLM:** Use OpenAI `gpt-4o-mini` with RAG prompt
7. **Fallback:** If LLM fails, use rule-based reply (keyword matching)
8. **Send reply:** Via WhatsApp Cloud API
9. **Log events:** `policy_retrieval_ok/empty`, `llm_called/failed`

**Event Logging:** See Section 9 for required events

---

## 7. Policy Documents & Knowledge Base

### What Is a Policy Document

A policy document is structured text content uploaded by an instructor that contains:
- Pricing information
- Cancellation policies
- Lesson details
- Frequently asked questions
- Instructor-specific rules

**Database Tables:**
- **`policy_docs`**: Source documents (one per instructor)
- **`policy_chunks`**: Chunked content with vector embeddings
- **`doc_versions`**: Version history

### Upload Process

**Endpoint:** `POST /functions/v1/policy-ingest`

**Authentication:** JWT (Supabase Auth, instructor must be authenticated)

**Payload:**
```json
{
  "title": "Cancellation Policy",
  "content": "Full policy text...",
  "source_url": "https://example.com/policy",
  "source_type": "manual",
  "metadata": {}
}
```

**Process:**
1. Validate instructor authentication
2. Create or update `policy_docs` record (increment version if exists)
3. Chunk content: 1000 characters per chunk, 200 character overlap
4. Generate embeddings: OpenAI `text-embedding-3-small` (1536 dimensions)
5. Insert chunks into `policy_chunks` with embeddings
6. Save version history to `doc_versions`

### Indexing

**Vector Embeddings:**
- Model: OpenAI `text-embedding-3-small`
- Dimensions: 1536
- Storage: PostgreSQL `vector(1536)` type (pgvector extension)
- Index: HNSW index for fast similarity search

**Chunking Strategy:**
- Chunk size: 1000 characters
- Overlap: 200 characters
- Order: Preserved via `chunk_index` field

### Retrieval (RAG)

**Function:** `search_policy_chunks(instructor_id, query_embedding, top_k)`

**Process:**
1. Generate embedding for user query
2. Search chunks: `SELECT * FROM policy_chunks WHERE doc_id IN (SELECT id FROM policy_docs WHERE instructor_id = ? AND is_active = true) ORDER BY embedding <=> query_embedding LIMIT top_k`
3. Return chunks with similarity scores (cosine similarity)

**Similarity Threshold:**
- No hard threshold (returns top_k regardless)
- Low similarity (< 0.7) indicates weak relevance

### Version Handling

**Versioning Rules:**
- Each document has `version` integer (starts at 1, increments on update)
- Old chunks are deleted when document is updated
- Version history is preserved in `doc_versions` table
- Only active documents (`is_active = true`) are searched

**Update Process:**
1. Increment `version` in `policy_docs`
2. Delete old chunks: `DELETE FROM policy_chunks WHERE doc_id = ?`
3. Generate new chunks with embeddings
4. Insert new chunks
5. Save version snapshot to `doc_versions`

### What Happens If No Policy Is Found

**If no policy documents exist for instructor:**
- `search_policy_chunks` returns empty result
- Event `policy_retrieval_empty` is logged
- AI generates generic reply (no policy context)
- AI suggests customer contact instructor for specific questions

**If policy documents exist but no relevant chunks found:**
- `search_policy_chunks` returns empty result (low similarity)
- Event `policy_retrieval_empty` is logged
- AI generates generic reply
- AI may reference that policies exist but don't cover this topic

---

## 8. Automation (Make) Integration Rules

### What Make Is Allowed to Do

1. **Read tasks from queue:**
   ```sql
   SELECT * FROM tasks 
   WHERE status = 'queued' 
   ORDER BY created_at ASC 
   LIMIT 1 
   FOR UPDATE SKIP LOCKED;
   ```

2. **Atomically claim tasks:**
   ```sql
   UPDATE tasks 
   SET status = 'running', started_at = now() 
   WHERE id = ? AND status = 'queued';
   ```

3. **Execute external actions:**
   - Create Google Calendar events
   - Update CRM systems
   - Send emails via external services
   - Call external webhooks
   - Update external databases

4. **Write task results:**
   ```sql
   UPDATE tasks 
   SET status = 'succeeded', result = {...}, completed_at = now() 
   WHERE id = ?;
   ```

5. **Handle task failures:**
   ```sql
   UPDATE tasks 
   SET status = 'failed', error = '...', retries = retries + 1 
   WHERE id = ?;
   ```

6. **Send messages via ingest API:**
   - Call `POST /functions/v1/ingest-inbound`
   - Include `idempotency_key` in request
   - Authenticate using `x-fd-ingest-key` header

### What Make MUST Never Do

1. **Modify conversation data directly:**
   - ❌ `UPDATE conversation_threads`
   - ❌ `INSERT INTO conversation_messages`
   - ❌ `UPDATE conversation_events`
   - ✅ Only Orchestrator may modify conversation data

2. **Bypass task queue:**
   - ❌ Call Orchestrator APIs directly to create tasks
   - ❌ Create tasks manually in database
   - ✅ Only read from `tasks` table

3. **Store service role keys:**
   - ❌ In Make.com data stores
   - ❌ In Make.com scenario code
   - ✅ Only in Make.com environment variables (server-side)

4. **Ignore idempotency:**
   - ❌ Execute task if `idempotency_key` already succeeded
   - ✅ Check: `SELECT * FROM tasks WHERE idempotency_key = ? AND status = 'succeeded'`

5. **Create duplicate external actions:**
   - ❌ Create same calendar event twice
   - ❌ Send same email twice
   - ✅ Use `idempotency_key` to prevent duplicates

### Allowed Interaction Patterns

**Pattern 1: Task Polling (Recommended)**
1. Make scenario runs on schedule (every 1-5 minutes)
2. Polls `tasks` table for `status = 'queued'`
3. Claims task atomically
4. Executes action
5. Updates task status

**Pattern 2: Webhook Trigger (Alternative)**
1. Orchestrator calls Make webhook when task created
2. Make receives webhook, reads task from database
3. Claims task atomically
4. Executes action
5. Updates task status

**Pattern 3: Message Sending**
1. Make scenario determines message should be sent
2. Calls `POST /functions/v1/ingest-inbound` with message content
3. Includes `idempotency_key` to prevent duplicates
4. Orchestrator processes message normally

### Forbidden Anti-Patterns

**Anti-Pattern 1: Direct Database Writes**
- ❌ Make writes directly to `conversation_messages`
- ✅ Make calls ingest API, Orchestrator writes to database

**Anti-Pattern 2: Service Role Key in Scenario**
- ❌ Hardcoded service role key in Make scenario
- ✅ Service role key in Make environment variables only

**Anti-Pattern 3: Bypassing Task Queue**
- ❌ Make calls Orchestrator internal APIs
- ✅ Make only reads from `tasks` table

**Anti-Pattern 4: No Idempotency Check**
- ❌ Make executes task without checking `idempotency_key`
- ✅ Make checks `idempotency_key` before executing

### Failure Handling Rules

**Transient Failures (Retry):**
- Network errors, timeouts, rate limits
- Action: Retry with exponential backoff (max 3 retries)
- Update: `retries = retries + 1`, `last_retry_at = now()`

**Permanent Failures (Dead Letter):**
- Invalid data, external API errors, business logic errors
- Action: Move to `dead_letter_queue` table
- Update: `status = 'dead_letter'`

**Dead Letter Queue:**
- Table: `dead_letter_queue`
- Fields: `task_id`, `thread_id`, `task_type`, `payload`, `error_message`, `resolved`
- Action: Manual review and resolution required

---

## 9. Observability & Diagnostics

### Trace ID Standard

**Definition:** A UUID v4 generated at the start of every request/operation.

**Generation:**
- **Edge Functions:** `randomUUID()` at function entry
- **Fastify Server:** `crypto.randomUUID()` at endpoint entry

**Propagation:**
- Included in all `conversation_events` records (`trace_id` column)
- Included in all structured logs (JSON `trace_id` field)
- Included in all API responses (`trace_id` in response body)
- Stored in task payloads (`tasks.payload.trace_id`)

**Usage:**
- End-to-end request tracing
- Error correlation
- Debugging production issues

**Query Example:**
```sql
SELECT * FROM conversation_events 
WHERE trace_id = '550e8400-e29b-41d4-a716-446655440000' 
ORDER BY created_at ASC;
```

### Event Taxonomy

**All events stored in `conversation_events` table.**

#### Inbound Message Events
- **`whatsapp_inbound`**: WhatsApp webhook received
- **`landing_inbound`**: Landing page form submission
- **`message`**: Generic inbound message

#### Outbound Message Events
- **`auto_reply`**: Automated bot reply sent
- **`human_message`**: Human instructor reply sent

#### Thread Management Events
- **`ingest_started`**: Ingest request received
- **`thread_upserted`**: Thread created/updated
- **`thread_upsert_failed`**: Thread upsert failed

#### Message Processing Events
- **`message_idempotent_skipped`**: Message skipped (duplicate)
- **`message_insert_duplicate_skipped`**: Message skipped (DB constraint)
- **`message_insert_failed`**: Message insert failed
- **`message_insert_returned_null`**: Message insert returned null
- **`message_inserted`**: Message successfully inserted

#### Human Handoff Events
- **`human_handoff`**: Thread handed off to human
- **`resync_thread`**: Thread resync requested

#### RAG/LLM Events
- **`policy_retrieval_ok`**: Policy chunks found
- **`policy_retrieval_empty`**: No policy chunks found
- **`llm_called`**: LLM successfully called
- **`llm_failed`**: LLM call failed

#### Task Events
- **`task_result`**: Task execution completed

#### Error Events
- **`error`**: Generic error occurred

### Mandatory Events to Log

**Every ingest request MUST log:**
1. `ingest_started` (at request start)
2. `thread_upserted` (after thread creation/finding)
3. `message_inserted` or `message_idempotent_skipped` (after message processing)

**Every AI reply task MUST log:**
1. `policy_retrieval_ok` or `policy_retrieval_empty` (after RAG search)
2. `llm_called` or `llm_failed` (after LLM call)
3. `task_result` (after task completion)

**Every error MUST log:**
1. `error` event with `payload.error` and `payload.stack`

### Where to Debug Failures

**Supabase Edge Function Logs:**
- Location: Supabase Dashboard → Edge Functions → [Function Name] → Logs
- Search: `"trace_id":"..."` or `"event":"..."`
- Format: Structured JSON logs

**Database Tables:**
- **`conversation_events`**: All events with `trace_id`
- **`conversation_messages`**: All messages
- **`tasks`**: Task queue status and results
- **`dead_letter_queue`**: Failed tasks

**Vercel/Render Logs:**
- Location: Deployment platform logs
- Search: `"trace_id":"..."` or error messages

**Query Examples:**
```sql
-- Find all events for a trace
SELECT * FROM conversation_events 
WHERE trace_id = '...' 
ORDER BY created_at ASC;

-- Find failed operations
SELECT * FROM conversation_events 
WHERE event_type IN ('message_insert_failed', 'llm_failed', 'error')
  AND created_at > NOW() - INTERVAL '1 hour';

-- Track RAG performance
SELECT 
  event_type,
  COUNT(*) as count,
  AVG((payload->>'top_similarity')::float) as avg_similarity
FROM conversation_events
WHERE event_type IN ('policy_retrieval_ok', 'policy_retrieval_empty')
  AND created_at > NOW() - INTERVAL '24 hours'
GROUP BY event_type;
```

### Failure Scenario Examples

**Scenario 1: Message Not Received**
1. Check webhook/ingest logs for `ingest_started` event
2. If missing: Authentication/validation failure
3. If present: Check `thread_upserted` and `message_inserted` events
4. Use `trace_id` to correlate logs across systems

**Scenario 2: AI Not Replying**
1. Check `tasks` table for `ai_reply` task with `status = 'queued'`
2. Check task-worker logs for `task_processing_started` event
3. Check `policy_retrieval_ok/empty` and `llm_called/failed` events
4. Check WhatsApp send logs for delivery status

**Scenario 3: Wrong Policy Answer**
1. Check `policy_retrieval_ok` event, verify `top_similarity` score
2. Check `llm_called` event, verify prompt included policy chunks
3. Check `policy_docs` table for active documents
4. Verify chunks have embeddings: `SELECT COUNT(*) FROM policy_chunks WHERE embedding IS NOT NULL`

---

## 10. Environment Variables Matrix

| Variable | Landing | Orchestrator | Main App | Make | Notes |
|----------|---------|--------------|----------|------|-------|
| **`SUPABASE_URL`** | ❌ No | ✅ Required | ✅ Required | ✅ Required | Supabase project URL |
| **`SUPABASE_ANON_KEY`** | ❌ No | ❌ No | ✅ Required | ❌ No | Client-side only (Main App) |
| **`SUPABASE_SERVICE_ROLE_KEY`** | ❌ **FORBIDDEN** | ✅ Required | ❌ **FORBIDDEN** | ✅ Required | Server-side only, never client |
| **`INGEST_SHARED_SECRET`** | ✅ Required | ✅ Required | ❌ No | ✅ Required | Shared secret for ingest API |
| **`WHATSAPP_WEBHOOK_SECRET`** | ❌ No | ✅ Required | ❌ No | ❌ No | WhatsApp webhook signature |
| **`WHATSAPP_PHONE_NUMBER_ID`** | ❌ No | ✅ Required | ❌ No | ❌ No | Meta Business phone number ID |
| **`WHATSAPP_ACCESS_TOKEN`** | ❌ No | ✅ Required | ❌ No | ❌ No | Meta Business access token |
| **`OPENAI_API_KEY`** | ❌ No | ✅ Required | ❌ No | ❌ No | OpenAI API key (embeddings + LLM) |
| **`DEFAULT_INSTRUCTOR_ID`** | ❌ No | ⚠️ Optional | ❌ No | ❌ No | Fallback instructor (dev only) |
| **`ALLOWED_ORIGINS`** | ❌ No | ⚠️ Optional | ❌ No | ❌ No | CORS origin allowlist (comma-separated) |
| **`RATE_LIMIT_PER_THREAD`** | ❌ No | ⚠️ Optional | ❌ No | ❌ No | Default: 10 per 60s |
| **`RATE_LIMIT_PER_IP`** | ❌ No | ⚠️ Optional | ❌ No | ❌ No | Default: 100 per 60s |
| **`RATE_LIMIT_WINDOW_SECONDS`** | ❌ No | ⚠️ Optional | ❌ No | ❌ No | Default: 60 |
| **`NODE_ENV`** | ⚠️ Optional | ⚠️ Optional | ⚠️ Optional | ❌ No | `production` | `development` |

### Required vs Optional

**Required:** Must be set for component to function
**Optional:** Has default value or only needed for specific features
**FORBIDDEN:** Must never be set (security violation)

### Client-Side vs Server-Side

**Client-Side (Browser):**
- `SUPABASE_ANON_KEY` (Main App only)
- Never: Service role keys, shared secrets, API keys

**Server-Side (Edge Functions, Fastify, Make):**
- All other variables
- Never exposed to browser

---

## 11. Go-To-Market Safety Rules

### What MUST Be True to Go Live

1. **Canonical ingest API implemented:**
   - `POST /functions/v1/ingest-inbound` endpoint deployed
   - Authentication (`x-fd-ingest-key`) validated
   - Idempotency enforced
   - Rate limiting active

2. **Landing integration complete:**
   - Landing calls `ingest-inbound` endpoint
   - `INGEST_SHARED_SECRET` configured in both systems
   - CORS configured (if `ALLOWED_ORIGINS` set)

3. **WhatsApp webhook configured:**
   - Webhook URL set in Meta Business Dashboard
   - `WHATSAPP_WEBHOOK_SECRET` matches Meta configuration
   - Signature verification working

4. **Task worker scheduled:**
   - Cron job or scheduled trigger configured
   - Polls `tasks` table every 1-5 minutes
   - Processes `ai_reply` tasks

5. **RLS policies enforced:**
   - Instructors can only access their own threads
   - Service role used only in Edge Functions
   - No client-side service role keys

6. **Observability active:**
   - All events logged with `trace_id`
   - Supabase logs accessible
   - Error events captured

### What Features Must Be Disabled If Incomplete

**If RAG/LLM not ready:**
- Disable `ai_reply` task creation
- Return `replyText: null` for all messages
- Instructors must reply manually

**If WhatsApp delivery not ready:**
- Disable outbound message sending
- Log messages to database only
- Instructors use Main App UI for replies

**If Make integration not ready:**
- Disable task creation for Make tasks
- Manual processing required
- Calendar/CRM integration disabled

### Acceptable Technical Debt for Launch

1. **Rule-based AI replies** (no LLM): Acceptable for MVP
2. **No policy documents:** Acceptable if instructors provide manual replies
3. **No task worker scheduling:** Acceptable if manual task processing
4. **Basic error handling:** Acceptable if errors are logged and traceable

### NOT Acceptable for Launch

1. **Missing authentication:** Ingest API must require `x-fd-ingest-key`
2. **No idempotency:** Duplicate messages will cause data corruption
3. **Service role keys in client:** Security violation
4. **No error logging:** Cannot debug production issues
5. **RLS bypassed:** Data isolation violated
6. **No rate limiting:** System vulnerable to abuse

---

## 12. Change Management Rules

### How This Contract Can Be Changed

1. **Proposal:** Create issue/PR in Orchestrator repository with:
   - Section number and proposed change
   - Rationale and impact analysis
   - Migration plan (if breaking change)

2. **Review:** All three repository maintainers must approve:
   - Landing maintainer
   - Orchestrator maintainer
   - Main App maintainer

3. **Approval:** Changes require:
   - Technical review (architecture impact)
   - Security review (if security-related)
   - Migration plan (if breaking change)

4. **Implementation:** After approval:
   - Update this document in Orchestrator repository
   - Copy to Landing and Main App repositories (same content)
   - Update version number and effective date
   - Implement changes in all affected repositories

### Breaking Changes

**Definition:** Any change that requires:
- Code changes in multiple repositories
- Database migrations
- Environment variable changes
- API contract changes

**Process:**
1. **Deprecation period:** Announce breaking change 4+ weeks in advance
2. **Migration guide:** Provide step-by-step migration instructions
3. **Parallel support:** Support old and new contracts during transition
4. **Sunset date:** Set explicit date for removing old contract

### Version History

**Version 1.0 (2025-02-01):**
- Initial authoritative specification
- Canonical ingest API v1 defined
- System components and ownership defined
- Security boundaries established

---

## Appendix: Assumptions

**This section explicitly labels assumptions made in this document.**

1. **Assumption:** Supabase is the database and Edge Function platform
   - **Rationale:** Current implementation uses Supabase
   - **If false:** Contract must be updated

2. **Assumption:** OpenAI is used for embeddings and LLM
   - **Rationale:** Current implementation uses OpenAI
   - **If false:** Contract must be updated (Section 6, 7)

3. **Assumption:** WhatsApp Cloud API is used for messaging
   - **Rationale:** Current implementation uses WhatsApp
   - **If false:** Contract must be updated (Section 2, 8)

4. **Assumption:** Make.com is the automation platform
   - **Rationale:** Current implementation targets Make.com
   - **If false:** Contract must be updated (Section 8)

5. **Assumption:** Instructors are authenticated via Supabase Auth
   - **Rationale:** Current implementation uses Supabase Auth
   - **If false:** Contract must be updated (Section 3, 5)

---

**END OF DOCUMENT**
