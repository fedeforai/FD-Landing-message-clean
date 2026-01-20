// File: supabase/functions/ingest-inbound/index.ts
// Repo: Orchestrator (Supabase Edge Functions)
// UPDATE: Add trace_id to task metadata when creating tasks

// ... existing code ...

// When creating task for Make, include trace_id in metadata
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
      // ... other existing metadata fields
    },
  })
  .select()
  .single();

// ... existing code ...

// Also log event with trace_id
await supabase.from("conversation_events").insert({
  conversation_id: conversation.id,
  event_type: "task_created",
  metadata: {
    trace_id: traceId,
    task_id: task.id,
    task_type: "ai_reply",
  },
});

// ... existing code ...
