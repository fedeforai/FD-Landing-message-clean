export default function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const threadId = typeof req.query?.threadId === "string" ? req.query.threadId : "";

  return res.status(200).json({
    ok: false,
    error: "Not supported server-side; use client export",
    threadId,
  });
}
