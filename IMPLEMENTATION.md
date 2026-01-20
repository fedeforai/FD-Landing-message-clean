# FrostDesk Landing - Implementation Summary

## Overview
Minimal, conversion-focused landing page that turns a new lead into a confirmed lesson in under 2 minutes.

## File Structure

### Main Landing Page
**`pages/index.js`**
- Main React component with instructor list and chat widget
- Handles instructor selection, chat messaging, and WhatsApp CTA
- Manages localStorage for thread_id and instructor_id
- Implements rate limiting (1 second minimum between sends)
- Tracks events: `select_instructor`, `cta_click`

### API Endpoints

**`pages/api/instructors.ts`**
- Server-side endpoint that queries Supabase
- Filters instructors by `onboarding_state='approved'` (safety)
- Returns: `id`, `name`, `slug`, `photo_url`, `bio`, `frostdesk_enabled`, `whatsapp_number`
- Uses service role key (not exposed to client)
- Supports both list and single instructor fetch

**`pages/api/ingest.js`** (existing)
- Proxies requests to Orchestrator
- Expects `ORCH_URL` environment variable
- Passes through payload and response

### Utility Libraries

**`lib/storage.js`**
- localStorage management for:
  - `frostdesk_external_thread_id` - Thread ID for chat continuity
  - `frostdesk_selected_instructor_id` - Selected instructor UUID
- Functions: `getOrCreateExternalThreadId()`, `setSelectedInstructorId()`, etc.

**`lib/api.js`**
- `sendChatMessage()` - Sends chat message to `/api/ingest` with:
  - `channel: "webchat"`
  - `external_thread_id` (from localStorage)
  - `instructor_id` (selected)
  - `text` (message content)
- `trackEvent()` - Tracks events with `intent` and `metadata`
- `fetchInstructors()` - Fetches instructor list
- `fetchInstructor(id)` - Fetches single instructor

**`lib/utils.js`**
- `getInstructorInitials()` - Generates initials from name
- `getInstructorBadges()` - Extracts badges from bio (Director, Olympian, Ambassador)
- `buildWhatsAppLink()` - Builds WhatsApp deep link
- `debounce()` - Utility for rate limiting (not currently used, using time-based throttling instead)

## Data Flow

### Instructor Selection
1. User clicks instructor → `handleInstructorSelect()`
2. Saves to localStorage: `frostdesk_selected_instructor_id`
3. Sends event to Orchestrator: `POST /api/ingest` with `intent: "select_instructor"`

### Chat Message
1. User types message → `handleChatSend()`
2. Gets/creates `external_thread_id` from localStorage
3. Sends to Orchestrator: `POST /api/ingest` with:
   - `channel: "webchat"`
   - `external_thread_id`
   - `instructor_id`
   - `text`
4. Receives response with `replyText`
5. Renders AI response (or "Instructor will reply soon" if null)

### WhatsApp CTA
1. Visible when:
   - Instructor selected AND
   - `instructor.frostdesk_enabled === true` AND
   - At least 1 message exchanged (optional)
2. On click: tracks `cta_click` event and opens WhatsApp link

## localStorage Keys
- `frostdesk_external_thread_id` - Persistent thread ID for chat continuity
- `frostdesk_selected_instructor_id` - Selected instructor UUID

## Event Tracking
All events sent to `/api/ingest` with `metadata.intent`:
- `select_instructor` - When instructor is selected
- `cta_click` - When WhatsApp CTA is clicked (with `metadata.cta_type: "whatsapp"`)

## Safety & Security
- Only approved instructors shown (`onboarding_state='approved'`)
- Service keys never exposed to client
- Server-side Supabase queries use service role key
- Client-side rate limiting (1 second minimum between sends)

## UX Features
- Instructors sorted alphabetically
- Avatar with photo_url or initials fallback
- Badge extraction from bio (Director, Olympian, Ambassador)
- Chat scrolls to bottom on new messages
- Input disabled when no instructor selected
- Loading states during API calls

## Environment Variables Required
- `ORCH_URL` - Orchestrator endpoint
- `SUPABASE_URL` - Supabase project URL
- `SUPABASE_SERVICE_ROLE_KEY` - Supabase service role key
- `NEXT_PUBLIC_WA_LINK` (optional) - WhatsApp fallback link

## Testing
See `TEST_CHECKLIST.md` for comprehensive test scenarios.
