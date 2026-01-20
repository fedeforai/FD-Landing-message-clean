// pages/api/ingest-lead.ts
// Lead capture form proxy to Supabase Edge Function ingest-inbound

import type { NextApiRequest, NextApiResponse } from "next";

const ORCH_URL = process.env.ORCH_URL;
const FD_INGEST_KEY = process.env.FD_INGEST_KEY;
const REQUEST_TIMEOUT = 30 * 1000; // 30 seconds
const MIN_SUBMIT_TIME = 2000; // 2 seconds minimum between form render and submit

// Generate UUID v4 for trace_id
function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

// Extract client IP from request headers (Vercel-compatible)
function getClientIP(req: NextApiRequest): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded && typeof forwarded === 'string') {
    return forwarded.split(',')[0].trim();
  }
  const realIP = req.headers['x-real-ip'];
  if (realIP && typeof realIP === 'string') {
    return realIP;
  }
  return req.socket?.remoteAddress || 'unknown';
}

interface LeadFormPayload {
  name: string;
  email: string;
  message: string;
  instructor_id?: string;
  instructor_slug?: string;
  channel?: string;
  honeypot?: string;
  submit_time?: number;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Generate trace_id (UUID v4)
  const traceId = generateUUID();

  // Only accept POST
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({
      ok: false,
      error: "Method not allowed",
      trace_id: traceId,
    });
  }

  // Check environment variables
  if (!ORCH_URL) {
    console.error("[ERROR] Missing ORCH_URL environment variable");
    return res.status(500).json({
      ok: false,
      error: "Server configuration error",
      trace_id: traceId,
    });
  }

  if (!FD_INGEST_KEY) {
    console.error("[ERROR] Missing FD_INGEST_KEY environment variable");
    return res.status(500).json({
      ok: false,
      error: "Server configuration error",
      trace_id: traceId,
    });
  }

  // Parse and validate request body
  const body = req.body as LeadFormPayload;
  const { name, email, message, instructor_id, instructor_slug, honeypot, submit_time } = body;

  // Anti-spam: Honeypot check
  if (honeypot && honeypot.trim().length > 0) {
    // Honeypot filled - likely bot, silently reject
    console.warn("[SPAM] Honeypot field filled", { trace_id: traceId, ip: getClientIP(req) });
    return res.status(200).json({
      ok: true,
      trace_id: traceId,
      message: "Thank you for your message.",
    });
  }

  // Anti-spam: Minimum submit time check
  if (submit_time && typeof submit_time === 'number') {
    const timeSinceRender = Date.now() - submit_time;
    if (timeSinceRender < MIN_SUBMIT_TIME) {
      // Submit too fast - likely bot, silently reject
      console.warn("[SPAM] Submit time too fast", { trace_id: traceId, timeSinceRender, ip: getClientIP(req) });
      return res.status(200).json({
        ok: true,
        trace_id: traceId,
        message: "Thank you for your message.",
      });
    }
  }

  // Validate required fields
  if (!name || typeof name !== 'string' || name.trim().length === 0) {
    return res.status(400).json({
      ok: false,
      error: "Name is required",
      trace_id: traceId,
    });
  }

  if (!email || typeof email !== 'string' || email.trim().length === 0) {
    return res.status(400).json({
      ok: false,
      error: "Email is required",
      trace_id: traceId,
    });
  }

  // Basic email validation
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email.trim())) {
    return res.status(400).json({
      ok: false,
      error: "Invalid email format",
      trace_id: traceId,
    });
  }

  if (!message || typeof message !== 'string' || message.trim().length === 0) {
    return res.status(400).json({
      ok: false,
      error: "Message is required",
      trace_id: traceId,
    });
  }

  // Validate message length (max 5000 chars)
  if (message.length > 5000) {
    return res.status(400).json({
      ok: false,
      error: "Message too long. Maximum 5000 characters allowed.",
      trace_id: traceId,
    });
  }

  // Validate instructor_id or instructor_slug provided
  if (!instructor_id && !instructor_slug) {
    return res.status(400).json({
      ok: false,
      error: "Either instructor_id or instructor_slug is required",
      trace_id: traceId,
    });
  }

  // If instructor_slug provided, we need to resolve it to instructor_id
  // For now, we'll pass slug to orchestrator and let it resolve
  // Alternatively, you could query instructors table here

  // Prepare payload for ingest-inbound Edge Function
  const ingestPayload = {
    channel: body.channel || "webchat",
    external_thread_id: `lead-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`,
    text: `Name: ${name.trim()}\nEmail: ${email.trim()}\n\nMessage:\n${message.trim()}`,
    instructor_id: instructor_id || undefined,
    instructor_slug: instructor_slug || undefined,
    trace_id: traceId,
    external_message_id: `lead_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`,
    channel_metadata: {
      source: "lead_form",
      client_name: name.trim(),
      email: email.trim(),
      submit_time: submit_time || Date.now(),
    },
  };

  // Create AbortController for timeout
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

  try {
    // Call Supabase Edge Function: ingest-inbound
    const edgeFunctionUrl = `${ORCH_URL.replace(/\/$/, "")}/functions/v1/ingest-inbound`;

    const upstreamRes = await fetch(edgeFunctionUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-fd-ingest-key": FD_INGEST_KEY,
        "x-request-id": traceId, // Include trace_id as request ID header
      },
      body: JSON.stringify(ingestPayload),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    const contentType = upstreamRes.headers.get("content-type") || "";
    let parsed: any = null;

    if (contentType.includes("application/json")) {
      try {
        const text = await upstreamRes.text();
        parsed = JSON.parse(text);
      } catch (err) {
        console.error("[ERROR] Failed to parse upstream response", { trace_id: traceId, error: err });
        return res.status(502).json({
          ok: false,
          error: "Invalid response from server",
          trace_id: traceId,
        });
      }
    }

    // Return simplified response
    if (upstreamRes.ok && parsed) {
      return res.status(200).json({
        ok: true,
        trace_id: parsed.trace_id || traceId,
        conversation_id: parsed.conversation_id || null,
      });
    }

    // Error response
    return res.status(upstreamRes.status).json({
      ok: false,
      error: parsed?.error || `HTTP ${upstreamRes.status}`,
      trace_id: parsed?.trace_id || traceId,
    });
  } catch (err: any) {
    clearTimeout(timeoutId);

    if (err.name === 'AbortError') {
      console.error("[ERROR] Request timeout", { trace_id: traceId });
      return res.status(504).json({
        ok: false,
        error: "Request timeout. Please try again.",
        trace_id: traceId,
      });
    }

    console.error("[ERROR] Failed to reach orchestrator", { trace_id: traceId, error: err });
    return res.status(502).json({
      ok: false,
      error: err?.message || "Failed to reach server",
      trace_id: traceId,
    });
  }
}
