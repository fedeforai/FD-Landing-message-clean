// localStorage utilities for FrostDesk Landing

const STORAGE_KEYS = {
  EXTERNAL_THREAD_ID: "frostdesk_external_thread_id",
  SELECTED_INSTRUCTOR_ID: "frostdesk_selected_instructor_id",
  TRACE_ID: "frostdesk_trace_id",
  CLIENT_NAME: "frostdesk_client_name",
  CLIENT_PHONE: "frostdesk_client_phone",
};

function safeLocalStorageGet(key) {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeLocalStorageSet(key, value) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // ignore
  }
}

function safeLocalStorageRemove(key) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(key);
  } catch {
    // ignore
  }
}

export function getExternalThreadId() {
  return safeLocalStorageGet(STORAGE_KEYS.EXTERNAL_THREAD_ID);
}

export function setExternalThreadId(threadId) {
  if (threadId) {
    safeLocalStorageSet(STORAGE_KEYS.EXTERNAL_THREAD_ID, threadId);
  } else {
    safeLocalStorageRemove(STORAGE_KEYS.EXTERNAL_THREAD_ID);
  }
}

export function getOrCreateExternalThreadId() {
  const existing = getExternalThreadId();
  if (existing) return existing;

  const newId = `webchat-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
  setExternalThreadId(newId);
  return newId;
}

export function getSelectedInstructorId() {
  return safeLocalStorageGet(STORAGE_KEYS.SELECTED_INSTRUCTOR_ID);
}

export function setSelectedInstructorId(instructorId) {
  if (instructorId) {
    safeLocalStorageSet(STORAGE_KEYS.SELECTED_INSTRUCTOR_ID, instructorId);
  } else {
    safeLocalStorageRemove(STORAGE_KEYS.SELECTED_INSTRUCTOR_ID);
  }
}

export function getTraceId() {
  return safeLocalStorageGet(STORAGE_KEYS.TRACE_ID);
}

export function setTraceId(traceId) {
  if (traceId) {
    safeLocalStorageSet(STORAGE_KEYS.TRACE_ID, traceId);
  } else {
    safeLocalStorageRemove(STORAGE_KEYS.TRACE_ID);
  }
}

/**
 * Get or create trace_id for current session/thread
 * trace_id is generated once per thread and persisted
 * @returns {string} UUID v4 trace_id
 */
export function getOrCreateTraceId() {
  const existing = getTraceId();
  if (existing) return existing;

  // Generate UUID v4
  const newTraceId = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
  
  setTraceId(newTraceId);
  return newTraceId;
}

const TRACE_DEBUG_KEY = "frostdesk_trace_debug_log";

/**
 * Save trace_id to debug log (max 100 entries)
 * @param {string} traceId - Trace ID to log
 */
export function saveTraceIdForDebug(traceId) {
  if (!traceId || typeof window === "undefined") return;
  
  try {
    const existing = JSON.parse(window.localStorage.getItem(TRACE_DEBUG_KEY) || "[]");
    const entry = {
      trace_id: traceId,
      timestamp: Date.now(),
      date: new Date().toISOString(),
    };
    
    // Add to beginning, keep max 100 entries
    const updated = [entry, ...existing].slice(0, 100);
    window.localStorage.setItem(TRACE_DEBUG_KEY, JSON.stringify(updated));
  } catch (e) {
    // Ignore errors
  }
}

/**
 * Get trace_id debug log
 * @returns {Array} Array of trace_id entries
 */
export function getTraceIdDebugLog() {
  if (typeof window === "undefined") return [];
  
  try {
    return JSON.parse(window.localStorage.getItem(TRACE_DEBUG_KEY) || "[]");
  } catch (e) {
    return [];
  }
}

// Client info storage functions
export function getClientName() {
  return safeLocalStorageGet(STORAGE_KEYS.CLIENT_NAME);
}

export function setClientName(name) {
  if (name) {
    safeLocalStorageSet(STORAGE_KEYS.CLIENT_NAME, name);
  } else {
    safeLocalStorageRemove(STORAGE_KEYS.CLIENT_NAME);
  }
}

export function getClientPhone() {
  return safeLocalStorageGet(STORAGE_KEYS.CLIENT_PHONE);
}

export function setClientPhone(phone) {
  if (phone) {
    safeLocalStorageSet(STORAGE_KEYS.CLIENT_PHONE, phone);
  } else {
    safeLocalStorageRemove(STORAGE_KEYS.CLIENT_PHONE);
  }
}
