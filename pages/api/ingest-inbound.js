const SUPABASE_INGEST_URL =
  process.env.NEXT_PUBLIC_SUPABASE_INGEST_URL ||
  "https://ncvkipizapkhawnaqssm.supabase.co/functions/v1/ingest-inbound";

const FD_INGEST_KEY = process.env.FD_INGEST_KEY || "";

function sendJson(res, status, body) {
  res.status(status);
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-fd-ingest-key");
  res.json(body);
}

export default async function handler(req, res) {
  if (req.method === "OPTIONS") {
    return sendJson(res, 204, { ok: true });
  }

  if (req.method !== "POST") {
    return sendJson(res, 405, { ok: false, error: "Only POST allowed" });
  }

  if (!FD_INGEST_KEY) {
    return sendJson(res, 500, { ok: false, error: "Server misconfiguration: missing FD_INGEST_KEY" });
  }

  try {
    const response = await fetch(SUPABASE_INGEST_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-fd-ingest-key": FD_INGEST_KEY,
      },
      body: JSON.stringify(req.body),
    });

    const text = await response.text();
    const contentType = response.headers.get("content-type") || "application/json";
    const isJson = contentType.includes("application/json");
    if (!response.ok) {
      const parsed = isJson ? JSON.parse(text || "{}") : { error: text };
      return sendJson(res, response.status, parsed);
    }

    if (isJson) {
      const body = text ? JSON.parse(text) : {};
      return sendJson(res, response.status, body);
    }

    return sendJson(res, response.status, { ok: true, result: text });
  } catch (err) {
    return sendJson(res, 502, {
      ok: false,
      error: "Failed to proxy ingest request",
      details: String(err?.message || err),
    });
  }
}
