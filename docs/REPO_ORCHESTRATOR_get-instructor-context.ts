// File: supabase/functions/get-instructor-context/index.ts
// Repo: Orchestrator (Supabase Edge Functions)

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
