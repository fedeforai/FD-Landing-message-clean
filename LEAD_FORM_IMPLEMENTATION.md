# Lead Form Implementation

## Overview

Implementation of `/api/ingest-lead` proxy endpoint for lead capture form that forwards messages to Supabase Edge Function `ingest-inbound` securely.

## Files Created

### 1. `pages/api/ingest-lead.ts`

Server-side API route that:
- Accepts POST from client form: `name`, `email`, `message`, `instructor_id` or `instructor_slug`, `channel='webchat'`
- Adds headers:
  - `x-fd-ingest-key` from env `FD_INGEST_KEY`
  - `x-request-id` trace_id (UUID v4)
- Forwards to `${ORCH_URL}/functions/v1/ingest-inbound`
- Returns `{ ok, trace_id }` to client
- Implements anti-spam: honeypot + minimum submit time

### 2. `components/LeadForm.tsx`

Client-side form component with:
- Name, email, message fields
- Anti-spam protection (honeypot + submit time)
- Error handling
- Success feedback
- Loading states

## Environment Variables

### Required

```bash
ORCH_URL=https://your-project.supabase.co
FD_INGEST_KEY=your-secret-key-here
```

### Example `.env.local`

```bash
ORCH_URL=https://abcdefghijklmnop.supabase.co
FD_INGEST_KEY=your-fd-ingest-key-secret
```

## Usage

### Basic Usage

```tsx
import LeadForm from "../components/LeadForm";

export default function ContactPage() {
  return (
    <div>
      <h1>Contact Us</h1>
      <LeadForm 
        instructorId="550e8400-e29b-41d4-a716-446655440000"
        onSubmit={(result) => {
          console.log("Form submitted:", result);
        }}
      />
    </div>
  );
}
```

### With Instructor Slug

```tsx
<LeadForm 
  instructorSlug="john-doe"
  onSubmit={(result) => {
    if (result.ok) {
      console.log("Trace ID:", result.trace_id);
    }
  }}
/>
```

## API Endpoint

### Request

```http
POST /api/ingest-lead
Content-Type: application/json

{
  "name": "John Doe",
  "email": "john@example.com",
  "message": "I'd like to book a lesson",
  "instructor_id": "550e8400-e29b-41d4-a716-446655440000",
  "channel": "webchat",
  "honeypot": "",
  "submit_time": 1704067200000
}
```

### Response (Success)

```json
{
  "ok": true,
  "trace_id": "550e8400-e29b-41d4-a716-446655440000",
  "conversation_id": "660e8400-e29b-41d4-a716-446655440001"
}
```

### Response (Error)

```json
{
  "ok": false,
  "error": "Email is required",
  "trace_id": "550e8400-e29b-41d4-a716-446655440000"
}
```

## Anti-Spam Protection

### 1. Honeypot Field

Hidden input field that bots will fill but users won't see:
- Field name: `website`
- Position: absolute, off-screen
- If filled → request silently rejected

### 2. Minimum Submit Time

- Form render time tracked
- Minimum 2 seconds between render and submit
- If submit too fast → request silently rejected

## Payload to ingest-inbound

The endpoint forwards this payload to `${ORCH_URL}/functions/v1/ingest-inbound`:

```json
{
  "channel": "webchat",
  "external_thread_id": "lead-1704067200000-abc123",
  "text": "Name: John Doe\nEmail: john@example.com\n\nMessage:\nI'd like to book a lesson",
  "instructor_id": "550e8400-e29b-41d4-a716-446655440000",
  "trace_id": "550e8400-e29b-41d4-a716-446655440000",
  "external_message_id": "lead_1704067200000_xyz789",
  "channel_metadata": {
    "source": "lead_form",
    "client_name": "John Doe",
    "email": "john@example.com",
    "submit_time": 1704067200000
  }
}
```

## Headers Sent to ingest-inbound

```http
Content-Type: application/json
x-fd-ingest-key: {FD_INGEST_KEY}
x-request-id: {trace_id}
```

## Validation

### Client-Side (Form Component)
- Name: required, max 255 chars
- Email: required, max 255 chars, email format
- Message: required, max 5000 chars
- Instructor: either `instructor_id` or `instructor_slug` required

### Server-Side (API Route)
- All client-side validations repeated
- Email regex validation
- Message length check (max 5000 chars)
- Honeypot check
- Minimum submit time check

## Error Handling

### Client Errors (400)
- Missing required fields
- Invalid email format
- Message too long
- Missing instructor_id/slug

### Server Errors (500)
- Missing `ORCH_URL` env var
- Missing `FD_INGEST_KEY` env var

### Upstream Errors (502/504)
- Orchestrator unreachable
- Request timeout (30 seconds)
- Invalid response format

## Security

✅ **Secrets never exposed** - `FD_INGEST_KEY` only used server-side  
✅ **Anti-spam protection** - Honeypot + submit time checks  
✅ **Input validation** - All fields validated server-side  
✅ **Rate limiting** - Can be added via middleware if needed  
✅ **Trace ID** - Every request has trace_id for debugging  

## Testing

### Test 1: Valid Submission

```bash
curl -X POST http://localhost:3000/api/ingest-lead \
  -H "Content-Type: application/json" \
  -d '{
    "name": "John Doe",
    "email": "john@example.com",
    "message": "I want to book a lesson",
    "instructor_id": "550e8400-e29b-41d4-a716-446655440000",
    "channel": "webchat",
    "submit_time": 1704067200000
  }'
```

**Expected:** `{ "ok": true, "trace_id": "..." }`

### Test 2: Honeypot Triggered

```bash
curl -X POST http://localhost:3000/api/ingest-lead \
  -H "Content-Type: application/json" \
  -d '{
    "name": "John Doe",
    "email": "john@example.com",
    "message": "Test",
    "instructor_id": "550e8400-e29b-41d4-a716-446655440000",
    "honeypot": "filled",
    "submit_time": 1704067200000
  }'
```

**Expected:** `{ "ok": true, "trace_id": "..." }` (silently rejected)

### Test 3: Missing Fields

```bash
curl -X POST http://localhost:3000/api/ingest-lead \
  -H "Content-Type: application/json" \
  -d '{
    "name": "John Doe"
  }'
```

**Expected:** `{ "ok": false, "error": "Email is required", "trace_id": "..." }`

## Styling

Add CSS for the form (example):

```css
.lead-form {
  max-width: 600px;
  margin: 0 auto;
}

.form-group {
  margin-bottom: 1rem;
}

.form-group label {
  display: block;
  margin-bottom: 0.5rem;
  font-weight: 500;
}

.form-group input,
.form-group textarea {
  width: 100%;
  padding: 0.5rem;
  border: 1px solid #ccc;
  border-radius: 4px;
}

.form-error {
  color: red;
  margin-bottom: 1rem;
  padding: 0.5rem;
  background: #fee;
  border-radius: 4px;
}

.form-success {
  color: green;
  margin-bottom: 1rem;
  padding: 0.5rem;
  background: #efe;
  border-radius: 4px;
}

.submit-button {
  padding: 0.75rem 1.5rem;
  background: #0070f3;
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
}

.submit-button:disabled {
  background: #ccc;
  cursor: not-allowed;
}
```

## Notes

- Endpoint name is `/api/ingest-lead` to avoid conflict with existing `/api/ingest` (chat)
- Can be renamed to `/api/ingest` if replacing chat endpoint
- Form component is client-side only (`"use client"`)
- Trace ID generated server-side for every request
- All requests logged with trace_id for debugging
