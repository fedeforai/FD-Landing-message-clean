# Environment Variables Setup

Create a `.env.local` file in the root directory with the following variables:

```bash
# ============================================
# Orchestrator Configuration
# ============================================
ORCH_URL=https://your-orchestrator-url.com

# ============================================
# Supabase Configuration
# ============================================
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key-here

# ============================================
# CORS Configuration
# ============================================
# Comma-separated list of allowed origins
# Example: "https://frostdesk.io,https://www.frostdesk.io"
ALLOWED_ORIGIN=https://your-domain.com

# ============================================
# FrostDesk Ingest Configuration
# ============================================
NEXT_PUBLIC_SUPABASE_INGEST_URL=https://your-project.supabase.co/functions/v1/ingest-inbound
FD_INGEST_KEY=your-fd-ingest-key-here

# ============================================
# WhatsApp Configuration
# ============================================
NEXT_PUBLIC_WA_LINK=https://wa.me/your-number

# ============================================
# Sentry Error Monitoring
# ============================================
NEXT_PUBLIC_SENTRY_DSN=https://your-sentry-dsn@sentry.io/project-id
# Optional:
# SENTRY_ORG=your-org
# SENTRY_PROJECT=your-project

# ============================================
# Development Configuration
# ============================================
NEXT_PUBLIC_FD_DEV_FAKE_AI=0
```

## Required Variables

- `ORCH_URL` - Orchestrator endpoint URL
- `SUPABASE_URL` - Supabase project URL
- `SUPABASE_SERVICE_ROLE_KEY` - Supabase service role key (SECRET)
- `FD_INGEST_KEY` - FrostDesk ingest key for authentication (SECRET, required for `/api/ingest`)
- `ALLOWED_ORIGIN` - Comma-separated list of allowed CORS origins
- `NEXT_PUBLIC_SENTRY_DSN` - Sentry DSN for error tracking

## Optional Variables

- `NEXT_PUBLIC_SUPABASE_INGEST_URL` - Supabase Edge Function URL (if using `/api/ingest-inbound`)
- `NEXT_PUBLIC_WA_LINK` - Fallback WhatsApp link
- `NEXT_PUBLIC_FD_DEV_FAKE_AI` - Development flag (set to "1" for fake AI)

## Getting Your Sentry DSN

1. Sign up at https://sentry.io (free tier available)
2. Create a new project (select Next.js)
3. Copy the DSN from project settings
4. Add it to your `.env.local` as `NEXT_PUBLIC_SENTRY_DSN`
