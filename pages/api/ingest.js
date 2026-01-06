export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const orchUrl = process.env.ORCH_URL;
  if (!orchUrl) {
    return res
      .status(500)
      .json({ ok: false, error: "Missing ORCH_URL in environment (.env.local)" });
  }

  try {
    const upstreamRes = await fetch(`${orchUrl.replace(/\/$/, "")}/ingest`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(req.body),
    });

    const text = await upstreamRes.text();
    const contentType = upstreamRes.headers.get("content-type") || "";
    let parsed;
    if (contentType.includes("application/json")) {
      try {
        parsed = JSON.parse(text);
      } catch (err) {
        console.error("Unable to parse orchestrator response as JSON:", err);
      }
    }

    if (parsed) {
      return res.status(upstreamRes.status).json(parsed);
    }

    return res.status(upstreamRes.status).json({
      ok: upstreamRes.ok,
      raw: text,
    });
  } catch (err) {
    console.error("Error proxying to orchestrator:", err);
    return res.status(502).json({
      ok: false,
      error: err && err.message ? err.message : "Failed to reach the orchestrator",
    });
  }
}
