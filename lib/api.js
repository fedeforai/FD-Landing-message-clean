// API client for FrostDesk Landing

import { generateUUID } from "./utils";
import { saveTraceIdForDebug } from "./storage";

const INGEST_ENDPOINT = "/api/ingest";

// Message constraints
const MAX_MESSAGE_LENGTH = 5000; // Per system contract

/**
 * Track telemetry event (minimal, for debugging)
 * @param {string} event - Event name
 * @param {Object} data - Event data
 */
function trackTelemetry(event, data = {}) {
  // Minimal telemetry - only log to console in development
  if (process.env.NODE_ENV === 'development') {
    console.log(`[Telemetry] ${event}`, data);
  }
  // In production, could send to analytics service
}

// Retry configuration
const MAX_RETRIES = 3;
const INITIAL_BACKOFF_MS = 500; // Start with 500ms
const MAX_BACKOFF_MS = 10000; // Max 10 seconds

/**
 * Calculate exponential backoff delay with jitter
 * @param {number} attempt - Current attempt number (0-indexed)
 * @returns {number} Delay in milliseconds
 */
function calculateBackoff(attempt) {
  const exponentialDelay = INITIAL_BACKOFF_MS * Math.pow(2, attempt);
  const jitter = Math.random() * 0.3 * exponentialDelay; // Add up to 30% jitter
  return Math.min(exponentialDelay + jitter, MAX_BACKOFF_MS);
}

/**
 * Get user-friendly error message based on HTTP status
 * @param {number} status - HTTP status code
 * @param {string} defaultMessage - Default error message
 * @returns {string} User-friendly error message
 */
function getErrorMessage(status, defaultMessage) {
  if (status === 401) {
    return "Authentication failed. Please refresh the page and try again.";
  }
  if (status === 429) {
    return "Too many requests. Please wait a moment and try again.";
  }
  if (status >= 500) {
    return "Server error. Please try again in a moment.";
  }
  if (status === 504) {
    return "Request timeout. The server took too long to respond. Please try again.";
  }
  return defaultMessage || "An error occurred. Please try again.";
}

/**
 * Send a chat message to the Orchestrator via /api/ingest with retry logic
 * @param {Object} params
 * @param {string} params.external_thread_id - Thread ID from localStorage
 * @param {string} params.instructor_id - Selected instructor UUID
 * @param {string} params.text - Message text
 * @param {string} params.idempotency_key - Idempotency key for deduplication
 * @param {string} params.trace_id - Trace ID (UUID v4)
 * @param {string} params.external_message_id - External message ID (UUID v4)
 * @param {number} params.submit_time - Timestamp when form was first rendered (for anti-spam)
 * @param {string} params.honeypot - Honeypot field value (should be empty)
 * @returns {Promise<{replyText: string | null, ok: boolean, error?: string, statusCode?: number, trace_id?: string, conversation_id?: string, message_id?: string, error_code?: string}>}
 */
export async function sendChatMessage({ 
  external_thread_id, 
  instructor_id, 
  text, 
  idempotency_key,
  trace_id,
  external_message_id,
  submit_time,
  honeypot,
}) {
  // ✅ Genera trace_id se manca (UUID v4 lato client)
  const finalTraceId = trace_id || generateUUID();
  
  // ✅ Salva trace_id per debug
  saveTraceIdForDebug(finalTraceId);

  // Validate message length
  if (text.length > MAX_MESSAGE_LENGTH) {
    return {
      ok: false,
      error: `Message too long. Maximum ${MAX_MESSAGE_LENGTH} characters allowed.`,
      error_code: 'MESSAGE_TOO_LONG',
      trace_id: finalTraceId,
    };
  }

  const payload = {
    channel: "landing",
    external_thread_id,
    instructor_id,
    text,
    idempotency_key,
    trace_id: finalTraceId, // ✅ Sempre presente
    external_message_id,
    submit_time,
    honeypot,
  };

  trackTelemetry('message_send_start', { 
    external_thread_id, 
    instructor_id, 
    has_idempotency_key: !!idempotency_key,
    trace_id: finalTraceId, // ✅ Usa finalTraceId
  });

  let lastError = null;
  let lastStatusCode = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(INGEST_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      const contentType = res.headers.get("content-type") || "";
      let data = null;

      if (contentType.includes("application/json")) {
        data = await res.json().catch(() => ({}));
      } else {
        const text = await res.text();
        data = { ok: res.ok, raw: text };
      }

      // Success case
      if (res.ok) {
        trackTelemetry('message_send_success', { 
          external_thread_id, 
          trace_id: data?.trace_id,
          conversation_id: data?.conversation_id,
          message_id: data?.message_id,
          has_reply: !!data?.replyText
        });
        return {
          ok: true,
          replyText: data?.replyText ?? null,
          trace_id: data?.trace_id,
          conversation_id: data?.conversation_id,
          message_id: data?.message_id,
          data,
        };
      }

      lastStatusCode = res.status;
      lastError = data?.error || data?.raw || `HTTP ${res.status}`;

      trackTelemetry('message_send_error', { 
        external_thread_id, 
        status: res.status, 
        error: lastError,
        trace_id: data?.trace_id || finalTraceId,
        attempt: attempt + 1
      });

      // Don't retry on 4xx errors (except 429 which we retry)
      if (res.status >= 400 && res.status < 500 && res.status !== 429) {
        return {
          ok: false,
          replyText: null,
          error: getErrorMessage(res.status, lastError),
          statusCode: res.status,
          trace_id: data?.trace_id || finalTraceId,
        };
      }

      // For 429 and 5xx, retry if we have attempts left
      if (attempt < MAX_RETRIES) {
        const backoff = calculateBackoff(attempt);
        await new Promise((resolve) => setTimeout(resolve, backoff));
        continue;
      }

      // Out of retries
      return {
        ok: false,
        replyText: null,
        error: getErrorMessage(res.status, lastError),
        statusCode: res.status,
        trace_id: finalTraceId,
      };
    } catch (err) {
      lastError = err?.message || "Network error";

      // Don't retry on certain network errors
      if (err.name === "AbortError" || err.name === "TypeError") {
        // Only retry if we haven't exhausted attempts
        if (attempt < MAX_RETRIES) {
          const backoff = calculateBackoff(attempt);
          await new Promise((resolve) => setTimeout(resolve, backoff));
          continue;
        }
      }

      // If this is the last attempt, return error
      if (attempt === MAX_RETRIES) {
        trackTelemetry('message_send_failed', { 
          external_thread_id, 
          error: lastError,
          trace_id: finalTraceId,
          attempts: attempt + 1
        });
        return {
          ok: false,
          replyText: null,
          error: "Network error. Please check your connection and try again.",
          trace_id: finalTraceId,
        };
      }

      // Otherwise, wait and retry
      const backoff = calculateBackoff(attempt);
      await new Promise((resolve) => setTimeout(resolve, backoff));
    }
  }

  // Fallback (shouldn't reach here, but TypeScript/JS safety)
  return {
    ok: false,
    replyText: null,
    error: getErrorMessage(lastStatusCode || 500, lastError || "Unknown error"),
    statusCode: lastStatusCode,
  };
}

/**
 * Track an event (select_instructor, cta_click) to the Orchestrator
 * Fire-and-forget with basic retry (1 attempt only)
 * @param {Object} params
 * @param {string} params.external_thread_id - Thread ID
 * @param {string} params.instructor_id - Instructor UUID
 * @param {string} params.intent - Event type (select_instructor, cta_click)
 * @param {Object} params.metadata - Optional metadata
 */
export async function trackEvent({ external_thread_id, instructor_id, intent, metadata = {} }) {
  const payload = {
    channel: "webchat",
    external_thread_id,
    instructor_id,
    text: intent, // Use intent as text for event tracking
    metadata: {
      intent,
      ...metadata,
    },
  };

  try {
    const res = await fetch(INGEST_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    // If failed, try once more after a short delay
    if (!res.ok && res.status !== 429) {
      await new Promise((resolve) => setTimeout(resolve, 200));
      await fetch(INGEST_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });
    }
    // Fire and forget - don't block on tracking
  } catch (err) {
    console.warn("Event tracking failed:", err);
  }
}

/**
 * Fetch instructors list
 * @returns {Promise<Array>}
 */
export async function fetchInstructors() {
  try {
    const res = await fetch("/api/instructors");
    const data = await res.json();

    if (!res.ok || !data.ok) {
      throw new Error(data?.error || `HTTP ${res.status}`);
    }

    return data.data || [];
  } catch (err) {
    console.error("Failed to fetch instructors:", err);
    return [];
  }
}

/**
 * Fetch a single instructor by ID
 * @param {string} instructorId
 * @returns {Promise<Object | null>}
 */
export async function fetchInstructor(instructorId) {
  try {
    const res = await fetch(`/api/instructors?id=${encodeURIComponent(instructorId)}`);
    const data = await res.json();

    if (!res.ok || !data.ok) {
      return null;
    }

    return data.data || null;
  } catch (err) {
    console.error("Failed to fetch instructor:", err);
    return null;
  }
}
