# `/api/ingest` Implementation

## Overview

Server-side API route that proxies customer messages to Supabase Edge Function `/functions/v1/ingest-inbound` with proper trace_id and external_message_id generation.

## Requirements

✅ Generate trace_id if missing (prefix "trc_")  
✅ Generate external_message_id if missing (prefix "landing_")  
✅ Read FD_INGEST_KEY from server env only  
✅ Forward payload with headers `x-fd-ingest-key` and `x-request-id=trace_id`  
✅ Return `{ ok: true, conversation_id, trace_id }` to client  
✅ Never expose FD_INGEST_KEY client-side  

## Implementation

### File: `pages/api/ingest.js`

```javascript
// In-memory rate limiting store
const rateLimitStore = new Map();
let requestCount = 0;
const CLEANUP_INTERVAL = 100;
const RATE_LIMIT_WINDOW = 60 * 1000; // 60 seconds
const RATE_LIMIT_MAX_REQUESTS = 10;
const REQUEST_TIMEOUT = 30 * 1000; // 30 seconds

// Message constraints
const MAX_MESSAGE_LENGTH = 5000;
const MIN_SUBMIT_TIME = 2000; // 2 seconds minimum

// Generate trace_id with prefix "trc_"
function generateTraceId() {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 15);
  return `trc_${timestamp}_${random}`;
}

// Generate external_message_id with prefix "landing_"
function generateExternalMessageId() {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 15);
  return `landing_${timestamp}_${random}`;
}

// ... (rate limiting functions) ...

export default async function handler(req, res) {
  // Generate trace_id if missing (prefix "trc_")
  const clientTraceId = req.body?.trace_id;
  const serverTraceId = generateTraceId();
  const traceId = clientTraceId || serverTraceId;

  if (req.method !== "POST") {
    return res.status(405).json({ 
      ok: false, 
      error: "Method not allowed",
      trace_id: traceId,
      error_code: 'METHOD_NOT_ALLOWED',
    });
  }

  // Rate limiting (existing logic)
  // ...

  // Get Supabase URL and ingest key (server-side only)
  const supabaseUrl = process.env.SUPABASE_URL;
  const fdIngestKey = process.env.FD_INGEST_KEY; // ✅ Server-side only

  if (!supabaseUrl || !fdIngestKey) {
    return res.status(500).json({
      ok: false,
      error: "Missing configuration",
      trace_id: traceId,
      error_code: 'MISSING_CONFIG',
    });
  }

  // Validate payload
  const body = req.body || {};
  const {
    channel,
    external_thread_id,
    instructor_id,
    text,
    idempotency_key,
    external_message_id: clientExternalMessageId,
    submit_time,
    honeypot,
  } = body;

  // Generate external_message_id if missing (prefix "landing_")
  const external_message_id = clientExternalMessageId || generateExternalMessageId();

  // Validation (channel, external_thread_id, instructor_id, text, length)
  // ...

  // Anti-spam checks (honeypot, submit_time)
  // ...

  // Prepare payload for Supabase Edge Function
  const payload = {
    channel: 'landing',
    external_thread_id: external_thread_id.trim(),
    instructor_id: instructor_id.trim(),
    text: text.trim(),
    idempotency_key: idempotency_key || null,
    trace_id: traceId, // Always present
    external_message_id: external_message_id, // Always present
  };

  // Retry logic with exponential backoff
  const MAX_RETRIES = 3;
  // ...

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const edgeFunctionUrl = `${supabaseUrl.replace(/\/$/, "")}/functions/v1/ingest-inbound`;
      
      const upstreamRes = await fetch(edgeFunctionUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-fd-ingest-key": fdIngestKey, // ✅ Server-side secret
          "x-request-id": traceId, // ✅ Include trace_id as request ID
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      if (upstreamRes.ok && parsed) {
        // ✅ Return simplified response
        return res.status(200).json({
          ok: true,
          conversation_id: parsed.conversation_id || null,
          trace_id: parsed.trace_id || traceId,
        });
      }

      // Retry logic for 429/5xx errors
      // ...
    } catch (err) {
      // Error handling
      // ...
    }
  }
}
```

## ID Generation Format

### trace_id
- **Format**: `trc_{timestamp}_{random}`
- **Example**: `trc_1704067200000_k3j9x2m8p`
- **Generated**: Server-side if client doesn't provide

### external_message_id
- **Format**: `landing_{timestamp}_{random}`
- **Example**: `landing_1704067200000_k3j9x2m8p`
- **Generated**: Server-side if client doesn't provide

## Request Headers to Edge Function

```http
POST /functions/v1/ingest-inbound HTTP/1.1
Content-Type: application/json
x-fd-ingest-key: {FD_INGEST_KEY}  ✅ Server-side secret
x-request-id: {trace_id}         ✅ Trace ID as request ID
```

## Response Format

### Success Response

```json
{
  "ok": true,
  "conversation_id": "550e8400-e29b-41d4-a716-446655440000",
  "trace_id": "trc_1704067200000_k3j9x2m8p"
}
```

### Error Response

```json
{
  "ok": false,
  "error": "Error message",
  "trace_id": "trc_1704067200000_k3j9x2m8p",
  "error_code": "ERROR_CODE"
}
```

## Example Client Call

### JavaScript/TypeScript

```javascript
async function sendMessage({
  external_thread_id,
  instructor_id,
  text,
  trace_id, // Optional: if not provided, server generates
  external_message_id, // Optional: if not provided, server generates
}) {
  const response = await fetch('/api/ingest', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      channel: 'landing',
      external_thread_id,
      instructor_id,
      text,
      trace_id, // Optional
      external_message_id, // Optional
      idempotency_key: `landing:${Date.now()}:${Math.random().toString(36)}`,
      submit_time: Date.now(), // For anti-spam
      honeypot: '', // Empty string (anti-spam)
    }),
  });

  const data = await response.json();

  if (data.ok) {
    console.log('Message sent:', {
      conversation_id: data.conversation_id,
      trace_id: data.trace_id,
    });
  } else {
    console.error('Error:', data.error, data.error_code);
  }

  return data;
}

// Usage
const result = await sendMessage({
  external_thread_id: 'webchat-1234567890-abc',
  instructor_id: '550e8400-e29b-41d4-a716-446655440000',
  text: 'Hello, I would like to book a lesson',
  // trace_id and external_message_id are optional
  // Server will generate if not provided
});
```

### cURL Example

```bash
curl -X POST http://localhost:3000/api/ingest \
  -H "Content-Type: application/json" \
  -d '{
    "channel": "landing",
    "external_thread_id": "webchat-1234567890-abc",
    "instructor_id": "550e8400-e29b-41d4-a716-446655440000",
    "text": "Hello, I would like to book a lesson",
    "idempotency_key": "landing:1704067200000:abc123",
    "submit_time": 1704067200000,
    "honeypot": ""
  }'
```

**Response:**
```json
{
  "ok": true,
  "conversation_id": "550e8400-e29b-41d4-a716-446655440000",
  "trace_id": "trc_1704067200000_k3j9x2m8p"
}
```

### With trace_id Provided

```bash
curl -X POST http://localhost:3000/api/ingest \
  -H "Content-Type: application/json" \
  -d '{
    "channel": "landing",
    "external_thread_id": "webchat-1234567890-abc",
    "instructor_id": "550e8400-e29b-41d4-a716-446655440000",
    "text": "Hello",
    "trace_id": "trc_client_provided_123",
    "external_message_id": "landing_client_provided_456"
  }'
```

**Response:**
```json
{
  "ok": true,
  "conversation_id": "550e8400-e29b-41d4-a716-446655440000",
  "trace_id": "trc_client_provided_123"
}
```

## Environment Variables

### Required

```bash
SUPABASE_URL=https://your-project.supabase.co
FD_INGEST_KEY=your-secret-key-here  # ✅ Server-side only, never exposed
```

### Security Notes

- ✅ `FD_INGEST_KEY` is **never exposed** to the client
- ✅ Only read from `process.env` server-side
- ✅ Included in `x-fd-ingest-key` header to Edge Function
- ✅ Not included in any client responses

## Payload Schema

### Client → `/api/ingest`

```typescript
{
  channel: "landing",                    // Required
  external_thread_id: string,           // Required, max 255 chars
  instructor_id: string,                // Required, UUID format
  text: string,                         // Required, max 5000 chars, non-empty
  trace_id?: string,                    // Optional: if missing, server generates "trc_..."
  external_message_id?: string,         // Optional: if missing, server generates "landing_..."
  idempotency_key?: string,             // Optional
  submit_time?: number,                 // Optional, for anti-spam
  honeypot?: string,                    // Optional, should be empty
}
```

### Server → Edge Function `/functions/v1/ingest-inbound`

```typescript
{
  channel: "landing",
  external_thread_id: string,
  instructor_id: string,
  text: string,
  trace_id: string,                     // Always present (client or server-generated)
  external_message_id: string,          // Always present (client or server-generated)
  idempotency_key: string | null,
}
```

## Features

1. **Rate Limiting**: 10 requests per 60 seconds per IP
2. **Anti-Spam**: Honeypot field and minimum submit time checks
3. **Retry Logic**: Up to 3 retries with exponential backoff for 429/5xx errors
4. **Timeout**: 30-second timeout for upstream requests
5. **Error Handling**: Comprehensive error codes and messages
6. **Sentry Integration**: Error logging with trace_id for debugging

## Testing

### Test 1: Server Generates trace_id

```bash
curl -X POST http://localhost:3000/api/ingest \
  -H "Content-Type: application/json" \
  -d '{
    "channel": "landing",
    "external_thread_id": "test-thread-123",
    "instructor_id": "550e8400-e29b-41d4-a716-446655440000",
    "text": "Hello"
  }'
```

**Expected:**
- Response includes `trace_id` starting with `trc_`
- Response includes `external_message_id` starting with `landing_` (in Edge Function payload)

### Test 2: Client Provides trace_id

```bash
curl -X POST http://localhost:3000/api/ingest \
  -H "Content-Type: application/json" \
  -d '{
    "channel": "landing",
    "external_thread_id": "test-thread-123",
    "instructor_id": "550e8400-e29b-41d4-a716-446655440000",
    "text": "Hello",
    "trace_id": "trc_client_123"
  }'
```

**Expected:**
- Response includes `trace_id: "trc_client_123"` (propagated unchanged)
- Edge Function receives `trace_id: "trc_client_123"`

### Test 3: Verify Headers

Check server logs or Edge Function logs:
- `x-fd-ingest-key` header present (value from `FD_INGEST_KEY` env var)
- `x-request-id` header equals `trace_id` value

### Test 4: Verify Response Format

```bash
# Success case
{
  "ok": true,
  "conversation_id": "...",
  "trace_id": "trc_..."
}

# Error case
{
  "ok": false,
  "error": "...",
  "trace_id": "trc_...",
  "error_code": "..."
}
```

## Summary

✅ **trace_id generation** with prefix "trc_"  
✅ **external_message_id generation** with prefix "landing_"  
✅ **FD_INGEST_KEY** read from server env only  
✅ **Headers** `x-fd-ingest-key` and `x-request-id=trace_id`  
✅ **Response format** `{ ok: true, conversation_id, trace_id }`  
✅ **Security** FD_INGEST_KEY never exposed to client  
