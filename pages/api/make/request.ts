import type { NextApiRequest, NextApiResponse } from "next";

const MAKE_URL = process.env.MAKE_WEBHOOK_REQUEST_URL;

// Generate UUID v4
function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, message: "Method not allowed" });
  }

  if (!MAKE_URL) {
    return res.status(500).json({ ok: false, message: "Missing env MAKE_WEBHOOK_REQUEST_URL" });
  }

  // Generate trace_id if not provided (propagate to Make webhook)
  const body = req.body ?? {};
  const clientTraceId = body.trace_id;
  const serverTraceId = generateUUID();
  const traceId = clientTraceId || serverTraceId;

  // Ensure trace_id is included in payload to Make
  const payload = {
    ...body,
    trace_id: traceId,
  };

  try {
    const r = await fetch(MAKE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const contentType = r.headers.get("content-type") || "";
    const text = await r.text();

    res.status(r.status);
    if (contentType.includes("application/json")) {
      try {
        const parsed = JSON.parse(text);
        // Ensure trace_id is included in response
        return res.json({
          ...parsed,
          trace_id: parsed.trace_id || traceId,
        });
      } catch {
        return res.json({ ok: r.ok, message: text, trace_id: traceId });
      }
    }
    return res.send(text);
  } catch (e: any) {
    return res.status(500).json({ 
      ok: false, 
      message: "Proxy error", 
      detail: String(e?.message || e),
      trace_id: traceId,
    });
  }
}
