// api/instructors.js
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

function json(res, status, payload) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  // CORS basic (safe default). Se vuoi, restringiamo in seguito.
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.end(JSON.stringify(payload));
}

export default async function handler(req, res) {
  if (req.method === "OPTIONS") return json(res, 200, { ok: true });
  if (req.method !== "GET") return json(res, 405, { ok: false, error: "Only GET allowed" });

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return json(res, 500, { ok: false, error: "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY" });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  try {
    const id = (req.query?.id || "").toString().trim();

    if (id) {
      const { data, error } = await supabase
        .from("instructors")
        .select("id,name,photo_url,bio,calendar_id")
        .eq("id", id)
        .maybeSingle();

      if (error) return json(res, 500, { ok: false, error: error.message || "Supabase error" });
      if (!data) return json(res, 404, { ok: false, error: "Instructor not found" });

      return json(res, 200, { ok: true, data });
    }

    const { data, error } = await supabase
      .from("instructors")
      .select("id,name,photo_url,bio,calendar_id")
      .order("name", { ascending: true });

    if (error) return json(res, 500, { ok: false, error: error.message || "Supabase error" });

    return json(res, 200, { ok: true, data: data || [] });
  } catch (e) {
    return json(res, 500, { ok: false, error: "Unexpected error" });
  }
}