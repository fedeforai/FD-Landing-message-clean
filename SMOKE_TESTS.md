# Smoke Tests for Chat Hardening

## Prerequisites

1. Set environment variables:
   ```bash
   SUPABASE_URL=https://your-project.supabase.co
   INGEST_SHARED_SECRET=your-secret-key
   NEXT_PUBLIC_SENTRY_DSN=https://your-dsn@sentry.io/project-id
   ```

2. Start development server:
   ```bash
   npm run dev
   ```

## Test 1: Basic Message Send with Trace ID

**Steps:**
1. Open browser at `http://localhost:3000`
2. Open browser DevTools (Network tab + Console)
3. Select an instructor
4. Type a message: "Hello, I'd like to book a lesson"
5. Click Send

**Expected Results:**
- ✅ Message appears in chat UI
- ✅ Network request: `POST /api/ingest`
- ✅ Request payload includes:
  - `trace_id` (UUID v4 format)
  - `external_message_id` (UUID v4 format)
  - `idempotency_key` (format: `landing:timestamp:random`)
  - `external_thread_id` (from localStorage)
  - `instructor_id` (selected instructor UUID)
  - `text` (message content)
  - `submit_time` (number timestamp)
  - `honeypot` (empty string)
- ✅ Response includes:
  - `ok: true`
  - `trace_id` (UUID v4)
  - `conversation_id` (UUID v4)
  - `message_id` (UUID v4)
- ✅ Console shows Sentry breadcrumb: "Sending message" with trace_id

**Verify in Sentry:**
- Check Sentry dashboard for breadcrumb with trace_id
- Breadcrumb should include: trace_id, external_message_id, external_thread_id

---

## Test 2: Message Length Validation

**Steps:**
1. Select an instructor
2. Type a message with > 5000 characters (use: `"a".repeat(5001)`)
3. Try to send

**Expected Results:**
- ✅ Alert appears: "Message too long. Maximum 5000 characters allowed."
- ✅ Message not sent (no network request)
- ✅ Input field shows character count (if implemented)

**Server-Side Test:**
```bash
curl -X POST http://localhost:3000/api/ingest \
  -H "Content-Type: application/json" \
  -d '{
    "channel": "landing",
    "external_thread_id": "test-thread-123",
    "instructor_id": "test-instructor-id",
    "text": "'"$(python3 -c "print('a' * 5001)")"'"
  }'
```

**Expected:**
- Status: 400 Bad Request
- Body: `{"ok": false, "error": "Message too long...", "trace_id": "...", "error_code": "MESSAGE_TOO_LONG"}`

---

## Test 3: Honeypot Protection

**Steps:**
1. Open browser console
2. Select an instructor
3. Fill honeypot field:
   ```javascript
   document.querySelector('input[name="website"]').value = "spam"
   ```
4. Type a message and send

**Expected Results:**
- ✅ Message appears to send (no error shown)
- ✅ Network request returns: `200 OK`
- ✅ Response: `{"ok": true, "trace_id": "...", "conversation_id": null, "message_id": null}`
- ✅ No conversation created (silently rejected)
- ✅ No error shown to user

**Server-Side Test:**
```bash
curl -X POST http://localhost:3000/api/ingest \
  -H "Content-Type: application/json" \
  -d '{
    "channel": "landing",
    "external_thread_id": "test-thread-123",
    "instructor_id": "test-instructor-id",
    "text": "Hello",
    "honeypot": "spam"
  }'
```

**Expected:**
- Status: 200 OK
- Body: `{"ok": true, "trace_id": "...", "conversation_id": null, "message_id": null}`

---

## Test 4: Minimum Submit Time Protection

**Steps:**
1. Open browser console
2. Immediately after page load (< 2 seconds), select instructor and send message
3. Check console for warning

**Expected Results:**
- ✅ Console warning: "Message rejected: submit time too fast" (with time in ms)
- ✅ Message not sent (no network request)
- ✅ No error shown to user

**Server-Side Test:**
```bash
curl -X POST http://localhost:3000/api/ingest \
  -H "Content-Type: application/json" \
  -d '{
    "channel": "landing",
    "external_thread_id": "test-thread-123",
    "instructor_id": "test-instructor-id",
    "text": "Hello",
    "submit_time": '$(($(date +%s) * 1000))'
  }'
```

**Expected:**
- Status: 200 OK
- Body: `{"ok": true, "trace_id": "...", "conversation_id": null, "message_id": null}`

---

## Test 5: Sentry Logging

**Steps:**
1. Open Sentry dashboard
2. Send a message successfully
3. Check Sentry for breadcrumbs

**Expected Results:**
- ✅ Breadcrumb: "Sending message"
  - Category: `message`
  - Level: `info`
  - Data includes: `trace_id`, `external_message_id`, `external_thread_id`, `instructor_id`, `text_length`
- ✅ Breadcrumb: "Message sent successfully"
  - Category: `message`
  - Level: `info`
  - Data includes: `trace_id`, `conversation_id`, `message_id`, `has_reply`

**Error Test:**
1. Set invalid `INGEST_SHARED_SECRET` in `.env.local`
2. Restart server
3. Send a message
4. Check Sentry for exception

**Expected:**
- ✅ Exception logged with:
  - Tags: `error_code: "NETWORK_ERROR"` or `"MISSING_CONFIG"`
  - Extra: `trace_id`, `external_thread_id`, `instructor_id`

---

## Test 6: Trace ID Propagation

**Steps:**
1. Send a message
2. Note the `trace_id` from:
   - Client console (Sentry breadcrumb)
   - Network request payload
   - Network response
   - Sentry dashboard

**Expected Results:**
- ✅ Same `trace_id` appears in:
  - Client request payload
  - Server response
  - Sentry breadcrumbs
  - Sentry exceptions (if error)

---

## Test 7: Error Handling with Error Codes

**Test 7a: Invalid Channel**
```bash
curl -X POST http://localhost:3000/api/ingest \
  -H "Content-Type: application/json" \
  -d '{
    "channel": "invalid",
    "external_thread_id": "test-thread-123",
    "instructor_id": "test-instructor-id",
    "text": "Hello"
  }'
```

**Expected:**
- Status: 400 Bad Request
- Body: `{"ok": false, "error": "Invalid or missing channel...", "trace_id": "...", "error_code": "INVALID_CHANNEL"}`

**Test 7b: Missing Required Field**
```bash
curl -X POST http://localhost:3000/api/ingest \
  -H "Content-Type: application/json" \
  -d '{
    "channel": "landing",
    "external_thread_id": "test-thread-123",
    "instructor_id": "test-instructor-id"
  }'
```

**Expected:**
- Status: 400 Bad Request
- Body: `{"ok": false, "error": "Invalid or missing text", "trace_id": "...", "error_code": "INVALID_TEXT"}`

**Test 7c: Missing Authentication**
```bash
# Set INGEST_SHARED_SECRET to invalid value in .env.local
# Restart server
curl -X POST http://localhost:3000/api/ingest \
  -H "Content-Type: application/json" \
  -d '{
    "channel": "landing",
    "external_thread_id": "test-thread-123",
    "instructor_id": "test-instructor-id",
    "text": "Hello"
  }'
```

**Expected:**
- Status: 401 Unauthorized (from Supabase Edge Function)
- Body includes `trace_id` and `error_code`

---

## Test 8: Stable External Thread ID

**Steps:**
1. Send first message
2. Check localStorage: `frostdesk_external_thread_id`
3. Refresh page
4. Send second message
5. Check Network tab: both messages use same `external_thread_id`

**Expected Results:**
- ✅ `external_thread_id` persists in localStorage
- ✅ Same `external_thread_id` used for all messages in same session
- ✅ Thread ID format: UUID v4 or custom format (e.g., `land:web:uuid`)

---

## Test 9: Idempotency Key Uniqueness

**Steps:**
1. Send a message
2. Note the `idempotency_key` from Network tab
3. Send another message
4. Compare `idempotency_key` values

**Expected Results:**
- ✅ Each message has unique `idempotency_key`
- ✅ Format: `landing:{timestamp}:{random}`
- ✅ Keys are different for each message

---

## Test 10: Server Route Calls Correct Endpoint

**Steps:**
1. Open Network tab
2. Send a message
3. Check server logs (or use proxy to inspect)

**Expected Results:**
- ✅ Server calls: `POST {SUPABASE_URL}/functions/v1/ingest-inbound`
- ✅ Request includes header: `x-fd-ingest-key: {INGEST_SHARED_SECRET}`
- ✅ Server does NOT call old endpoint: `{ORCH_URL}/ingest`

**Verification:**
- Check server logs for fetch URL
- Should see: `https://{project}.supabase.co/functions/v1/ingest-inbound`

---

## Test 11: Secret Never Exposed

**Steps:**
1. Open browser DevTools
2. Go to Sources tab
3. Search for `INGEST_SHARED_SECRET` or `FD_INGEST_KEY`

**Expected Results:**
- ✅ No occurrences of `INGEST_SHARED_SECRET` in client-side code
- ✅ No occurrences of `FD_INGEST_KEY` in client-side code
- ✅ Secret only exists in server-side code (`pages/api/ingest.js`)

---

## Test 12: Payload Structure Validation

**Steps:**
1. Send a message
2. Inspect Network tab → Request Payload

**Expected Payload Structure:**
```json
{
  "channel": "landing",
  "external_thread_id": "uuid-or-custom-id",
  "instructor_id": "uuid",
  "text": "message text",
  "idempotency_key": "landing:timestamp:random",
  "trace_id": "uuid-v4",
  "external_message_id": "uuid-v4",
  "submit_time": 1234567890,
  "honeypot": ""
}
```

**Expected Results:**
- ✅ All required fields present
- ✅ `channel` is exactly `"landing"`
- ✅ `trace_id` is valid UUID v4
- ✅ `external_message_id` is valid UUID v4
- ✅ `idempotency_key` matches format
- ✅ `honeypot` is empty string

---

## Automated Test Script

```bash
#!/bin/bash
# smoke-test.sh

BASE_URL="http://localhost:3000"
SUPABASE_URL="${SUPABASE_URL:-https://test.supabase.co}"

echo "=== Smoke Test: Chat Hardening ==="

# Test 1: Basic message send
echo "Test 1: Basic message send..."
RESPONSE=$(curl -s -X POST "${BASE_URL}/api/ingest" \
  -H "Content-Type: application/json" \
  -d '{
    "channel": "landing",
    "external_thread_id": "test-thread-123",
    "instructor_id": "550e8400-e29b-41d4-a716-446655440000",
    "text": "Hello, test message",
    "trace_id": "550e8400-e29b-41d4-a716-446655440001",
    "external_message_id": "550e8400-e29b-41d4-a716-446655440002",
    "idempotency_key": "landing:1234567890:abc123",
    "submit_time": 1234567890,
    "honeypot": ""
  }')

if echo "$RESPONSE" | grep -q '"ok":true'; then
  echo "✅ Test 1 passed"
else
  echo "❌ Test 1 failed: $RESPONSE"
fi

# Test 2: Message too long
echo "Test 2: Message too long..."
LONG_TEXT=$(python3 -c "print('a' * 5001)")
RESPONSE=$(curl -s -X POST "${BASE_URL}/api/ingest" \
  -H "Content-Type: application/json" \
  -d "{
    \"channel\": \"landing\",
    \"external_thread_id\": \"test-thread-123\",
    \"instructor_id\": \"550e8400-e29b-41d4-a716-446655440000\",
    \"text\": \"${LONG_TEXT}\"
  }")

if echo "$RESPONSE" | grep -q '"error_code":"MESSAGE_TOO_LONG"'; then
  echo "✅ Test 2 passed"
else
  echo "❌ Test 2 failed: $RESPONSE"
fi

# Test 3: Honeypot filled
echo "Test 3: Honeypot protection..."
RESPONSE=$(curl -s -X POST "${BASE_URL}/api/ingest" \
  -H "Content-Type: application/json" \
  -d '{
    "channel": "landing",
    "external_thread_id": "test-thread-123",
    "instructor_id": "550e8400-e29b-41d4-a716-446655440000",
    "text": "Hello",
    "honeypot": "spam"
  }')

if echo "$RESPONSE" | grep -q '"conversation_id":null'; then
  echo "✅ Test 3 passed (honeypot rejected)"
else
  echo "❌ Test 3 failed: $RESPONSE"
fi

# Test 4: Invalid channel
echo "Test 4: Invalid channel..."
RESPONSE=$(curl -s -X POST "${BASE_URL}/api/ingest" \
  -H "Content-Type: application/json" \
  -d '{
    "channel": "invalid",
    "external_thread_id": "test-thread-123",
    "instructor_id": "550e8400-e29b-41d4-a716-446655440000",
    "text": "Hello"
  }')

if echo "$RESPONSE" | grep -q '"error_code":"INVALID_CHANNEL"'; then
  echo "✅ Test 4 passed"
else
  echo "❌ Test 4 failed: $RESPONSE"
fi

echo "=== Smoke tests complete ==="
```

---

## Manual Verification Checklist

- [ ] Every message generates unique `trace_id` (UUID v4)
- [ ] Every message generates unique `external_message_id` (UUID v4)
- [ ] `external_thread_id` persists in localStorage
- [ ] Server calls `/functions/v1/ingest-inbound` (not old endpoint)
- [ ] Server uses `INGEST_SHARED_SECRET` header
- [ ] Max message length enforced (5000 chars)
- [ ] Honeypot field present and functional
- [ ] Minimum submit time enforced (2 seconds)
- [ ] Sentry breadcrumbs include trace_id
- [ ] All errors include trace_id and error_code
- [ ] Secrets never exposed to browser
