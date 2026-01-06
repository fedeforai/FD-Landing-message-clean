export default function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const hasSupabaseUrl = Boolean(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL);
  const hasServiceRoleKey = Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY);
  const hasAnonKey = Boolean(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  const orchUrlPresent = Boolean(process.env.ORCH_URL);

  return res.status(200).json({
    ok: true,
    hasSupabaseUrl,
    hasServiceRoleKey,
    hasAnonKey,
    orchUrlPresent,
  });
}
