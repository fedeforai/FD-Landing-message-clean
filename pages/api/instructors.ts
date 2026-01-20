import type { NextApiRequest, NextApiResponse } from "next";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

type OkList = { ok: true; data: any[] };
type OkOne = { ok: true; data: any };
type Err = { ok: false; error: string; details?: any };

// Get allowed origins from environment
function getAllowedOrigins(): string[] {
  const allowedOrigin = process.env.ALLOWED_ORIGIN || "";
  if (!allowedOrigin) {
    // Fallback: allow localhost for development
    return ["http://localhost:3000", "http://localhost:3001"];
  }
  // Support comma-separated list of origins
  return allowedOrigin.split(",").map(origin => origin.trim()).filter(Boolean);
}

// Validate and get CORS origin
function getCorsOrigin(req: NextApiRequest): string | null {
  const requestOrigin = req.headers.origin;
  if (!requestOrigin) {
    return null;
  }
  
  const allowedOrigins = getAllowedOrigins();
  if (allowedOrigins.includes(requestOrigin)) {
    return requestOrigin;
  }
  
  return null;
}

function send(res: NextApiResponse, status: number, payload: OkList | OkOne | Err, origin?: string | null) {
  res.status(status);
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  
  // Set CORS origin if provided and valid
  if (origin) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Credentials", "true");
  }
  
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.json(payload);
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const corsOrigin = getCorsOrigin(req);
  
  if (req.method === "OPTIONS") {
    // Handle preflight request
    if (corsOrigin) {
      res.setHeader("Access-Control-Allow-Origin", corsOrigin);
      res.setHeader("Access-Control-Allow-Credentials", "true");
      res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    }
    return res.status(200).json({ ok: true, data: [] });
  }
  
  if (req.method !== "GET") return send(res, 405, { ok: false, error: "Only GET allowed" }, corsOrigin);

  if (!SUPABASE_URL) {
    console.error("Missing environment variable: SUPABASE_URL");
    return send(res, 500, {
      ok: false,
      error: "Missing SUPABASE_URL in environment",
    }, corsOrigin);
  }

  if (!SERVICE_ROLE_KEY) {
    console.error("Missing environment variable: SUPABASE_SERVICE_ROLE_KEY");
    return send(res, 500, {
      ok: false,
      error: "Missing SUPABASE_SERVICE_ROLE_KEY in environment",
    }, corsOrigin);
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false }
  });

  try {
    const id = String(req.query?.id || "").trim();

    if (id) {
      const { data, error } = await supabase
        .from("instructors")
        .select("id,name,slug,photo_url,bio,frostdesk_enabled,whatsapp_number,onboarding_state")
        .eq("id", id)
        .maybeSingle();

      if (error) {
        console.error("Supabase error (single):", error);
        return send(res, 500, { ok: false, error: error.message || "Supabase error", details: error }, corsOrigin);
      }
      if (!data) return send(res, 404, { ok: false, error: "Instructor not found" }, corsOrigin);

      // Safety: only return if approved (or frostdesk_enabled=true plus approved)
      // For safety, we require approved status even if frostdesk_enabled=true
      if (data.onboarding_state !== "approved") {
        return send(res, 404, { ok: false, error: "Instructor not available" }, corsOrigin);
      }

      return send(res, 200, { ok: true, data }, corsOrigin);
    }

    // List: filter by approved status (safety check)
    // Show instructors where onboarding_state='approved' OR (frostdesk_enabled=true AND approved)
    const { data, error } = await supabase
      .from("instructors")
      .select("id,name,slug,photo_url,bio,frostdesk_enabled,whatsapp_number,onboarding_state")
      .eq("onboarding_state", "approved")
      .order("name", { ascending: true });

    if (error) {
      console.error("Supabase error (list):", error);
      return send(res, 500, { ok: false, error: error.message || "Supabase error", details: error }, corsOrigin);
    }

    const cleaned = (data || [])
      .map((item) => ({
        id: item.id,
        name: (item.name ?? "").trim(),
        slug: item.slug ?? null,
        photo_url: item.photo_url ?? null,
        bio: item.bio ?? null,
        frostdesk_enabled: Boolean(item.frostdesk_enabled),
        whatsapp_number: item.whatsapp_number ?? null,
      }))
      .filter((item) => {
        const name = item.name.trim();
        return name.length > 0 && name.toLowerCase() !== "hello";
      });

    return send(res, 200, { ok: true, data: cleaned }, corsOrigin);
  } catch (e: any) {
    console.error("Unhandled /api/instructors error:", e);
    return send(res, 500, { ok: false, error: String(e?.message || e) }, corsOrigin);
  }
}
