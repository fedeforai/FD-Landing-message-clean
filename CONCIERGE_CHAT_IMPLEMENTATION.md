# FrostDesk Concierge Chat - System-Wide Implementation

## Overview

Complete implementation for system-wide trace_id propagation and concierge chat flow across Landing, Orchestrator, Make, and Main App.

## Architecture Flow

```
Landing → Orchestrator (ingest-inbound) → Create Task → Make Scenario
                                                          ↓
                                    get-instructor-context ← Make calls Edge Function
                                                          ↓
                                    OpenAI JSON Strict Mode
                                                          ↓
                                    ingest-inbound (reply) ← Make sends reply
                                                          ↓
                                    Optional: Google Calendar action
                                                          ↓
                                    Hard stop if handoff_to_human = true
```

---

## REPO 1: Orchestrator (Supabase Edge Functions)

### File: `supabase/functions/get-instructor-context/index.ts`

```typescript
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-fd-ingest-key, x-request-id",
};

interface ConciergeContext {
  instructor_id: string;
  instructor_name: string;
  instructor_bio: string | null;
  instructor_photo_url: string | null;
  instructor_whatsapp_number: string | null;
  conversation_id: string;
  conversation_state: "open" | "handed_off" | "resolved";
  handoff_to_human: boolean;
  last_message_text: string | null;
  last_message_role: "user" | "assistant" | "instructor" | "system";
  message_count: number;
  policy_documents: Array<{
    doc_id: string;
    title: string;
    version: number;
    chunks: Array<{
      chunk_id: string;
      content: string;
      metadata: Record<string, unknown>;
    }>;
  }>;
  trace_id: string;
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // Get trace_id from header or generate
    const traceId = req.headers.get("x-request-id") || `trc_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;

    // Authenticate
    const ingestKey = req.headers.get("x-fd-ingest-key");
    const expectedKey = Deno.env.get("FD_INGEST_KEY");
    
    if (!ingestKey || ingestKey !== expectedKey) {
      return new Response(
        JSON.stringify({ ok: false, error: "Unauthorized", trace_id: traceId }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Parse request body
    const { conversation_id, instructor_id } = await req.json();

    if (!conversation_id || !instructor_id) {
      return new Response(
        JSON.stringify({ ok: false, error: "Missing conversation_id or instructor_id", trace_id: traceId }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Initialize Supabase client
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Fetch instructor data
    const { data: instructor, error: instructorError } = await supabase
      .from("instructors")
      .select("id, name, bio, photo_url, whatsapp_number")
      .eq("id", instructor_id)
      .single();

    if (instructorError || !instructor) {
      return new Response(
        JSON.stringify({ ok: false, error: "Instructor not found", trace_id: traceId }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Fetch conversation data
    const { data: conversation, error: convError } = await supabase
      .from("conversation_threads")
      .select("id, state, handoff_to_human")
      .eq("id", conversation_id)
      .single();

    if (convError || !conversation) {
      return new Response(
        JSON.stringify({ ok: false, error: "Conversation not found", trace_id: traceId }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // HARD STOP: If handoff_to_human = true, return early
    if (conversation.handoff_to_human === true) {
      return new Response(
        JSON.stringify({
          ok: true,
          concierge_context: {
            instructor_id: instructor.id,
            instructor_name: instructor.name,
            instructor_bio: instructor.bio,
            instructor_photo_url: instructor.photo_url,
            instructor_whatsapp_number: instructor.whatsapp_number,
            conversation_id: conversation.id,
            conversation_state: conversation.state,
            handoff_to_human: true,
            last_message_text: null,
            last_message_role: "system",
            message_count: 0,
            policy_documents: [],
            trace_id: traceId,
          },
          handoff_to_human: true,
          message: "Conversation handed off to human. No AI replies.",
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Fetch last message
    const { data: lastMessage } = await supabase
      .from("conversation_messages")
      .select("text, role")
      .eq("conversation_id", conversation_id)
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    // Count messages
    const { count: messageCount } = await supabase
      .from("conversation_messages")
      .select("*", { count: "exact", head: true })
      .eq("conversation_id", conversation_id);

    // Fetch policy documents for this instructor
    const { data: policyDocs } = await supabase
      .from("policy_docs")
      .select(`
        id,
        title,
        version,
        policy_chunks (
          id,
          content,
          metadata
        )
      `)
      .eq("instructor_id", instructor_id)
      .eq("is_active", true)
      .order("created_at", { ascending: false });

    // Build concierge_context object
    const conciergeContext: ConciergeContext = {
      instructor_id: instructor.id,
      instructor_name: instructor.name,
      instructor_bio: instructor.bio,
      instructor_photo_url: instructor.photo_url,
      instructor_whatsapp_number: instructor.whatsapp_number,
      conversation_id: conversation.id,
      conversation_state: conversation.state as "open" | "handed_off" | "resolved",
      handoff_to_human: conversation.handoff_to_human || false,
      last_message_text: lastMessage?.text || null,
      last_message_role: lastMessage?.role || "system",
      message_count: messageCount || 0,
      policy_documents: (policyDocs || []).map((doc) => ({
        doc_id: doc.id,
        title: doc.title,
        version: doc.version,
        chunks: (doc.policy_chunks || []).map((chunk: any) => ({
          chunk_id: chunk.id,
          content: chunk.content,
          metadata: chunk.metadata || {},
        })),
      })),
      trace_id: traceId,
    };

    // Log event
    await supabase.from("conversation_events").insert({
      conversation_id: conversation.id,
      event_type: "get_instructor_context",
      metadata: { trace_id: traceId },
    });

    return new Response(
      JSON.stringify({
        ok: true,
        concierge_context: conciergeContext,
        trace_id: traceId,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    const traceId = req.headers.get("x-request-id") || `trc_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
    return new Response(
      JSON.stringify({
        ok: false,
        error: error.message || "Internal server error",
        trace_id: traceId,
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
```

### File: `supabase/functions/ingest-inbound/index.ts` (Update)

Add trace_id propagation to task creation:

```typescript
// ... existing code ...

// When creating task for Make, include trace_id
const { data: task, error: taskError } = await supabase
  .from("tasks")
  .insert({
    conversation_id: conversation.id,
    task_type: "ai_reply",
    status: "pending",
    metadata: {
      trace_id: traceId, // ✅ Include trace_id in task metadata
      external_thread_id: external_thread_id,
      instructor_id: instructor_id,
    },
  })
  .select()
  .single();

// ... existing code ...
```

---

## REPO 2: Make Scenario

### Make Scenario Flow

**Trigger:** Database webhook on `tasks` table insert (where `task_type = 'ai_reply'`)

**Modules:**

1. **Webhook Trigger** (Supabase)
   - Table: `tasks`
   - Event: Insert
   - Filter: `task_type = 'ai_reply'` AND `status = 'pending'`

2. **Get Instructor Context** (HTTP Request)
   ```
   POST https://{supabase-project}.supabase.co/functions/v1/get-instructor-context
   Headers:
     x-fd-ingest-key: {FD_INGEST_KEY}
     x-request-id: {trace_id from task.metadata}
   Body:
     {
       "conversation_id": "{task.conversation_id}",
       "instructor_id": "{task.metadata.instructor_id}"
     }
   ```

3. **Check Handoff** (Router)
   - If `response.concierge_context.handoff_to_human === true` → **STOP** (end scenario)
   - Otherwise → Continue

4. **OpenAI JSON Strict Mode** (OpenAI)
   ```
   Model: gpt-4-turbo-preview (or gpt-4o)
   Response Format: JSON Schema
   System Prompt: (see below)
   User Message: {concierge_context.last_message_text}
   ```

5. **Parse JSON Response** (JSON Parser)
   - Extract: `reply_text`, `suggested_actions`, `confidence_score`

6. **Send Reply via ingest-inbound** (HTTP Request)
   ```
   POST https://{supabase-project}.supabase.co/functions/v1/ingest-inbound
   Headers:
     x-fd-ingest-key: {FD_INGEST_KEY}
     x-request-id: {trace_id}
   Body:
     {
       "channel": "landing",
       "external_thread_id": "{concierge_context.external_thread_id}",
       "instructor_id": "{concierge_context.instructor_id}",
       "text": "{reply_text}",
       "trace_id": "{trace_id}",
       "external_message_id": "make_reply_{timestamp}_{random}",
       "metadata": {
         "source": "make_ai_reply",
         "confidence_score": "{confidence_score}",
         "suggested_actions": "{suggested_actions}"
       }
     }
   ```

7. **Optional: Google Calendar Action** (Conditional)
   - If `suggested_actions` contains `"book_lesson"` → Create calendar event

8. **Update Task Status** (Supabase Update)
   ```
   UPDATE tasks
   SET status = 'completed',
       metadata = metadata || { "completed_at": "{now}", "reply_sent": true }
   WHERE id = {task.id}
   ```

### OpenAI System Prompt (JSON Strict Mode)

```json
{
  "system_prompt": "You are a concierge AI assistant for FrostDesk, helping potential students book lessons with instructors. Use the provided instructor context and policy documents to answer questions accurately. Always respond in JSON format with the following schema:\n\n{\n  \"reply_text\": string (required, max 500 chars),\n  \"confidence_score\": number (0-1, required),\n  \"suggested_actions\": array of strings (optional, e.g. [\"book_lesson\", \"ask_availability\"]),\n  \"handoff_reason\": string (optional, only if confidence_score < 0.5 or user requests human)\n}\n\nIf confidence_score < 0.5 or user explicitly requests human, set handoff_reason.",
  "response_format": {
    "type": "json_schema",
    "json_schema": {
      "name": "concierge_reply",
      "strict": true,
      "schema": {
        "type": "object",
        "properties": {
          "reply_text": {
            "type": "string",
            "maxLength": 500
          },
          "confidence_score": {
            "type": "number",
            "minimum": 0,
            "maximum": 1
          },
          "suggested_actions": {
            "type": "array",
            "items": {
              "type": "string"
            }
          },
          "handoff_reason": {
            "type": "string"
          }
        },
        "required": ["reply_text", "confidence_score"]
      }
    }
  }
}
```

### Make Scenario Error Handling

- If `get-instructor-context` fails → Log error, update task status to `failed`
- If OpenAI fails → Log error, update task status to `failed`
- If `ingest-inbound` fails → Retry up to 3 times, then mark task as `failed`
- Always log `trace_id` in error metadata

---

## REPO 3: Main App (Diagnostics UI)

### File: `app/conversations/[id]/diagnostics/page.tsx`

```tsx
"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { createClient } from "@supabase/supabase-js";

interface Event {
  id: string;
  event_type: string;
  created_at: string;
  metadata: Record<string, unknown>;
}

export default function DiagnosticsPage() {
  const params = useParams();
  const conversationId = params.id as string;
  const [events, setEvents] = useState<Event[]>([]);
  const [traceId, setTraceId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadDiagnostics() {
      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
      const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
      const supabase = createClient(supabaseUrl, supabaseKey);

      // Fetch conversation events
      const { data: eventsData } = await supabase
        .from("conversation_events")
        .select("*")
        .eq("conversation_id", conversationId)
        .order("created_at", { ascending: true });

      setEvents(eventsData || []);

      // Extract trace_id from events
      const firstTraceId = eventsData?.find((e) => e.metadata?.trace_id)?.metadata
        ?.trace_id as string;
      if (firstTraceId) {
        setTraceId(firstTraceId);
      }

      setLoading(false);
    }

    if (conversationId) {
      loadDiagnostics();
    }
  }, [conversationId]);

  function copyTraceId() {
    if (traceId) {
      navigator.clipboard.writeText(traceId);
      alert("Trace ID copied to clipboard!");
    }
  }

  if (loading) {
    return <div>Loading diagnostics...</div>;
  }

  return (
    <div className="container mx-auto p-6">
      <h1 className="text-2xl font-bold mb-4">Conversation Diagnostics</h1>
      
      {/* Trace ID Section */}
      {traceId && (
        <div className="mb-6 p-4 bg-gray-100 rounded">
          <div className="flex items-center gap-4">
            <div>
              <label className="text-sm font-semibold">Trace ID:</label>
              <code className="block mt-1 font-mono text-sm">{traceId}</code>
            </div>
            <button
              onClick={copyTraceId}
              className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
            >
              Copy Trace
            </button>
          </div>
        </div>
      )}

      {/* Events Timeline */}
      <div className="space-y-4">
        <h2 className="text-xl font-semibold">Events Timeline</h2>
        {events.length === 0 ? (
          <p className="text-gray-500">No events found for this conversation.</p>
        ) : (
          <div className="space-y-2">
            {events.map((event) => (
              <div
                key={event.id}
                className="p-4 border rounded-lg hover:bg-gray-50"
              >
                <div className="flex justify-between items-start">
                  <div>
                    <div className="font-semibold">{event.event_type}</div>
                    <div className="text-sm text-gray-500">
                      {new Date(event.created_at).toLocaleString()}
                    </div>
                  </div>
                  {event.metadata?.trace_id && (
                    <code className="text-xs text-gray-400">
                      {event.metadata.trace_id as string}
                    </code>
                  )}
                </div>
                {Object.keys(event.metadata || {}).length > 0 && (
                  <details className="mt-2">
                    <summary className="text-sm cursor-pointer text-blue-600">
                      View Metadata
                    </summary>
                    <pre className="mt-2 text-xs bg-gray-100 p-2 rounded overflow-auto">
                      {JSON.stringify(event.metadata, null, 2)}
                    </pre>
                  </details>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
```

### File: `app/conversations/[id]/page.tsx` (Add Diagnostics Link)

```tsx
// Add to existing conversation detail page
<Link
  href={`/conversations/${conversationId}/diagnostics`}
  className="text-blue-600 hover:underline"
>
  View Diagnostics
</Link>
```

---

## REPO 4: Landing (Already Implemented)

No changes needed. Landing already:
- ✅ Generates trace_id (prefix "trc_")
- ✅ Propagates trace_id to ingest-inbound
- ✅ Includes trace_id in all requests

---

## Environment Variables

### Orchestrator (Supabase Edge Functions)

```bash
FD_INGEST_KEY=your-secret-key
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
```

### Make Scenario

```bash
FD_INGEST_KEY=your-secret-key (in Make environment variables)
SUPABASE_URL=https://your-project.supabase.co
OPENAI_API_KEY=your-openai-key
GOOGLE_CALENDAR_CLIENT_ID=your-client-id (optional)
GOOGLE_CALENDAR_CLIENT_SECRET=your-client-secret (optional)
```

### Main App

```bash
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
```

---

## Database Schema Requirements

### `conversation_events` table

```sql
CREATE TABLE IF NOT EXISTS conversation_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES conversation_threads(id),
  event_type TEXT NOT NULL,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_conversation_events_conversation_id ON conversation_events(conversation_id);
CREATE INDEX idx_conversation_events_created_at ON conversation_events(created_at);
```

### `tasks` table (update metadata column)

```sql
-- Ensure metadata column supports trace_id
ALTER TABLE tasks 
ALTER COLUMN metadata TYPE JSONB USING metadata::jsonb;
```

---

## Testing Checklist

### Orchestrator

- [ ] `get-instructor-context` returns correct concierge_context
- [ ] Hard stop when `handoff_to_human = true`
- [ ] trace_id propagated in all events
- [ ] Policy documents included in context

### Make Scenario

- [ ] Triggers on task creation
- [ ] Calls `get-instructor-context` correctly
- [ ] Stops when `handoff_to_human = true`
- [ ] OpenAI JSON strict mode works
- [ ] Reply sent via `ingest-inbound` with trace_id
- [ ] Task status updated correctly

### Main App

- [ ] Diagnostics page loads events
- [ ] Trace ID displayed and copyable
- [ ] Timeline shows all events chronologically
- [ ] Metadata expandable

### End-to-End

- [ ] Landing sends message with trace_id
- [ ] Orchestrator creates task with trace_id
- [ ] Make processes task and sends reply
- [ ] Reply appears in Landing chat
- [ ] Diagnostics UI shows full trace

---

## Summary

✅ **System-wide trace_id propagation** - All components pass trace_id  
✅ **get-instructor-context Edge Function** - Returns concierge_context object  
✅ **Make scenario flow** - Trigger → Context → OpenAI → Reply → Optional Calendar  
✅ **Hard stop on handoff_to_human** - No AI replies when true  
✅ **Diagnostics UI** - Events timeline and Copy trace functionality  

All implementations use existing infrastructure with minimal changes.
