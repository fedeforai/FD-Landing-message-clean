# Implementation Checklist

## Repo 1: Orchestrator (Supabase Edge Functions)

### ✅ Step 1: Create get-instructor-context Edge Function

**File:** `supabase/functions/get-instructor-context/index.ts`

1. Copy code from `REPO_ORCHESTRATOR_get-instructor-context.ts`
2. Deploy: `supabase functions deploy get-instructor-context`
3. Set environment variables:
   ```bash
   supabase secrets set FD_INGEST_KEY=your-secret-key
   ```

### ✅ Step 2: Update ingest-inbound Edge Function

**File:** `supabase/functions/ingest-inbound/index.ts`

1. Find task creation code
2. Add `trace_id` to task metadata (see `REPO_ORCHESTRATOR_ingest-inbound-update.ts`)
3. Add event logging with trace_id
4. Redeploy: `supabase functions deploy ingest-inbound`

### ✅ Step 3: Database Schema

**Run:** `DATABASE_SCHEMA.sql` in Supabase SQL Editor

---

## Repo 2: Make Scenario

### ✅ Step 4: Create Make Scenario

1. Create new scenario in Make.com
2. Set up Supabase webhook trigger (tasks table, insert event)
3. Add modules as documented in `REPO_MAKE_scenario-config.json`
4. Configure environment variables:
   - `FD_INGEST_KEY`
   - `SUPABASE_URL`
   - `OPENAI_API_KEY`
   - `GOOGLE_CALENDAR_CLIENT_ID` (optional)
   - `GOOGLE_CALENDAR_CLIENT_SECRET` (optional)

### ✅ Step 5: Test Make Scenario

1. Create test task in Supabase:
   ```sql
   INSERT INTO tasks (conversation_id, task_type, status, metadata)
   VALUES (
     'your-conversation-id',
     'ai_reply',
     'pending',
     '{"trace_id": "trc_test_123", "instructor_id": "your-instructor-id"}'
   );
   ```
2. Verify scenario runs
3. Check task status updated
4. Verify reply sent via ingest-inbound

---

## Repo 3: Main App

### ✅ Step 6: Create Diagnostics Page

**File:** `app/conversations/[id]/diagnostics/page.tsx`

1. Copy code from `REPO_MAIN_APP_diagnostics.tsx`
2. Ensure Tailwind CSS is configured
3. Test page loads and displays events

### ✅ Step 7: Add Diagnostics Link

**File:** `app/conversations/[id]/page.tsx`

1. Add link from `REPO_MAIN_APP_diagnostics-link.tsx`
2. Test navigation works

### ✅ Step 8: Environment Variables

Add to `.env.local`:
```bash
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
```

---

## Repo 4: Landing (No Changes Needed)

✅ Landing already implements trace_id propagation

---

## End-to-End Testing

### Test Flow 1: Normal AI Reply

1. **Landing:** Send message with trace_id
2. **Orchestrator:** Creates task with trace_id in metadata
3. **Make:** Processes task, gets context, generates reply
4. **Make:** Sends reply via ingest-inbound with trace_id
5. **Landing:** Receives and displays reply
6. **Main App:** Diagnostics shows all events with trace_id

### Test Flow 2: Handoff Stop

1. **Main App:** Set `handoff_to_human = true` on conversation
2. **Landing:** Send message
3. **Orchestrator:** Creates task
4. **Make:** Gets context, sees `handoff_to_human = true`
5. **Make:** Stops immediately (no AI reply)
6. **Main App:** Diagnostics shows handoff event

### Test Flow 3: Diagnostics UI

1. **Main App:** Navigate to conversation detail
2. Click "View Diagnostics"
3. Verify:
   - Trace ID displayed
   - Copy Trace button works
   - Events timeline shows all events
   - Metadata expandable
   - Events ordered chronologically

---

## Verification Checklist

- [ ] `get-instructor-context` Edge Function deployed and accessible
- [ ] `ingest-inbound` includes trace_id in task metadata
- [ ] Database schema updated (conversation_events table exists)
- [ ] Make scenario configured and active
- [ ] Make scenario stops on `handoff_to_human = true`
- [ ] Diagnostics page loads and displays events
- [ ] Copy Trace button works
- [ ] End-to-end flow works (Landing → Orchestrator → Make → Landing)
- [ ] All events include trace_id
- [ ] No infrastructure changes required (using existing Supabase/Make)

---

## Troubleshooting

### Make scenario not triggering
- Check Supabase webhook configuration
- Verify task is created with correct `task_type` and `status`
- Check Make scenario logs

### get-instructor-context returns 401
- Verify `FD_INGEST_KEY` matches in Make and Edge Function
- Check `x-fd-ingest-key` header is sent

### Diagnostics page shows no events
- Verify `conversation_events` table exists
- Check RLS policies allow read access
- Verify events are being logged

### trace_id not propagating
- Check all components include trace_id in requests
- Verify `x-request-id` header is set
- Check task metadata includes trace_id
