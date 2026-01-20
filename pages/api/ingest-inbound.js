const SUPABASE_INGEST_URL =
  process.env.SUPABASE_INGEST_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_INGEST_URL ||
  "https://ncvkipizapkhawnaqssm.supabase.co/functions/v1/ingest-inbound";

const FD_INGEST_KEY = process.env.FD_INGEST_KEY || process.env.NEXT_PUBLIC_FD_INGEST_KEY || "";
const REQUIRED_FIELDS = ["external_thread_id", "content", "role"];

// Get allowed origins from environment
function getAllowedOrigins() {
  const allowedOrigin = process.env.ALLOWED_ORIGIN || "";
  if (!allowedOrigin) {
    // Fallback: allow localhost for development
    return ["http://localhost:3000", "http://localhost:3001"];
  }
  // Support comma-separated list of origins
  return allowedOrigin.split(",").map(origin => origin.trim()).filter(Boolean);
}

// Validate and get CORS origin
function getCorsOrigin(req) {
  const requestOrigin = req.headers.origin;
  if (!requestOrigin) {
    return null;
  }
  
  const allowedOrigins = getAllowedOrigins();
  if (allowedOrigins.includes(requestOrigin)) {
    return requestOrigin;
  }
  
  return null;
}

function setCors(res, origin) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  
  // Set CORS origin if provided and valid
  if (origin) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Credentials", "true");
  }
  
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-fd-ingest-key");
}

function sendJson(res, status, body, origin) {
  setCors(res, origin);
  res.status(status).json(body);
}

function getMissingFields(body = {}) {
  const missing = [];
  for (const field of REQUIRED_FIELDS) {
    if (!body[field] || (typeof body[field] === "string" && !body[field].trim())) {
      missing.push(field);
    }
  }
  return missing;
}

async function fetchWithRetry(url, options, retries = 1) {
  let attempt = 0;
  let lastError = null;

  while (attempt <= retries) {
    try {
      return await fetch(url, options);
    } catch (err) {
      lastError = err;
      if (attempt === retries) break;
      const backoff = 200 * Math.pow(2, attempt);
      await new Promise((resolve) => setTimeout(resolve, backoff));
      attempt += 1;
    }
  }

  throw lastError;
}

export default async function handler(req, res) {
  const corsOrigin = getCorsOrigin(req);
  
  if (req.method === "OPTIONS") {
    // Handle preflight request
    setCors(res, corsOrigin);
    return res.status(204).json({ ok: true });
  }

  if (req.method !== "POST") {
    return sendJson(res, 405, { ok: false, error: "Only POST allowed" }, corsOrigin);
  }

  if (!FD_INGEST_KEY) {
    return sendJson(res, 500, {
      ok: false,
      error: "Server misconfiguration: missing FD_INGEST_KEY",
    }, corsOrigin);
  }

  if (!SUPABASE_INGEST_URL) {
    return sendJson(res, 500, {
      ok: false,
      error: "Server misconfiguration: missing SUPABASE_INGEST_URL",
    }, corsOrigin);
  }

  const payload = req.body ?? {};
  const missing = getMissingFields(payload);
  if (missing.length > 0) {
    return sendJson(res, 400, {
      ok: false,
      error: `Missing required field${missing.length > 1 ? "s" : ""}: ${missing.join(
        ", "
      )}`,
    }, corsOrigin);
  }

  try {
    const response = await fetchWithRetry(
      SUPABASE_INGEST_URL,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-fd-ingest-key": FD_INGEST_KEY,
        },
        body: JSON.stringify(payload),
      },
      1
    );

    const text = await response.text();
    const contentType = response.headers.get("content-type") || "";
    const isJson = contentType.includes("application/json");

    if (!response.ok) {
      const parsed = isJson ? safeJson(text) : null;
      return sendJson(res, response.status, parsed ?? { ok: false, error: text }, corsOrigin);
    }

    if (isJson) {
      const parsed = safeJson(text);
      return sendJson(
        res,
        response.status,
        parsed ?? { ok: true, result: text },
        corsOrigin
      );
    }

    return sendJson(res, response.status, { ok: true, result: text }, corsOrigin);
  } catch (err) {
    return sendJson(res, 502, {
      ok: false,
      error: "Failed to proxy ingest request",
      details: String(err?.message || err || "unknown"),
    }, corsOrigin);
  }
}

function safeJson(text) {
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}
