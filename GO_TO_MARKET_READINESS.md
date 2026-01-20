# FrostDesk Go-To-Market Readiness Assessment

**Date:** 2024  
**Scope:** Landing Page, Orchestrator, FrostDesk Main App, Make Integration  
**Purpose:** Cross-project production readiness and integration safety

---

## A) Executive Verdict

**READY TO GO LIVE TODAY: NO**

**Reason:** While the Landing page has been hardened with security headers, rate limiting, CORS restrictions, and error monitoring, critical integration points are unverified or incomplete. The system has two different ingest paths (`/api/ingest` → ORCH_URL vs `/api/ingest-inbound` → Supabase Edge Function) with unclear ownership and no documented contract. Make integration exists as simple webhook proxies but lacks authentication, validation, and clear boundaries. The Orchestrator's ability to handle messages from Landing, Make, and manual replies from instructors cannot be verified without access to that codebase. **Blockers:** (1) Orchestrator endpoint contract and authentication must be verified, (2) Make integration needs authentication and validation, (3) Environment variables must be configured across all projects, (4) End-to-end message flow must be tested.

---

## B) System Architecture Summary

### Landing Page (This Repository)
**Tech Stack:** Next.js 14, React 18, TypeScript (partial)  
**Deployment:** Vercel  
**Ownership:** Public-facing website, lead capture, first inbound messages

**Responsibilities:**
- Display approved instructors to public visitors
- Capture chat messages from visitors
- Send messages to Orchestrator via secure proxy
- Never access Supabase service role key directly
- Never expose privileged credentials to client

**Trust Boundary:**
- ✅ Does NOT have Supabase service role key (only uses it server-side in `/api/instructors`)
- ✅ Does NOT directly access Supabase database (only reads instructor list)
- ✅ Proxies messages to Orchestrator (does not process them)
- ⚠️ Has two ingest endpoints with unclear distinction

### Orchestrator (Logical Layer)
**Tech Stack:** Supabase Edge Functions, Supabase Database  
**Deployment:** Supabase (Edge Functions + DB)  
**Ownership:** Message ingestion, conversation persistence, AI/human handoff

**Responsibilities:**
- Accept inbound messages from Landing (via `/api/ingest` or `/api/ingest-inbound`)
- Accept inbound messages from Make (via webhook → ingest endpoint)
- Persist conversations/threads in Supabase
- Route messages to AI or human (instructor)
- Handle instructor manual replies
- Manage thread state and conversation context

**Trust Boundary:**
- ✅ MUST own all conversation/thread persistence logic
- ✅ MUST validate and authenticate all inbound messages
- ✅ MUST never expose service role key to external systems
- ❓ UNKNOWN: Current implementation status (cannot verify without codebase access)

**Expected Endpoints:**
- `POST /ingest` (if ORCH_URL points to standalone service)
- OR Supabase Edge Function `ingest-inbound` (if using Supabase Functions)
- Must accept: `channel`, `external_thread_id`, `instructor_id`, `text`, `metadata`

### FrostDesk Main App
**Tech Stack:** React + Vite + TypeScript, Supabase (Auth, DB, RLS)  
**Deployment:** Vercel (assumed)  
**Ownership:** Instructor dashboard, admin approval, manual replies

**Responsibilities:**
- Instructor onboarding and profile management
- Admin approval workflow (`onboarding_state='approved'`)
- Instructor dashboard and inbox UI
- Manual reply interface (instructor sends replies)
- Calendar integration (Google Calendar sync)

**Trust Boundary:**
- ✅ Uses Supabase Auth (instructors authenticate)
- ✅ Uses RLS (Row Level Security) for data access
- ✅ Can read/write instructor data (with RLS)
- ✅ Can send instructor replies to Orchestrator
- ❌ MUST NOT expose service role key
- ❌ MUST NOT bypass RLS

**Expected Integration:**
- Sends instructor replies to Orchestrator (same ingest endpoint as Landing)
- Reads conversation threads from Supabase (via RLS-protected queries)

### Make (Automation Layer)
**Tech Stack:** External automation platform  
**Deployment:** Make.com cloud  
**Ownership:** Webhooks, enrichment, notifications, external integrations

**Responsibilities:**
- Receive webhooks from external systems
- Enrich conversation data (e.g., add customer info from CRM)
- Send notifications (email, SMS, Slack)
- Trigger external workflows
- **MUST NOT:** Own core business logic, store sensitive credentials, make direct DB writes

**Trust Boundary:**
- ✅ Can call Orchestrator ingest endpoint (with authentication)
- ✅ Can read conversation data (via Orchestrator API, not direct DB)
- ❌ MUST NOT have Supabase service role key
- ❌ MUST NOT write directly to Supabase database
- ❌ MUST NOT own conversation routing logic
- ⚠️ Current Landing has Make webhook proxies (`/api/make/*`) - these are simple passthroughs

**Current State (from Landing codebase):**
- `/api/make/request.ts` - Proxies to `MAKE_WEBHOOK_REQUEST_URL`
- `/api/make/chat.ts` - Proxies to `MAKE_WEBHOOK_CHAT_URL`
- `/api/make/confirm.ts` - Proxies to `MAKE_WEBHOOK_CONFIRM_URL`
- **Issue:** These are OUTBOUND proxies (Landing → Make), not inbound (Make → Orchestrator)

---

## C) What Is READY (Safe to Ship)

### Landing Page
- ✅ **Security hardening** - Headers, CORS, rate limiting, Sentry integration
- ✅ **Privacy policy** - GDPR-compliant template (needs contact info update)
- ✅ **Instructor listing** - Fetches approved instructors from Supabase (server-side)
- ✅ **Chat widget** - Sends messages to `/api/ingest` with proper payload structure
- ✅ **Thread management** - localStorage persistence for continuity
- ✅ **Event tracking** - `select_instructor`, `cta_click` events
- ✅ **WhatsApp CTA** - Conditional visibility and link generation
- ✅ **Service key isolation** - `SUPABASE_SERVICE_ROLE_KEY` never exposed to client
- ✅ **Error handling** - Basic error messages and timeout handling

### Architecture Patterns
- ✅ **Proxy pattern** - Landing proxies to Orchestrator (does not access DB directly)
- ✅ **Secret management** - Environment variables properly scoped
- ✅ **Rate limiting** - Server-side protection (10 req/min per IP)
- ✅ **CORS restriction** - Origins validated against `ALLOWED_ORIGIN`

---

## D) What Is PARTIALLY READY (Risky)

### Landing Page
- ⚠️ **Two ingest endpoints** - `/api/ingest` (→ ORCH_URL) and `/api/ingest-inbound` (→ Supabase Edge Function)
  - **Risk:** Unclear which is the source of truth. Both exist but usage is ambiguous.
  - **Impact:** Confusion, potential duplicate message processing, maintenance burden
  - **Action:** Document which endpoint is primary, or consolidate

- ⚠️ **Make webhook proxies** - `/api/make/*` endpoints exist but are OUTBOUND (Landing → Make)
  - **Risk:** These are not for Make → Orchestrator integration. Make needs its own path.
  - **Impact:** Make integration pattern is unclear
  - **Action:** Clarify Make integration strategy (see section H)

- ⚠️ **Input validation** - No message length limits, no explicit sanitization
  - **Risk:** Very long messages or malicious content could cause issues
  - **Impact:** Low (React escapes HTML), but best practice missing
  - **Action:** Add max length (1000 chars) and basic sanitization

### Orchestrator (Inferred - Cannot Verify)
- ⚠️ **Endpoint contract** - Expected to accept messages but contract is not documented
  - **Risk:** Payload format mismatch, missing required fields
  - **Impact:** Messages fail silently or are rejected
  - **Action:** Document expected payload format, validate in Orchestrator

- ⚠️ **Authentication** - Landing sends to `ORCH_URL/ingest` with no auth header
  - **Risk:** If Orchestrator requires authentication, requests will fail
  - **Impact:** All messages from Landing will be rejected
  - **Action:** Verify Orchestrator auth requirements, add if needed

- ⚠️ **Idempotency** - No idempotency keys in Landing payload
  - **Risk:** Duplicate messages if network retries or user double-clicks
  - **Impact:** Duplicate conversations or confusion
  - **Action:** Add idempotency key to payload, handle in Orchestrator

### Make Integration
- ⚠️ **No inbound path** - Landing has outbound Make proxies, but no inbound (Make → Orchestrator)
  - **Risk:** Make cannot send messages to Orchestrator through Landing
  - **Impact:** Make must call Orchestrator directly (needs auth/endpoint)
  - **Action:** Document Make → Orchestrator integration pattern

- ⚠️ **No authentication** - Make webhook proxies have no auth validation
  - **Risk:** Anyone can call these endpoints if URL is known
  - **Impact:** Abuse, unauthorized webhook triggers
  - **Action:** Add webhook signature validation or API key

---

## E) What Is MISSING FOR GO-LIVE

### Landing Page
- ❌ **Input validation** - Message length limits and sanitization
- ❌ **Privacy policy contact info** - Replace placeholder with actual contact details
- ❌ **Environment variable configuration** - `ORCH_URL`, `ALLOWED_ORIGIN`, `NEXT_PUBLIC_SENTRY_DSN` must be set
- ❌ **Endpoint consolidation** - Clarify `/api/ingest` vs `/api/ingest-inbound` usage
- ❌ **Idempotency keys** - Add to message payload to prevent duplicates

### Orchestrator (Cannot Verify - Assumed Requirements)
- ❌ **Endpoint verification** - Must confirm `/ingest` endpoint exists and accepts expected payload
- ❌ **Authentication** - Must verify if auth is required and implement if missing
- ❌ **Payload validation** - Must validate incoming message structure
- ❌ **Idempotency handling** - Must deduplicate messages with same idempotency key
- ❌ **Error responses** - Must return proper error codes and messages
- ❌ **Logging/correlation** - Must log all messages with correlation IDs for tracing
- ❌ **Rate limiting** - Should have its own rate limiting (beyond Landing's)
- ❌ **Thread persistence** - Must verify conversations are persisted correctly
- ❌ **AI/human routing** - Must verify routing logic works for all channels
- ❌ **Manual reply handling** - Must verify instructor replies are processed

### FrostDesk Main App (Cannot Verify - Assumed Requirements)
- ❌ **Instructor reply integration** - Must verify instructors can send replies to Orchestrator
- ❌ **Inbox UI** - Must verify instructors can see conversations
- ❌ **Admin approval** - Must verify `onboarding_state='approved'` workflow works
- ❌ **RLS policies** - Must verify Row Level Security prevents unauthorized access
- ❌ **Auth integration** - Must verify Supabase Auth works for instructors

### Make Integration
- ❌ **Integration pattern** - No documented way for Make to send messages to Orchestrator
- ❌ **Authentication** - Make needs auth mechanism to call Orchestrator
- ❌ **Webhook validation** - Landing's Make proxies need signature validation
- ❌ **Allowed use cases** - No documented list of what Make can/cannot do
- ❌ **Error handling** - No strategy for Make webhook failures

### Supabase / Security
- ❌ **RLS policies** - Must verify Row Level Security is configured correctly
- ❌ **Service role key security** - Must verify it's never exposed to client
- ❌ **Edge Function auth** - Must verify `x-fd-ingest-key` validation works
- ❌ **Database schema** - Must verify tables exist: `instructors`, conversations/threads tables
- ❌ **Triggers** - Must verify any database triggers are configured

### Cross-Project Configuration
- ❌ **Environment variable alignment** - All projects must have consistent config
- ❌ **Endpoint URLs** - Landing's `ORCH_URL` must point to correct Orchestrator endpoint
- ❌ **Shared secrets** - `FD_INGEST_KEY` must be same in Landing and Orchestrator (if using Edge Function path)
- ❌ **CORS origins** - `ALLOWED_ORIGIN` must include all legitimate domains

---

## F) Absolute Blockers

### Must Fix Before Launch

1. **Orchestrator Endpoint Verification**
   - **Owner:** Orchestrator team
   - **Action:** Verify `/ingest` endpoint exists, accepts expected payload format, returns `replyText`
   - **Test:** Send test message from Landing, verify response

2. **Orchestrator Authentication**
   - **Owner:** Orchestrator team
   - **Action:** If auth required, implement and document. If not, verify it's safe to be public.
   - **Test:** Verify Landing can authenticate (or that no auth is needed)

3. **Environment Variable Configuration**
   - **Owner:** DevOps/All teams
   - **Action:** Set `ORCH_URL`, `ALLOWED_ORIGIN`, `NEXT_PUBLIC_SENTRY_DSN` in Landing Vercel
   - **Test:** Verify all env vars are set and accessible

4. **End-to-End Message Flow Test**
   - **Owner:** Integration team
   - **Action:** Test complete flow: Landing → Orchestrator → Response → Landing display
   - **Test:** Send message, verify it appears in Orchestrator, verify response returns

5. **Make Integration Pattern**
   - **Owner:** Make team + Orchestrator team
   - **Action:** Document how Make sends messages to Orchestrator (direct call or via Landing)
   - **Test:** Verify Make can successfully send test message

6. **Privacy Policy Contact Info**
   - **Owner:** Landing team
   - **Action:** Replace placeholder contact information
   - **Test:** Verify contact info is accurate

### High Priority (Launch Within 48h)

7. **Input Validation** - Add message length limits in Landing
8. **Idempotency Keys** - Add to Landing payload, handle in Orchestrator
9. **Error Monitoring** - Configure Sentry DSN in Landing
10. **Endpoint Consolidation** - Document which ingest endpoint is primary

---

## G) Minimal Cross-Project Go-Live Checklist (Next 24-48h)

### Phase 1: Orchestrator Verification (Orchestrator Team - 2-4 hours)

1. **Verify Orchestrator Endpoint**
   - [ ] Confirm `/ingest` endpoint exists and is accessible
   - [ ] Document expected payload format:
     ```json
     {
       "channel": "webchat",
       "external_thread_id": "string",
       "instructor_id": "uuid",
       "text": "string",
       "metadata": { "intent": "string", ... }
     }
     ```
   - [ ] Document expected response format:
     ```json
     {
       "replyText": "string | null",
       "ok": boolean,
       ...
     }
     ```
   - [ ] Test endpoint with curl/Postman

2. **Verify Authentication**
   - [ ] If auth required: implement and document (API key, JWT, etc.)
   - [ ] If no auth: verify endpoint is rate-limited and safe to be public
   - [ ] Document auth mechanism for Landing and Make

3. **Verify Message Processing**
   - [ ] Test message ingestion from Landing format
   - [ ] Verify messages are persisted to database
   - [ ] Verify AI response generation works
   - [ ] Verify human handoff works (when `replyText` is null)

4. **Verify Instructor Replies**
   - [ ] Test instructor sending manual reply from Main App
   - [ ] Verify reply is processed by Orchestrator
   - [ ] Verify reply appears in conversation thread

### Phase 2: Landing Configuration (Landing Team - 1-2 hours)

5. **Environment Variables**
   - [ ] Set `ORCH_URL` in Vercel (pointing to Orchestrator endpoint)
   - [ ] Set `ALLOWED_ORIGIN` in Vercel (production domain(s))
   - [ ] Set `NEXT_PUBLIC_SENTRY_DSN` in Vercel (from Sentry dashboard)
   - [ ] Verify `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are set
   - [ ] (If using Edge Function path) Set `FD_INGEST_KEY` and `NEXT_PUBLIC_SUPABASE_INGEST_URL`

6. **Privacy Policy**
   - [ ] Replace placeholder contact email in `pages/privacy.js`
   - [ ] Replace placeholder website URL in `pages/privacy.js`
   - [ ] Review privacy policy content for accuracy

7. **Input Validation**
   - [ ] Add max message length (1000 characters) in `pages/index.js`
   - [ ] Add basic sanitization (strip HTML tags)

8. **Endpoint Decision**
   - [ ] Decide: Use `/api/ingest` (→ ORCH_URL) OR `/api/ingest-inbound` (→ Supabase Edge Function)
   - [ ] Update `lib/api.js` to use chosen endpoint
   - [ ] Document why the other endpoint exists (or remove it)

### Phase 3: Make Integration (Make Team + Orchestrator Team - 2-3 hours)

9. **Make → Orchestrator Pattern**
   - [ ] Decide: Does Make call Orchestrator directly or via Landing proxy?
   - [ ] If direct: Document Orchestrator endpoint URL and auth for Make
   - [ ] If via Landing: Create authenticated endpoint in Landing for Make
   - [ ] Document payload format Make must send

10. **Make Authentication**
    - [ ] Implement API key or webhook signature validation
    - [ ] Store auth secret in environment variable
    - [ ] Test Make can authenticate

11. **Make Use Cases**
    - [ ] Document allowed Make workflows:
      - ✅ Send messages to Orchestrator (with auth)
      - ✅ Read conversation data (via Orchestrator API)
      - ✅ Send notifications (email, SMS)
      - ❌ Direct Supabase DB writes
      - ❌ Own conversation routing logic
    - [ ] Create example Make scenario

### Phase 4: FrostDesk Main App (Main App Team - 2-3 hours)

12. **Instructor Reply Integration**
    - [ ] Verify instructor can send reply from Main App UI
    - [ ] Verify reply is sent to Orchestrator (same endpoint as Landing)
    - [ ] Test reply appears in conversation thread

13. **Inbox UI**
    - [ ] Verify instructors can see their conversations
    - [ ] Verify RLS prevents seeing other instructors' conversations
    - [ ] Test conversation thread display

14. **Admin Approval**
    - [ ] Verify admin can approve instructors (`onboarding_state='approved'`)
    - [ ] Test approved instructors appear in Landing
    - [ ] Test non-approved instructors do NOT appear in Landing

### Phase 5: Integration Testing (All Teams - 2-3 hours)

15. **End-to-End Flow: Landing → Orchestrator**
    - [ ] User selects instructor on Landing
    - [ ] User sends message from Landing
    - [ ] Verify message appears in Orchestrator
    - [ ] Verify AI response is generated
    - [ ] Verify response appears in Landing chat

16. **End-to-End Flow: Instructor Reply**
    - [ ] Instructor sends reply from Main App
    - [ ] Verify reply is processed by Orchestrator
    - [ ] Verify reply appears in conversation thread
    - [ ] (If supported) Verify reply can be sent back to Landing user

17. **End-to-End Flow: Make Integration**
    - [ ] Make webhook triggers
    - [ ] Make sends message to Orchestrator
    - [ ] Verify message is processed
    - [ ] Verify Make receives response (if applicable)

18. **Error Scenarios**
    - [ ] Test Landing when Orchestrator is down (should show graceful error)
    - [ ] Test rate limiting (send 11+ messages, verify 429)
    - [ ] Test invalid payload (should return 400)
    - [ ] Test CORS (unauthorized origin should be blocked)

### Phase 6: Security Verification (Security/DevOps - 1-2 hours)

19. **Secrets Audit**
    - [ ] Verify `SUPABASE_SERVICE_ROLE_KEY` is never in client code
    - [ ] Verify `FD_INGEST_KEY` is never exposed to client
    - [ ] Verify all secrets are in environment variables only
    - [ ] Audit Vercel environment variables (no secrets in public vars)

20. **RLS Verification**
    - [ ] Test RLS prevents instructor A from seeing instructor B's data
    - [ ] Test RLS allows instructors to see their own data
    - [ ] Test admin can see all data (if applicable)

21. **Rate Limiting**
    - [ ] Verify Landing rate limiting works (10 req/min)
    - [ ] Verify Orchestrator has its own rate limiting (if applicable)
    - [ ] Test abuse scenarios

**Total Estimated Time: 10-17 hours across all teams**

---

## H) Make Integration Playbook (MVP)

### Allowed Use Cases

✅ **Send Messages to Orchestrator**
- Make can call Orchestrator ingest endpoint to send messages
- Use case: Enrich conversation with external data, then forward to Orchestrator
- Pattern: Webhook → Make → Orchestrator `/ingest` endpoint
- Authentication: API key or shared secret

✅ **Read Conversation Data (via Orchestrator API)**
- Make can query Orchestrator for conversation status
- Use case: Check if conversation needs human intervention
- Pattern: Make → Orchestrator API (read-only)
- Authentication: API key

✅ **Send Notifications**
- Make can send email, SMS, Slack notifications based on Orchestrator events
- Use case: Alert instructor when conversation needs attention
- Pattern: Orchestrator webhook → Make → Notification service
- Authentication: Webhook signature validation

✅ **Enrichment (Async)**
- Make can fetch external data and add to conversation metadata
- Use case: Look up customer info from CRM, add to conversation
- Pattern: Orchestrator event → Make → External API → Update conversation metadata
- Authentication: API key for external services

### Required Safeguards

1. **Authentication**
   - Make must authenticate to Orchestrator (API key, JWT, or shared secret)
   - Landing's Make webhook proxies must validate webhook signatures
   - Never store Supabase service role key in Make

2. **Validation**
   - Orchestrator must validate all Make payloads
   - Check required fields, data types, length limits
   - Reject invalid payloads with clear error messages

3. **Idempotency**
   - Make must include idempotency key in messages
   - Orchestrator must deduplicate based on idempotency key
   - Prevent duplicate message processing

4. **Error Handling**
   - Make must handle Orchestrator errors gracefully
   - Implement retry logic with exponential backoff
   - Log all failures for debugging

5. **Rate Limiting**
   - Orchestrator must rate limit Make requests (separate from Landing)
   - Make must respect rate limits and retry appropriately

### Anti-Patterns to Avoid

❌ **Direct Database Writes**
- Make must NEVER write directly to Supabase database
- All data changes must go through Orchestrator API
- Reason: Bypasses business logic, breaks data integrity

❌ **Owning Core Logic**
- Make must NOT decide conversation routing (AI vs human)
- Make must NOT own thread management
- Reason: Core logic must live in Orchestrator for consistency

❌ **Storing Sensitive Credentials**
- Make must NOT store Supabase service role key
- Make must NOT store WhatsApp API keys
- Reason: Security risk, credential leakage

❌ **Synchronous Blocking**
- Make workflows should not block Orchestrator responses
- Use async patterns: webhook → queue → process
- Reason: Performance, user experience

### Example High-Level Flows

**Flow 1: Make Enriches Conversation**
```
1. Landing sends message → Orchestrator
2. Orchestrator processes, creates conversation
3. Orchestrator webhook → Make (new conversation event)
4. Make fetches customer data from CRM
5. Make calls Orchestrator API to update conversation metadata
6. Orchestrator stores enriched data
```

**Flow 2: Make Sends Notification**
```
1. Orchestrator determines conversation needs human
2. Orchestrator webhook → Make (human handoff event)
3. Make sends email/SMS to instructor
4. Make sends Slack notification to team
5. (No response needed to Orchestrator)
```

**Flow 3: Make Forwards External Message**
```
1. External system webhook → Make
2. Make validates and enriches payload
3. Make calls Orchestrator `/ingest` endpoint
4. Orchestrator processes message
5. Orchestrator returns response to Make
6. Make forwards response to external system (if needed)
```

### Integration Endpoints

**For Make → Orchestrator:**
- Endpoint: `{ORCH_URL}/ingest` (same as Landing)
- Method: POST
- Auth: API key in header (e.g., `Authorization: Bearer {API_KEY}`)
- Payload: Same format as Landing
- Response: Same format as Landing

**For Orchestrator → Make (Webhooks):**
- Endpoint: Make webhook URL (configured in Make)
- Method: POST
- Auth: Webhook signature validation
- Payload: Event data (conversation created, human handoff, etc.)
- Response: 200 OK (Make processes async)

---

## I) Post-Launch Improvements (Non-blocking)

### Week 1
- Add request correlation IDs across all systems
- Implement idempotency keys in Landing and Orchestrator
- Add structured logging (JSON format) for better debugging
- Set up uptime monitoring (UptimeRobot, Pingdom)
- Create staging environment for each project

### Week 2
- Add retry logic for Orchestrator failures in Landing
- Implement request deduplication in Orchestrator
- Add performance monitoring (Web Vitals, response times)
- Create integration test suite for message flows
- Document API contracts in OpenAPI/Swagger

### Month 1
- Upgrade rate limiting to Redis-based (distributed)
- Add bot protection (CAPTCHA, honeypot, Cloudflare Turnstile)
- Implement request correlation IDs for end-to-end tracing
- Add alerting (PagerDuty, Slack) for critical errors
- Create runbook for common issues

### Month 2-3
- Add analytics and tracking (privacy-compliant)
- Implement A/B testing framework
- Add conversation export/backup functionality
- Create admin dashboard for system health
- Implement conversation search and filtering

---

## Additional Notes

### Critical Assumptions

1. **Orchestrator Implementation**
   - Assumed: Orchestrator is implemented as Supabase Edge Functions or standalone service
   - Assumed: Orchestrator has `/ingest` endpoint that accepts Landing's payload format
   - **Risk:** If Orchestrator doesn't exist or has different contract, integration will fail
   - **Action:** Verify Orchestrator implementation before launch

2. **Message Flow**
   - Assumed: Landing → Orchestrator → AI Response → Landing (synchronous)
   - Assumed: Instructor → Main App → Orchestrator → Processing (synchronous or async)
   - **Risk:** If flow is async, Landing may need polling or webhooks
   - **Action:** Verify expected flow with Orchestrator team

3. **Make Integration**
   - Assumed: Make calls Orchestrator directly (not via Landing)
   - Assumed: Make has authentication mechanism
   - **Risk:** If Make pattern is different, integration will fail
   - **Action:** Document actual Make integration pattern

### Trust Boundaries Summary

**Landing:**
- ✅ Can read instructors (server-side, with service role key)
- ✅ Can send messages to Orchestrator (via proxy)
- ❌ Cannot write to Supabase database
- ❌ Cannot access instructor private data

**Orchestrator:**
- ✅ Owns all conversation/thread logic
- ✅ Can read/write conversation data
- ✅ Can call AI services
- ❌ Should not expose service role key

**Main App:**
- ✅ Can read/write instructor data (with RLS)
- ✅ Can send instructor replies to Orchestrator
- ❌ Cannot bypass RLS
- ❌ Cannot access other instructors' data

**Make:**
- ✅ Can call Orchestrator API (with auth)
- ✅ Can send notifications
- ❌ Cannot write to Supabase directly
- ❌ Cannot own core business logic

### Data Flow Diagrams

```
Landing → Orchestrator Flow:
┌─────────┐     POST /api/ingest      ┌──────────────┐
│ Landing │ ──────────────────────────> │ Orchestrator │
│  (Vercel)│                            │ (Supabase EF)│
└─────────┘ <────────────────────────── └──────────────┘
            {replyText, ok, ...}

Make → Orchestrator Flow:
┌─────┐     POST /ingest (with auth)   ┌──────────────┐
│Make │ ──────────────────────────────> │ Orchestrator │
└─────┘                                  │ (Supabase EF)│
                                         └──────────────┘

Instructor Reply Flow:
┌──────────┐     POST /ingest           ┌──────────────┐
│Main App  │ ──────────────────────────> │ Orchestrator │
│(Instructor)│                            │ (Supabase EF)│
└──────────┘                              └──────────────┘
```

### Environment Variables Matrix

| Variable | Landing | Orchestrator | Main App | Make |
|----------|---------|-------------|----------|------|
| `ORCH_URL` | ✅ Required | N/A | ✅ Required | ✅ Required |
| `SUPABASE_URL` | ✅ Required | ✅ Required | ✅ Required | ❌ Never |
| `SUPABASE_SERVICE_ROLE_KEY` | ✅ Server-side only | ✅ Required | ❌ Never | ❌ Never |
| `FD_INGEST_KEY` | ✅ (if using Edge Function) | ✅ Required | ❌ Never | ❌ Never |
| `ALLOWED_ORIGIN` | ✅ Required | N/A | N/A | N/A |
| `NEXT_PUBLIC_SENTRY_DSN` | ✅ Required | Optional | Optional | N/A |
| `MAKE_API_KEY` | Optional | Optional | N/A | ✅ Required |

---

**Report End**
