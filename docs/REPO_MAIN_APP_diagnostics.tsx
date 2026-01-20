// File: app/conversations/[id]/diagnostics/page.tsx
// Repo: Main App

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
  const [copied, setCopied] = useState(false);

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

      // Extract trace_id from events (prefer first event with trace_id)
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

  async function copyTraceId() {
    if (traceId) {
      try {
        await navigator.clipboard.writeText(traceId);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch (err) {
        console.error("Failed to copy:", err);
      }
    }
  }

  if (loading) {
    return (
      <div className="container mx-auto p-6">
        <div className="text-center">Loading diagnostics...</div>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 max-w-4xl">
      <h1 className="text-2xl font-bold mb-6">Conversation Diagnostics</h1>
      
      {/* Trace ID Section */}
      {traceId && (
        <div className="mb-6 p-4 bg-gray-100 rounded-lg border">
          <div className="flex items-center gap-4">
            <div className="flex-1">
              <label className="text-sm font-semibold text-gray-700">Trace ID:</label>
              <code className="block mt-1 font-mono text-sm bg-white p-2 rounded border">
                {traceId}
              </code>
            </div>
            <button
              onClick={copyTraceId}
              className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 transition-colors"
            >
              {copied ? "Copied!" : "Copy Trace"}
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
            {events.map((event, index) => (
              <div
                key={event.id}
                className="p-4 border rounded-lg hover:bg-gray-50 transition-colors"
              >
                <div className="flex justify-between items-start">
                  <div className="flex-1">
                    <div className="font-semibold text-gray-900">{event.event_type}</div>
                    <div className="text-sm text-gray-500 mt-1">
                      {new Date(event.created_at).toLocaleString()}
                    </div>
                    {event.metadata?.trace_id && (
                      <div className="text-xs text-gray-400 mt-1">
                        Trace: <code>{event.metadata.trace_id as string}</code>
                      </div>
                    )}
                  </div>
                  <div className="text-xs text-gray-400">
                    #{index + 1}
                  </div>
                </div>
                {Object.keys(event.metadata || {}).length > 0 && (
                  <details className="mt-3">
                    <summary className="text-sm cursor-pointer text-blue-600 hover:text-blue-800">
                      View Metadata
                    </summary>
                    <pre className="mt-2 text-xs bg-gray-100 p-3 rounded overflow-auto border">
                      {JSON.stringify(event.metadata, null, 2)}
                    </pre>
                  </details>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Back Link */}
      <div className="mt-6">
        <a
          href={`/conversations/${conversationId}`}
          className="text-blue-600 hover:underline"
        >
          ← Back to Conversation
        </a>
      </div>
    </div>
  );
}
