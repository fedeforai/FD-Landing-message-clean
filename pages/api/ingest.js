// In-memory rate limiting store
// Map<IP, Array<Timestamp>>
const rateLimitStore = new Map();
let requestCount = 0;
const CLEANUP_INTERVAL = 100; // Clean up every 100 requests
const RATE_LIMIT_WINDOW = 60 * 1000; // 60 seconds in milliseconds
const RATE_LIMIT_MAX_REQUESTS = 10; // 10 requests per window
const REQUEST_TIMEOUT = 30 * 1000; // 30 seconds

// Message constraints
const MAX_MESSAGE_LENGTH = 5000; // Per system contract
const MIN_SUBMIT_TIME = 2000; // 2 seconds minimum between form render and submit

// Generate trace_id with prefix "trc_"
function generateTraceId() {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 15);
  return `trc_${timestamp}_${random}`;
}

// Generate external_message_id with prefix "landing_"
function generateExternalMessageId() {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 15);
  return `landing_${timestamp}_${random}`;
}

// Extract client IP from request headers (Vercel-compatible)
function getClientIP(req) {
  // Vercel provides x-forwarded-for or x-real-ip
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    // x-forwarded-for can contain multiple IPs, take the first one
    return forwarded.split(',')[0].trim();
  }
  const realIP = req.headers['x-real-ip'];
  if (realIP) {
    return realIP;
  }
  // Fallback to connection remote address
  return req.socket?.remoteAddress || 'unknown';
}

// Clean up expired entries from rate limit store
function cleanupRateLimitStore() {
  const now = Date.now();
  for (const [ip, timestamps] of rateLimitStore.entries()) {
    const validTimestamps = timestamps.filter(ts => now - ts < RATE_LIMIT_WINDOW);
    if (validTimestamps.length === 0) {
      rateLimitStore.delete(ip);
    } else {
      rateLimitStore.set(ip, validTimestamps);
    }
  }
}

// Check rate limit for an IP
function checkRateLimit(ip) {
  const now = Date.now();
  const timestamps = rateLimitStore.get(ip) || [];
  
  // Filter out timestamps older than the window
  const validTimestamps = timestamps.filter(ts => now - ts < RATE_LIMIT_WINDOW);
  
  if (validTimestamps.length >= RATE_LIMIT_MAX_REQUESTS) {
    // Calculate retry-after (time until oldest request expires)
    const oldestTimestamp = Math.min(...validTimestamps);
    const retryAfter = Math.ceil((RATE_LIMIT_WINDOW - (now - oldestTimestamp)) / 1000);
    return { allowed: false, retryAfter };
  }
  
  // Add current timestamp
  validTimestamps.push(now);
  rateLimitStore.set(ip, validTimestamps);
  
  return { allowed: true };
}

export default async function handler(req, res) {
  // Generate trace_id if missing (prefix "trc_")
  // If client provides trace_id, accept it; otherwise generate server-side
  const clientTraceId = req.body?.trace_id;
  const serverTraceId = generateTraceId();
  const traceId = clientTraceId || serverTraceId;

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ 
      ok: false, 
      error: "Method not allowed",
      trace_id: traceId,
      error_code: 'METHOD_NOT_ALLOWED',
    });
  }

  // Rate limiting
  const clientIP = getClientIP(req);
  const rateLimitCheck = checkRateLimit(clientIP);
  
  if (!rateLimitCheck.allowed) {
    res.setHeader('Retry-After', rateLimitCheck.retryAfter);
    return res.status(429).json({
      ok: false,
      error: 'Rate limit exceeded. Please try again later.',
      trace_id: traceId,
      error_code: 'RATE_LIMIT_EXCEEDED',
      retryAfter: rateLimitCheck.retryAfter,
    });
  }

  // Periodic cleanup
  requestCount++;
  if (requestCount >= CLEANUP_INTERVAL) {
    cleanupRateLimitStore();
    requestCount = 0;
  }

  // Get Supabase URL and ingest key (server-side only, never exposed to client)
  const supabaseUrl = process.env.SUPABASE_URL;
  if (!supabaseUrl) {
    return res.status(500).json({
      ok: false,
      error: "Missing SUPABASE_URL in environment",
      trace_id: traceId,
      error_code: 'MISSING_CONFIG',
    });
  }

  const fdIngestKey = process.env.FD_INGEST_KEY;
  if (!fdIngestKey) {
    return res.status(500).json({
      ok: false,
      error: "Missing FD_INGEST_KEY in environment",
      trace_id: traceId,
      error_code: 'MISSING_CONFIG',
    });
  }

  // Strict payload validation
  const body = req.body || {};
  const {
    channel,
    external_thread_id,
    instructor_id,
    text,
    idempotency_key,
    external_message_id: clientExternalMessageId,
    submit_time,
    honeypot,
  } = body;
  
  // Generate external_message_id if missing (prefix "landing_")
  const external_message_id = clientExternalMessageId || generateExternalMessageId();

  // Validate required fields
  if (!channel || channel !== 'landing') {
    return res.status(400).json({
      ok: false,
      error: "Invalid or missing channel. Must be 'landing'",
      trace_id: traceId,
      error_code: 'INVALID_CHANNEL',
    });
  }

  if (!external_thread_id || typeof external_thread_id !== 'string' || external_thread_id.length > 255) {
    return res.status(400).json({
      ok: false,
      error: "Invalid or missing external_thread_id",
      trace_id: traceId,
      error_code: 'INVALID_THREAD_ID',
    });
  }

  if (!instructor_id || typeof instructor_id !== 'string') {
    return res.status(400).json({
      ok: false,
      error: "Invalid or missing instructor_id",
      trace_id: traceId,
      error_code: 'INVALID_INSTRUCTOR_ID',
    });
  }

  if (!text || typeof text !== 'string' || text.trim().length === 0) {
    return res.status(400).json({
      ok: false,
      error: "Invalid or missing text",
      trace_id: traceId,
      error_code: 'INVALID_TEXT',
    });
  }

  if (text.length > MAX_MESSAGE_LENGTH) {
    return res.status(400).json({
      ok: false,
      error: `Message too long. Maximum ${MAX_MESSAGE_LENGTH} characters allowed.`,
      trace_id: traceId,
      error_code: 'MESSAGE_TOO_LONG',
    });
  }

  // Anti-spam: honeypot check
  if (honeypot && honeypot.trim().length > 0) {
    // Honeypot filled - likely bot, silently reject
    return res.status(200).json({
      ok: true,
      conversation_id: null,
      trace_id: traceId,
    });
  }

  // Anti-spam: minimum submit time check
  if (submit_time && typeof submit_time === 'number') {
    const timeSinceRender = Date.now() - submit_time;
    if (timeSinceRender < MIN_SUBMIT_TIME) {
      // Submit too fast - likely bot, silently reject
      return res.status(200).json({
        ok: true,
        conversation_id: null,
        trace_id: traceId,
      });
    }
  }

  // Prepare strict payload for Supabase Edge Function
  // trace_id: accetta quello del client se fornito, altrimenti usa quello generato server-side
  // external_message_id: sempre presente per idempotenza nei retry
  const payload = {
    channel: 'landing',
    external_thread_id: external_thread_id.trim(),
    instructor_id: instructor_id.trim(),
    text: text.trim(),
    idempotency_key: idempotency_key || null,
    trace_id: traceId, // Sempre presente (client o server-generated)
    external_message_id: external_message_id, // Sempre presente per idempotenza
  };

  // Import Sentry for error logging
  let Sentry;
  try {
    Sentry = require("@sentry/nextjs");
  } catch (e) {
    // Sentry not available, continue without it
  }

  // Retry configuration
  const MAX_RETRIES = 3;
  const INITIAL_BACKOFF_MS = 500;
  const MAX_BACKOFF_MS = 10000;

  function calculateBackoff(attempt) {
    const exponentialDelay = INITIAL_BACKOFF_MS * Math.pow(2, attempt);
    const jitter = Math.random() * 0.3 * exponentialDelay;
    return Math.min(exponentialDelay + jitter, MAX_BACKOFF_MS);
  }

  let lastError = null;
  let lastStatusCode = null;
  let lastResponse = null;

  // Implementa retry con idempotenza usando external_message_id
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    // Create AbortController for timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

    try {
      // Call Supabase Edge Function: /functions/v1/ingest-inbound
      const edgeFunctionUrl = `${supabaseUrl.replace(/\/$/, "")}/functions/v1/ingest-inbound`;
      
      // ✅ Verifica che trace_id sia sempre presente per x-request-id
      if (!traceId) {
        console.error('[ERROR] trace_id missing, cannot set x-request-id header');
      }

      const upstreamRes = await fetch(edgeFunctionUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-fd-ingest-key": fdIngestKey, // Server-side secret, never exposed to client
          "x-request-id": traceId, // ✅ Include trace_id as request ID header (sempre presente)
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      
      clearTimeout(timeoutId);

      const text = await upstreamRes.text();
      const contentType = upstreamRes.headers.get("content-type") || "";
      let parsed;
      if (contentType.includes("application/json")) {
        try {
          parsed = JSON.parse(text);
        } catch (err) {
          if (Sentry) {
            Sentry.captureException(err, {
              tags: { error_code: 'PARSE_ERROR' },
              extra: { trace_id: traceId, response_text: text.substring(0, 500), attempt },
            });
          }
          console.error("Unable to parse orchestrator response as JSON:", err);
        }
      }

      // Success case
      if (upstreamRes.ok && parsed) {
        // Log success to Sentry
        if (Sentry && attempt > 0) {
          Sentry.addBreadcrumb({
            category: 'retry',
            message: `Message sent successfully after ${attempt} retries`,
            level: 'info',
            data: {
              trace_id: traceId,
              external_message_id: external_message_id,
              attempt: attempt + 1,
            },
          });
        }

        // Return response: { ok: true, conversation_id, trace_id, replyText }
        return res.status(200).json({
          ok: true,
          conversation_id: parsed.conversation_id || null,
          trace_id: parsed.trace_id || traceId,
          replyText: parsed.replyText || null, // Include AI reply if available
          handoff_to_human: parsed.handoff_to_human || false, // Include handoff flag
        });
      }

      lastStatusCode = upstreamRes.status;
      lastError = parsed?.error || text || `HTTP ${upstreamRes.status}`;
      lastResponse = parsed;

      // Log error to Sentry
      if (Sentry) {
        Sentry.addBreadcrumb({
          category: 'retry',
          message: `Retry attempt ${attempt + 1} failed`,
          level: 'warning',
          data: {
            trace_id: traceId,
            external_message_id: external_message_id,
            status: upstreamRes.status,
            error: lastError,
            attempt: attempt + 1,
          },
        });
      }

      // Don't retry on 4xx errors (except 429) - these are client errors
      if (upstreamRes.status >= 400 && upstreamRes.status < 500 && upstreamRes.status !== 429) {
        // Not retryable, return error immediately
        return res.status(upstreamRes.status).json({
          ok: false,
          error: parsed?.error || lastError || `HTTP ${upstreamRes.status}`,
          trace_id: parsed?.trace_id || traceId,
          error_code: parsed?.error_code || 'CLIENT_ERROR',
        });
      }

      // Per 429 e 5xx, ritenta se abbiamo tentativi rimasti
      // external_message_id garantisce idempotenza (stesso messaggio non sarà duplicato)
      if (attempt < MAX_RETRIES) {
        const backoff = calculateBackoff(attempt);
        await new Promise((resolve) => setTimeout(resolve, backoff));
        continue; // Ritenta con stesso external_message_id
      }

      // Retries exhausted, return error
      if (parsed) {
        return res.status(upstreamRes.status).json({
          ok: false,
          error: parsed.error || lastError || `HTTP ${upstreamRes.status}`,
          trace_id: parsed.trace_id || traceId,
          error_code: parsed.error_code || 'UPSTREAM_ERROR',
        });
      }

      return res.status(upstreamRes.status).json({
        ok: false,
        error: lastError || `HTTP ${upstreamRes.status}`,
        trace_id: traceId,
        error_code: 'UPSTREAM_ERROR',
      });
    } catch (err) {
      clearTimeout(timeoutId);
      
      // Log to Sentry
      if (Sentry) {
        Sentry.addBreadcrumb({
          category: 'retry',
          message: `Retry attempt ${attempt + 1} exception`,
          level: 'error',
          data: {
            trace_id: traceId,
            external_message_id: external_message_id,
            error: err.message,
            attempt: attempt + 1,
          },
        });
      }

      // Handle timeout specifically
      if (err.name === 'AbortError') {
        // Timeout: ritenta se possibile, altrimenti ritorna errore
        if (attempt < MAX_RETRIES) {
          const backoff = calculateBackoff(attempt);
          await new Promise((resolve) => setTimeout(resolve, backoff));
          continue; // Ritenta con stesso external_message_id
        }

        // Timeout dopo tutti i retry
        if (Sentry) {
          Sentry.captureException(err, {
            tags: { error_code: 'TIMEOUT' },
            extra: { 
              trace_id: traceId,
              external_message_id: external_message_id,
              external_thread_id: payload.external_thread_id,
              instructor_id: payload.instructor_id,
              attempts: attempt + 1,
            },
          });
        }

        return res.status(504).json({
          ok: false,
          error: 'Request timeout. The orchestrator did not respond in time.',
          trace_id: traceId,
          error_code: 'TIMEOUT',
        });
      }
      
      // Altri errori di rete: ritenta se possibile
      if (attempt < MAX_RETRIES) {
        const backoff = calculateBackoff(attempt);
        await new Promise((resolve) => setTimeout(resolve, backoff));
        continue; // Ritenta con stesso external_message_id
      }

      // Retry esauriti per errori di rete
      if (Sentry) {
        Sentry.captureException(err, {
          tags: { error_code: 'NETWORK_ERROR' },
          extra: { 
            trace_id: traceId,
            external_message_id: external_message_id,
            external_thread_id: payload.external_thread_id,
            instructor_id: payload.instructor_id,
            attempts: attempt + 1,
          },
        });
      }

      console.error("Error proxying to orchestrator:", err);
      return res.status(502).json({
        ok: false,
        error: err && err.message ? err.message : "Failed to reach the orchestrator",
        trace_id: traceId,
        error_code: 'NETWORK_ERROR',
      });
    }
  }

  // Fallback (should never reach here)
  return res.status(500).json({
    ok: false,
    error: 'Unexpected error',
    trace_id: traceId,
    error_code: 'UNEXPECTED_ERROR',
  });
}
