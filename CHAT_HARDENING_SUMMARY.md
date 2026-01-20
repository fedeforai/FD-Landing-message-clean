# Chat UX Hardening - Implementation Summary

## Overview

This document summarizes all changes made to harden the Landing chat UX with:
- Trace ID generation (UUID v4)
- External message ID generation (UUID v4)
- Stable external thread ID (localStorage)
- Strict payload validation
- Anti-spam protection (honeypot + minimum submit time)
- Max message length enforcement
- Sentry logging with trace_id and outcome

## File Changes

### 1. `lib/utils.js`

**Added:**
- `generateUUID()` - Generates UUID v4 for trace_id and external_message_id

```javascript
export function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}
```

### 2. `lib/api.js`

**Changes:**
- Added `MAX_MESSAGE_LENGTH = 5000` constant
- Updated `sendChatMessage()` to:
  - Accept `trace_id`, `external_message_id`, `submit_time`, `honeypot` parameters
  - Validate message length (returns error if > 5000 chars)
  - Include all fields in payload

**Key Code:**
```javascript
// Validate message length
if (text.length > MAX_MESSAGE_LENGTH) {
  return {
    ok: false,
    error: `Message too long. Maximum ${MAX_MESSAGE_LENGTH} characters allowed.`,
    error_code: 'MESSAGE_TOO_LONG',
    trace_id,
  };
}
```

### 3. `pages/index.js`

**Changes:**
- Added Sentry import: `import * as Sentry from "@sentry/nextjs"`
- Added `generateUUID` import
- Added `formRenderTimeRef` to track form render time for anti-spam
- Added `MIN_SUBMIT_TIME = 2000` (2 seconds)
- Updated `handleChatSend()` to:
  - Generate `trace_id` (UUID v4)
  - Generate `external_message_id` (UUID v4)
  - Check minimum submit time (anti-spam)
  - Validate message length
  - Read honeypot field value
  - Log to Sentry with trace_id and outcome
- Added hidden honeypot input field in form
- Added `maxLength={5000}` to chat input

**Key Code:**
```javascript
// Generate identifiers
const traceId = generateUUID();
const externalMessageId = generateUUID();
const idempotencyKey = generateIdempotencyKey();

// Anti-spam: minimum submit time check
const timeSinceRender = now - formRenderTimeRef.current;
if (timeSinceRender < MIN_SUBMIT_TIME) {
  console.warn('Message rejected: submit time too fast', timeSinceRender);
  return;
}

// Honeypot check
const honeypotField = document.querySelector('input[name="website"]');
const honeypot = honeypotField ? honeypotField.value : "";

// Sentry logging
Sentry.addBreadcrumb({
  category: 'message',
  message: 'Sending message',
  level: 'info',
  data: { trace_id: traceId, external_message_id: externalMessageId, ... },
});
```

### 4. `pages/api/ingest.js`

**Major Changes:**
- Changed from `ORCH_URL/ingest` to Supabase Edge Function `/functions/v1/ingest-inbound`
- Changed authentication from `FD_INGEST_KEY` to `INGEST_SHARED_SECRET`
- Added strict payload validation:
  - Channel must be 'landing'
  - external_thread_id required, max 255 chars
  - instructor_id required (UUID format)
  - text required, non-empty, max 5000 chars
- Added anti-spam checks:
  - Honeypot field check (silently reject if filled)
  - Minimum submit time check (silently reject if < 2 seconds)
- Added trace_id generation for all requests
- Added error_code to all error responses
- Added Sentry error logging on server side

**Key Code:**
```javascript
// Generate trace_id for this request
const traceId = generateUUID();

// Get Supabase URL and shared secret
const supabaseUrl = process.env.SUPABASE_URL;
const ingestSharedSecret = process.env.INGEST_SHARED_SECRET;

// Strict payload validation
if (!channel || channel !== 'landing') {
  return res.status(400).json({
    ok: false,
    error: "Invalid or missing channel. Must be 'landing'",
    trace_id: traceId,
    error_code: 'INVALID_CHANNEL',
  });
}

// Anti-spam: honeypot check
if (honeypot && honeypot.trim().length > 0) {
  return res.status(200).json({
    ok: true,
    trace_id: traceId,
    conversation_id: null,
    message_id: null,
  });
}

// Call Supabase Edge Function
const edgeFunctionUrl = `${supabaseUrl}/functions/v1/ingest-inbound`;
const upstreamRes = await fetch(edgeFunctionUrl, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "x-fd-ingest-key": ingestSharedSecret,
  },
  body: JSON.stringify(payload),
});
```

## Environment Variables

### Required (Server-Side Only)

| Variable | Purpose | Notes |
|----------|---------|-------|
| `SUPABASE_URL` | Supabase project URL | Used to construct Edge Function URL |
| `INGEST_SHARED_SECRET` | Authentication secret | **SECRET** - Never expose to client |
| `NEXT_PUBLIC_SENTRY_DSN` | Sentry DSN | Public (safe to expose) |

### Optional (Server-Side)

| Variable | Purpose | Notes |
|----------|---------|-------|
| `SENTRY_ORG` | Sentry organization | For source maps |
| `SENTRY_PROJECT` | Sentry project | For source maps |

### Deprecated

| Variable | Status | Replacement |
|----------|--------|-------------|
| `ORCH_URL` | ❌ Deprecated | Use `SUPABASE_URL` + `/functions/v1/ingest-inbound` |
| `FD_INGEST_KEY` | ❌ Deprecated | Use `INGEST_SHARED_SECRET` |

## Payload Structure

### Client → Server (`/api/ingest`)

```typescript
{
  channel: "landing",
  external_thread_id: string,      // From localStorage
  instructor_id: string,            // UUID
  text: string,                     // Max 5000 chars
  idempotency_key: string,          // Client-generated
  trace_id: string,                 // UUID v4 (client-generated)
  external_message_id: string,     // UUID v4 (client-generated)
  submit_time: number,              // Timestamp when form was rendered
  honeypot: string,                  // Should be empty (anti-spam)
}
```

### Server → Supabase Edge Function (`/functions/v1/ingest-inbound`)

```typescript
{
  channel: "landing",
  external_thread_id: string,
  instructor_id: string,
  text: string,
  idempotency_key: string | null,
  trace_id: string,
  external_message_id: string | null,
}
```

**Headers:**
```http
Content-Type: application/json
x-fd-ingest-key: {INGEST_SHARED_SECRET}
```

## Error Codes

| Code | Meaning | HTTP Status |
|------|---------|-------------|
| `METHOD_NOT_ALLOWED` | Wrong HTTP method | 405 |
| `RATE_LIMIT_EXCEEDED` | Too many requests | 429 |
| `MISSING_CONFIG` | Missing env var | 500 |
| `INVALID_CHANNEL` | Channel must be 'landing' | 400 |
| `INVALID_THREAD_ID` | Invalid external_thread_id | 400 |
| `INVALID_INSTRUCTOR_ID` | Invalid instructor_id | 400 |
| `INVALID_TEXT` | Invalid or missing text | 400 |
| `MESSAGE_TOO_LONG` | Text > 5000 chars | 400 |
| `TIMEOUT` | Request timeout | 504 |
| `NETWORK_ERROR` | Network failure | 502 |
| `PARSE_ERROR` | Response parse error | 500 |

## Anti-Spam Protection

### 1. Honeypot Field
- Hidden input field: `<input name="website" style="display: none" />`
- Real users won't see or fill it
- Bots will fill it → silently rejected

### 2. Minimum Submit Time
- Form render time tracked in `formRenderTimeRef`
- Minimum 2 seconds between render and submit
- Submissions faster than 2 seconds → silently rejected

## Sentry Logging

### Client-Side
- **Breadcrumb on send**: `message_send_start` with trace_id, external_message_id
- **Breadcrumb on success**: `message_send_success` with trace_id, conversation_id, message_id
- **Exception on error**: `captureException` with trace_id, error_code, status_code

### Server-Side
- **Exception on error**: `captureException` with trace_id, error_code, external_thread_id

## Smoke Tests

### Test 1: Basic Message Send

```bash
# 1. Open browser console
# 2. Select an instructor
# 3. Type a message and send
# 4. Check Network tab:
#    - POST /api/ingest
#    - Payload includes: trace_id, external_message_id, idempotency_key
#    - Response includes: trace_id, conversation_id, message_id
```

**Expected:**
- Message appears in chat
- Network request includes all required fields
- Response includes trace_id

### Test 2: Message Length Validation

```bash
# 1. Type message > 5000 characters
# 2. Try to send
```

**Expected:**
- Alert: "Message too long. Maximum 5000 characters allowed."
- Message not sent

### Test 3: Honeypot Protection

```bash
# 1. Open browser console
# 2. Fill honeypot field:
#    document.querySelector('input[name="website"]').value = "spam"
# 3. Send a message
```

**Expected:**
- Message silently rejected (returns 200 OK but no conversation_id)
- No error shown to user

### Test 4: Minimum Submit Time

```bash
# 1. Open browser console
# 2. Immediately send message after page load (< 2 seconds)
```

**Expected:**
- Message silently rejected
- Console warning: "Message rejected: submit time too fast"

### Test 5: Sentry Logging

```bash
# 1. Open Sentry dashboard
# 2. Send a message
# 3. Check Sentry for breadcrumbs
```

**Expected:**
- Breadcrumb: "Sending message" with trace_id
- Breadcrumb: "Message sent successfully" with trace_id, conversation_id

### Test 6: Error Handling

```bash
# 1. Set invalid INGEST_SHARED_SECRET in .env.local
# 2. Send a message
```

**Expected:**
- Error response with trace_id and error_code
- Sentry exception logged with trace_id

### Test 7: Trace ID Propagation

```bash
# 1. Send a message
# 2. Check response for trace_id
# 3. Check Sentry breadcrumbs for same trace_id
```

**Expected:**
- Same trace_id in:
  - Client request
  - Server response
  - Sentry breadcrumbs
  - Sentry exceptions

## Verification Checklist

- [ ] Every message has `trace_id` (UUID v4)
- [ ] Every message has `external_message_id` (UUID v4)
- [ ] `external_thread_id` is stable (persisted in localStorage)
- [ ] Server calls `/functions/v1/ingest-inbound` (not ORCH_URL/ingest)
- [ ] Server uses `INGEST_SHARED_SECRET` (not FD_INGEST_KEY)
- [ ] Server never exposes secret to browser
- [ ] All errors include `trace_id` and `error_code`
- [ ] Max message length enforced (5000 chars)
- [ ] Honeypot field present and checked
- [ ] Minimum submit time enforced (2 seconds)
- [ ] Sentry logging includes trace_id
- [ ] Payload validation is strict

## Migration Notes

### Breaking Changes

1. **Environment Variable Change:**
   - Old: `FD_INGEST_KEY`
   - New: `INGEST_SHARED_SECRET`
   - Action: Update Vercel environment variables

2. **Endpoint Change:**
   - Old: `ORCH_URL/ingest`
   - New: `SUPABASE_URL/functions/v1/ingest-inbound`
   - Action: Update `SUPABASE_URL` if not already set

### Backward Compatibility

- Server route still accepts old payload format (generates trace_id if missing)
- Old `FD_INGEST_KEY` check removed (must use `INGEST_SHARED_SECRET`)

## Security Notes

1. **Secrets Never Exposed:**
   - `INGEST_SHARED_SECRET` only used server-side
   - Never in client-side code
   - Never in `NEXT_PUBLIC_*` variables

2. **Anti-Spam:**
   - Honeypot silently rejects bots (returns 200 OK)
   - Minimum submit time silently rejects bots
   - No user-visible errors for spam attempts

3. **Input Validation:**
   - All fields validated server-side
   - Max length enforced client and server
   - Type checking for all fields
