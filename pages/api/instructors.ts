import type { NextApiRequest, NextApiResponse } from "next";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

type OkList = { ok: true; data: any[] };
type OkOne = { ok: true; data: any };
type Err = { ok: false; error: string; details?: any };

function send(res: NextApiResponse, status: number, payload: OkList | OkOne | Err) {
  res.status(status);
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.json(payload);
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === "OPTIONS") return send(res, 200, { ok: true, data: [] });
  if (req.method !== "GET") return send(res, 405, { ok: false, error: "Only GET allowed" });

  if (!SUPABASE_URL) {
    console.error("Missing environment variable: SUPABASE_URL");
    return send(res, 500, {
      ok: false,
      error: "Missing SUPABASE_URL in environment",
    });
  }

  if (!SERVICE_ROLE_KEY) {
    console.error("Missing environment variable: SUPABASE_SERVICE_ROLE_KEY");
    return send(res, 500, {
      ok: false,
      error: "Missing SUPABASE_SERVICE_ROLE_KEY in environment",
    });
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false }
  });

  try {
    const id = String(req.query?.id || "").trim();

    if (id) {
      const { data, error } = await supabase
        .from("instructors")
        .select("id,name,photo_url,bio,calendar_id")
        .eq("id", id)
        .maybeSingle();

      if (error) {
        console.error("Supabase error (single):", error);
        return send(res, 500, { ok: false, error: error.message || "Supabase error", details: error });
      }
      if (!data) return send(res, 404, { ok: false, error: "Instructor not found" });

      return send(res, 200, { ok: true, data });
    }

    const { data, error } = await supabase
      .from("instructors")
      .select("id,name,photo_url,bio,calendar_id")
      .order("name", { ascending: true });

    if (error) {
      console.error("Supabase error (list):", error);
      return send(res, 500, { ok: false, error: error.message || "Supabase error", details: error });
    }

    const cleaned = (data || [])
      .map((item) => ({
        ...item,
        name: (item.name ?? "").trim(),
        calendar_id: (item.calendar_id ?? "").trim(),
      }))
      .filter((item) => {
        const name = (item.name ?? "").trim();
        return name.length > 0 && name.toLowerCase() !== "hello";
      });

    return send(res, 200, { ok: true, data: cleaned });
  } catch (e: any) {
    console.error("Unhandled /api/instructors error:", e);
    return send(res, 500, { ok: false, error: String(e?.message || e) });
  }
}
