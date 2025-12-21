import type { NextApiRequest, NextApiResponse } from "next";

const MAKE_URL = process.env.MAKE_WEBHOOK_CONFIRM_URL;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, message: "Method not allowed" });
  }

  if (!MAKE_URL) {
    return res.status(500).json({ ok: false, message: "Missing env MAKE_WEBHOOK_CONFIRM_URL" });
  }

  try {
    const r = await fetch(MAKE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req.body ?? {}),
    });

    const contentType = r.headers.get("content-type") || "";
    const text = await r.text();

    res.status(r.status);
    if (contentType.includes("application/json")) {
      try {
        return res.json(JSON.parse(text));
      } catch {
        return res.json({ ok: r.ok, message: text });
      }
    }
    return res.send(text);
  } catch (e: any) {
    return res.status(500).json({ ok: false, message: "Proxy error", detail: String(e?.message || e) });
  }
}
