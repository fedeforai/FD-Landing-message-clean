const SAFE_ENVS = [
  "NEXT_PUBLIC_SUPABASE_INGEST_URL",
  "NEXT_PUBLIC_WA_LINK",
  "NEXT_PUBLIC_FD_DEV_FAKE_AI",
  "VERCEL_ENV",
  "NODE_ENV",
];

export default function handler(req, res) {
  // Disable in production for security
  if (process.env.NODE_ENV === "production") {
    return res.status(404).json({ ok: false, error: "Not found" });
  }

  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ ok: false, error: "GET only" });
  }

  const payload = {};
  for (const key of SAFE_ENVS) {
    payload[key] = process.env[key] ?? null;
  }

  return res.status(200).json({ ok: true, env: payload });
}
