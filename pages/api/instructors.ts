import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

function send(res, status, payload) {
  res.status(status).json(payload);
}

export default async function handler(req, res) {
  if (req.method === "OPTIONS") return send(res, 200, { ok: true });
  if (req.method !== "GET") return send(res, 405, { ok: false, error: "Only GET allowed" });

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return send(res, 500, { ok: false, error: "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY" });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  try {
    const id = String(req.query?.id || "").trim();

    if (id) {
      const { data, error } = await supabase
        .from("instructors")
        .select("id,name,photo_url,bio,calendar_id")
        .eq("id", id)
        .maybeSingle();

      if (error) return send(res, 500, { ok: false, error: error.message || "Supabase error" });
      if (!data) return send(res, 404, { ok: false, error: "Instructor not found" });

      return send(res, 200, { ok: true, data });
    }

    const { data, error } = await supabase
      .from("instructors")
      .select("id,name,photo_url,bio,calendar_id")
      .order("name", { ascending: true });

    if (error) return send(res, 500, { ok: false, error: error.message || "Supabase error" });

    return send(res, 200, { ok: true, data: data || [] });
  } catch (e) {
    return send(res, 500, { ok: false, error: String(e?.message || e) });
  }
}