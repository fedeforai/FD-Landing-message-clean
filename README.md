# FrostDesk Message Landing

Public landing page for **FrostDesk**, the AI-powered WhatsApp booking assistant for ski instructors.

This repository contains the marketing and message-oriented landing page used to explain FrostDesk’s value proposition and route instructors to the main application.

---

## 🚀 What is FrostDesk?

FrostDesk is an AI-powered booking assistant designed for ski instructors.

It allows instructors to:
- Receive booking requests via WhatsApp
- Automatically collect lesson details (date, time, level, participants)
- Check availability
- Sync confirmed lessons with Google Calendar
- Reduce manual back-and-forth with clients

The goal is simple:  
**less admin, more skiing.**

---

## 🧭 How this repository fits in

This repository contains:
- The public-facing landing page
- Messaging, copy and positioning
- Entry point for instructors discovering FrostDesk

The actual application lives here:  
👉 https://github.com/fedeforai/frostdesk-main

Live app:  
👉 https://frostdesk-main.vercel.app

---

## 🧩 Tech stack

This landing page is built with:
- HTML / CSS / JS (static)
- Optimized for fast load and clarity
- Deployed via Vercel or static hosting

No backend logic lives here.

---

## 🔗 Related repositories

- **FrostDesk App**  
  https://github.com/fedeforai/frostdesk-main

---

## 📌 Status

This project is part of an active MVP.
Copy, messaging and visuals may evolve as FrostDesk scales.

---

## 📬 Contact

For questions or collaboration:  
**FrostDesk Team**

---

## 🛠️ Environment and deployment

The landing chat proxy lives in `/api/ingest-inbound` on Vercel and talks to FrostDesk’s orchestrator by injecting `x-fd-ingest-key`.
The following variables must be configured in every environment (local, staging, production):

- `SUPABASE_URL` – the service role Supabase endpoint used in `/api/instructors`.
- `SUPABASE_SERVICE_ROLE_KEY` – the secret service role key for Supabase data access (do **not** expose this to the browser).
- `FD_INGEST_KEY` – the secret FrostDesk ingest key that the Next.js API route will forward to the orchestrator.
- `NEXT_PUBLIC_SUPABASE_INGEST_URL` – the Supabase Edge Function URL that `/api/ingest-inbound` should proxy.
- `NEXT_PUBLIC_WA_LINK` – fallback WhatsApp deeplink if an instructor does not publish a number.

Optional vars:

- `NEXT_PUBLIC_FD_DEV_FAKE_AI` – set to `1` locally to simulate an assistant response without hitting the orchestrator.

The shipped `.env.local.example` contains these identifiers and serves as a template for editors or Vercel’s UI.

### Deploy on Vercel

1. Sign in: `npx vercel login` (or use the Vercel dashboard).
2. Run `npx vercel --prod` from this directory for the first deployment; Vercel will prompt for the project name and root directory (typically `.`).
3. In the Vercel dashboard, set the env vars listed above under Settings → Environment Variables (remember to add both Preview and Production values).
4. Vercel runs `npm run build` automatically; once it succeeds the `/api/**` routes are live and wired to the configured env vars.

> **Tip:** always run `npx vercel` from the `fd-landing-message-clean` directory (for example `cd /Users/federiconovello/Desktop/FD-Landing-message-clean && npx vercel --prod`) rather than from your home folder so Vercel picks up the correct root.

### Smoke test (curl)

From the project root, exercise the ingest proxy to verify the deployment reads the `FD_INGEST_KEY`:

```
curl -X POST https://<your-vercel-url>/api/ingest-inbound \
  -H "Content-Type: application/json" \
  -H "x-fd-ingest-key: $FD_INGEST_KEY" \
  -d '{"external_thread_id":"land:web:test:1","content":"test","role":"user"}'
```

Expect the orchestrator JSON to flow straight through (the response should match the Supabase Edge Function payload). You can also hit `/api/debug/env` to confirm the public env vars (`NEXT_PUBLIC_SUPABASE_INGEST_URL`, `NEXT_PUBLIC_WA_LINK`, `NEXT_PUBLIC_FD_DEV_FAKE_AI`, etc.) are available on Vercel without leaking secrets.
