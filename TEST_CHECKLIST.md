# FrostDesk Landing - Test Checklist

## Setup
- [ ] Environment variables configured:
  - `ORCH_URL` - Orchestrator endpoint
  - `SUPABASE_URL` - Supabase project URL
  - `SUPABASE_SERVICE_ROLE_KEY` - Supabase service role key
  - `NEXT_PUBLIC_WA_LINK` (optional) - WhatsApp fallback link

## Core Functionality

### Instructor Selection
- [ ] **Test: Select instructor sets thread instructor_id**
  - Select an instructor from the list
  - Check browser localStorage: `frostdesk_selected_instructor_id` should be set
  - Verify instructor details appear in chat header
  - Check Network tab: POST to `/api/ingest` with `intent: "select_instructor"` should be sent

### Thread Management
- [ ] **Test: Second message keeps same thread**
  - Select an instructor
  - Send first message
  - Check localStorage: `frostdesk_external_thread_id` should exist
  - Send second message
  - Verify both messages use the same `external_thread_id` in Network requests
  - Verify thread ID persists across page refreshes

### Chat Functionality
- [ ] **Test: Chat send -> POST /ingest -> render replyText**
  - Select an instructor
  - Type a message and send
  - Check Network tab: POST to `/api/ingest` with:
    - `channel: "webchat"`
    - `external_thread_id` (from localStorage)
    - `instructor_id` (selected instructor)
    - `text` (message content)
  - Verify AI response appears in chat (from `replyText` field)
  - If `replyText` is null, verify "Instructor will reply soon" message appears

### WhatsApp CTA
- [ ] **Test: CTA appears only when expected**
  - Select an instructor with `frostdesk_enabled=true`
  - Verify CTA does NOT appear initially (before first message)
  - Send at least 1 message
  - Verify CTA "Continue on WhatsApp" appears
  - Select an instructor with `frostdesk_enabled=false`
  - Verify CTA does NOT appear even after messages
  - Verify CTA does NOT appear if no instructor selected

### Event Tracking
- [ ] **Test: cta_click logs an event**
  - Select an instructor with `frostdesk_enabled=true`
  - Send at least 1 message
  - Click "Continue on WhatsApp" button
  - Check Network tab: POST to `/api/ingest` with:
    - `intent: "cta_click"`
    - `metadata.cta_type: "whatsapp"`
  - Verify WhatsApp link opens in new tab

## Safety & Correctness

### Instructor Filtering
- [ ] Only instructors with `onboarding_state='approved'` are shown
- [ ] Instructors without approved status are not visible in list
- [ ] Single instructor fetch also respects approval status

### Data Security
- [ ] No service keys exposed to client
- [ ] `/api/instructors` uses server-side service role key
- [ ] `/api/ingest` proxies to Orchestrator (no direct client access)

### Rate Limiting
- [ ] Rapid message sends are throttled (1 second minimum between sends)
- [ ] UI shows loading state during send
- [ ] Multiple rapid clicks don't send duplicate messages

## UX Details

### Instructor List
- [ ] Instructors sorted alphabetically by name
- [ ] Avatar shows `photo_url` if available, otherwise initials fallback
- [ ] Badges appear for keywords: "Director", "Olympian", "Ambassador"
- [ ] Selected instructor is visually highlighted

### Chat Widget
- [ ] Selected instructor name shown at top
- [ ] Messages list scrolls to bottom on new message
- [ ] Input disabled when no instructor selected
- [ ] Send button disabled when input is empty or sending
- [ ] Enter key sends message (Shift+Enter for newline if needed)

### localStorage Persistence
- [ ] Selected instructor persists across page refresh
- [ ] Thread ID persists across page refresh
- [ ] Chat messages are NOT persisted (fresh start on refresh)

## Edge Cases

- [ ] Handle network errors gracefully
- [ ] Handle empty instructor list
- [ ] Handle instructor fetch failure
- [ ] Handle missing WhatsApp number (fallback to env var or show error)
- [ ] Handle null `replyText` from Orchestrator (show "Instructor will reply soon")
