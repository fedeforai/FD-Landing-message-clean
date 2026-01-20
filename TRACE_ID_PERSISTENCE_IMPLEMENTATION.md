# Trace ID Persistence Implementation

## Overview

Implemented trace_id generation **once per session/thread** with persistence in localStorage, ensuring trace_id is propagated to both Make webhooks and ingest-inbound proxy.

## Changes Summary

### 1. Storage Layer (`lib/storage.js`)

**Added:**
- `TRACE_ID` storage key: `"frostdesk_trace_id"`
- `getTraceId()` - Retrieve trace_id from localStorage
- `setTraceId(traceId)` - Store trace_id in localStorage
- `getOrCreateTraceId()` - Get existing trace_id or generate new UUID v4

**Key Behavior:**
- trace_id is generated **once per thread/session**
- Persisted in localStorage alongside `external_thread_id`
- Reused across all messages in the same thread

### 2. Client (`pages/index.js`)

**Changes:**
- Import `getOrCreateTraceId` from `lib/storage`
- Initialize `traceIdRef` on component mount
- Use persistent trace_id from localStorage (not generate per message)
- trace_id is now shared across all messages in the same thread

**Before:**
```javascript
// Generated new trace_id per message
const traceId = generateUUID();
```

**After:**
```javascript
// Get or create trace_id once per thread (persisted)
const traceId = getOrCreateTraceId();
traceIdRef.current = traceId;
```

### 3. Make Webhook Endpoints

**Updated files:**
- `pages/api/make/chat.ts`
- `pages/api/make/request.ts`
- `pages/api/make/confirm.ts`

**Changes:**
- Generate trace_id server-side if not provided in request body
- Accept trace_id from client if provided
- Always include trace_id in payload to Make webhook
- Always include trace_id in response

**Behavior:**
- If client provides trace_id: use it (propagate unchanged)
- If client doesn't provide trace_id: generate server-side UUID v4
- trace_id is always present in payload to Make

### 4. Ingest Proxy (`pages/api/ingest.js`)

**Already implemented:**
- Accepts trace_id from client
- Generates trace_id server-side if not provided
- Propagates trace_id to `ingest-inbound` Edge Function

## Updated Payload Schemas

### 1. Client → `/api/ingest`

```typescript
{
  channel: "landing",
  external_thread_id: string,        // From localStorage (persisted)
  instructor_id: string,              // Selected instructor UUID
  text: string,                       // Message text (max 5000 chars)
  trace_id: string,                   // ✅ From localStorage (persisted, one per thread)
  external_message_id: string,        // UUID v4 (new per message)
  idempotency_key: string,            // Format: "landing:timestamp:uuid"
  submit_time?: number,               // Timestamp for anti-spam
  honeypot?: string,                  // Empty string (anti-spam)
}
```

### 2. Client → `/api/make/*` (chat, request, confirm)

```typescript
{
  // ... existing fields ...
  trace_id: string,                   // ✅ From localStorage (persisted, one per thread)
  // ... other fields ...
}
```

### 3. Server Route → Make Webhook

```typescript
{
  // ... request body fields ...
  trace_id: string,                   // ✅ Always present (client or server-generated)
}
```

### 4. Server Route → `ingest-inbound` Edge Function

```typescript
{
  channel: "landing",
  external_thread_id: string,
  instructor_id: string,
  text: string,
  trace_id: string,                   // ✅ Always present (client or server-generated)
  external_message_id: string,        // Always present (for idempotency)
  idempotency_key: string | null,
}
```

## File Changes

### `lib/storage.js`

```javascript
// Added to STORAGE_KEYS
const STORAGE_KEYS = {
  EXTERNAL_THREAD_ID: "frostdesk_external_thread_id",
  SELECTED_INSTRUCTOR_ID: "frostdesk_selected_instructor_id",
  TRACE_ID: "frostdesk_trace_id",  // ✅ NEW
};

// ✅ NEW functions
export function getTraceId() {
  return safeLocalStorageGet(STORAGE_KEYS.TRACE_ID);
}

export function setTraceId(traceId) {
  if (traceId) {
    safeLocalStorageSet(STORAGE_KEYS.TRACE_ID, traceId);
  } else {
    safeLocalStorageRemove(STORAGE_KEYS.TRACE_ID);
  }
}

export function getOrCreateTraceId() {
  const existing = getTraceId();
  if (existing) return existing;

  // Generate UUID v4
  const newTraceId = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
  
  setTraceId(newTraceId);
  return newTraceId;
}
```

### `pages/index.js`

```javascript
// ✅ Added import
import {
  // ... existing imports ...
  getOrCreateTraceId,  // ✅ NEW
} from "../lib/storage";

// ✅ Added ref
const traceIdRef = useRef(null);

// ✅ Initialize in useEffect
useEffect(() => {
  // ... existing code ...
  
  // Ensure trace_id exists (one per session/thread)
  const traceId = getOrCreateTraceId();
  traceIdRef.current = traceId;
}, []);

// ✅ Updated message sending
async function handleChatSend() {
  // ... existing code ...
  
  // Get or create trace_id (one per session/thread, persisted in localStorage)
  const traceId = getOrCreateTraceId();
  traceIdRef.current = traceId;
  
  // ... rest of the function uses traceId ...
}
```

### `pages/api/make/chat.ts` (and `request.ts`, `confirm.ts`)

```typescript
// ✅ Added UUID generation
function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // ... existing code ...
  
  // ✅ Generate trace_id if not provided
  const body = req.body ?? {};
  const clientTraceId = body.trace_id;
  const serverTraceId = generateUUID();
  const traceId = clientTraceId || serverTraceId;

  // ✅ Ensure trace_id is included in payload to Make
  const payload = {
    ...body,
    trace_id: traceId,
  };

  const r = await fetch(MAKE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),  // ✅ Includes trace_id
  });
  
  // ✅ Include trace_id in response
  const parsed = JSON.parse(text);
  return res.json({
    ...parsed,
    trace_id: parsed.trace_id || traceId,
  });
}
```

## Flow Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                    Page Load / First Message                │
└─────────────────────────────────────────────────────────────┘
                          │
                          ▼
        ┌─────────────────────────────────────┐
        │  localStorage:                      │
        │  - frostdesk_external_thread_id     │
        │  - frostdesk_trace_id ←─ NEW! ✅    │
        └─────────────────────────────────────┘
                          │
                          ▼
        ┌─────────────────────────────────────┐
        │  getOrCreateTraceId()               │
        │  - Check localStorage               │
        │  - If exists: return it             │
        │  - If not: generate UUID v4         │
        │    and persist                      │
        └─────────────────────────────────────┘
                          │
                          ▼
        ┌─────────────────────────────────────┐
        │  All Messages in Same Thread        │
        │  Use Same trace_id ✅                │
        └─────────────────────────────────────┘
                          │
        ┌─────────────────┴─────────────────┐
        │                                   │
        ▼                                   ▼
┌──────────────┐                  ┌──────────────┐
│  /api/ingest │                  │ /api/make/*  │
│              │                  │              │
│  trace_id ✅ │                  │  trace_id ✅ │
└──────────────┘                  └──────────────┘
        │                                   │
        ▼                                   ▼
┌──────────────┐                  ┌──────────────┐
│ ingest-inbound│                  │ Make Webhook │
│ (Edge Func)  │                  │              │
│              │                  │              │
│  trace_id ✅ │                  │  trace_id ✅ │
└──────────────┘                  └──────────────┘
```

## Benefits

1. **Consistent Tracing**: Same trace_id across all messages in a thread enables end-to-end correlation
2. **Make Integration**: Make webhooks receive trace_id for workflow tracking
3. **Orchestrator Integration**: ingest-inbound receives trace_id for request correlation
4. **Debugging**: trace_id persists across page reloads (as long as localStorage persists)
5. **Backward Compatible**: Server-side generation ensures trace_id is always present

## localStorage Keys

| Key | Description | Lifetime |
|-----|-------------|----------|
| `frostdesk_external_thread_id` | Thread identifier for conversation continuity | Persistent until cleared |
| `frostdesk_selected_instructor_id` | Selected instructor UUID | Persistent until cleared |
| `frostdesk_trace_id` | **NEW:** Trace ID for request correlation (one per thread) | Persistent until cleared |

## Testing

### Test 1: Trace ID Persistence

1. Open landing page
2. Send first message
3. Check localStorage: `frostdesk_trace_id` should be set
4. Send second message
5. Verify: Same trace_id used for both messages

### Test 2: Make Webhook Receives Trace ID

```bash
curl -X POST http://localhost:3000/api/make/chat \
  -H "Content-Type: application/json" \
  -d '{
    "external_thread_id": "test-thread-123",
    "instructor_id": "550e8400-e29b-41d4-a716-446655440000",
    "text": "Hello"
  }'
```

**Expected:**
- Request to Make webhook includes `trace_id` (server-generated)
- Response includes `trace_id`

### Test 3: Client Provides Trace ID to Make Webhook

```bash
curl -X POST http://localhost:3000/api/make/chat \
  -H "Content-Type: application/json" \
  -d '{
    "external_thread_id": "test-thread-123",
    "instructor_id": "550e8400-e29b-41d4-a716-446655440000",
    "text": "Hello",
    "trace_id": "client-provided-uuid-123"
  }'
```

**Expected:**
- Request to Make webhook includes `trace_id: "client-provided-uuid-123"` (propagated unchanged)
- Response includes `trace_id: "client-provided-uuid-123"`

### Test 4: Ingest Proxy Receives Persistent Trace ID

1. Open landing page
2. Send message
3. Check network tab: Request to `/api/ingest` includes `trace_id` from localStorage
4. Check server logs: Payload to `ingest-inbound` includes same `trace_id`

## Environment Variables

No new environment variables required. All trace_id generation is handled client-side (localStorage) or server-side (fallback).

## Migration Notes

**Backward Compatibility:**
- Server routes generate trace_id if client doesn't provide it
- Existing code continues to work
- No breaking changes

**Client Migration:**
- New clients automatically get trace_id persistence on first message
- Existing clients without trace_id will have it generated server-side

## Summary

✅ **trace_id generated once per session/thread**  
✅ **trace_id persisted in localStorage**  
✅ **trace_id included in all payloads to Make webhooks**  
✅ **trace_id included in all payloads to ingest-inbound**  
✅ **Backward compatible (server-side fallback)**  
✅ **No breaking changes**
