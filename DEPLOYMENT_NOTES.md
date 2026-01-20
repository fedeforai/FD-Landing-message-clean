# Deployment Notes

## Overview

This document provides deployment instructions for the FrostDesk Landing Page, including the serverless proxy route with authentication and retry logic.

## Key Features

- **Serverless Proxy Route** (`/api/ingest`): Securely proxies chat messages to the Orchestrator with:
  - Server-side `FD_INGEST_KEY` authentication
  - Automatic `external_message_id` generation (UUID v4)
  - IP-based rate limiting (10 requests per 60 seconds)
  - 30-second request timeout

- **Client-Side Retry Logic**: Automatic retry with exponential backoff:
  - Up to 3 retries for transient errors
  - Exponential backoff: 500ms → 1s → 2s → 4s (max 10s)
  - User-friendly error messages for 401, 429, 5xx errors

## Environment Variables

### Required (Server-Side Only - Never Exposed to Client)

```bash
# Orchestrator Configuration
ORCH_URL=https://your-orchestrator-url.com

# Supabase Configuration
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key-here

# FrostDesk Authentication
FD_INGEST_KEY=your-fd-ingest-key-here

# CORS Configuration
ALLOWED_ORIGIN=https://your-domain.com,https://www.your-domain.com
```

### Required (Public - Safe to Expose)

```bash
# Sentry Error Monitoring
NEXT_PUBLIC_SENTRY_DSN=https://your-sentry-dsn@sentry.io/project-id
```

### Optional (Public)

```bash
# Supabase Edge Function (if using /api/ingest-inbound)
NEXT_PUBLIC_SUPABASE_INGEST_URL=https://your-project.supabase.co/functions/v1/ingest-inbound

# WhatsApp Fallback
NEXT_PUBLIC_WA_LINK=https://wa.me/your-number

# Development Mode
NEXT_PUBLIC_FD_DEV_FAKE_AI=0
```

### Optional (Server-Side Only)

```bash
# Sentry Configuration (optional, for source maps)
SENTRY_ORG=your-org
SENTRY_PROJECT=your-project
```

## Deployment Steps

### 1. Vercel Deployment

#### Initial Setup

```bash
# Install dependencies
npm install

# Login to Vercel
npx vercel login

# Deploy to production
npx vercel --prod
```

#### Environment Variables Configuration

1. Go to Vercel Dashboard → Your Project → Settings → Environment Variables
2. Add all required variables listed above
3. **Important**: Set variables for:
   - **Production** environment
   - **Preview** environment (for PR previews)
   - **Development** environment (optional, for local testing)

4. **Security Checklist**:
   - ✅ `FD_INGEST_KEY` is set as **Server-Side Only** (not exposed to client)
   - ✅ `SUPABASE_SERVICE_ROLE_KEY` is set as **Server-Side Only**
   - ✅ `ORCH_URL` is set as **Server-Side Only**
   - ✅ `ALLOWED_ORIGIN` is set correctly for your domain(s)

### 2. Verify Deployment

#### Test the Proxy Route

```bash
# Test chat message ingestion
curl -X POST https://your-domain.com/api/ingest \
  -H "Content-Type: application/json" \
  -d '{
    "channel": "webchat",
    "external_thread_id": "test-thread-123",
    "instructor_id": "test-instructor-id",
    "text": "Hello, test message"
  }'
```

**Expected Response** (200 OK):
```json
{
  "ok": true,
  "replyText": "AI response text here"
}
```

#### Test Error Handling

```bash
# Test rate limiting (send 11 requests quickly)
for i in {1..11}; do
  curl -X POST https://your-domain.com/api/ingest \
    -H "Content-Type: application/json" \
    -d '{"channel":"webchat","external_thread_id":"test","instructor_id":"test","text":"test"}'
  echo ""
done
```

**Expected**: 10th request succeeds, 11th returns `429 Too Many Requests`

#### Test Authentication

If `FD_INGEST_KEY` is missing or incorrect, the Orchestrator should return `401 Unauthorized`, which will be proxied to the client with a user-friendly message.

### 3. Client-Side Testing

1. **Open the landing page** in a browser
2. **Select an instructor** from the list
3. **Send a chat message** and verify:
   - Message appears immediately
   - AI response appears after a short delay
   - Error messages are user-friendly (if any errors occur)

4. **Test Error Scenarios**:
   - **Network failure**: Disable network, send message → Should show "Network error" with retry
   - **Rate limit**: Send 11 messages quickly → Should show "Too many requests" message
   - **Server error**: If Orchestrator is down → Should show "Server error" with automatic retry

## Architecture

### Request Flow

```
User → Chat UI (pages/index.js)
  ↓
lib/api.js (sendChatMessage)
  ↓ (with retry logic)
/api/ingest (Next.js API Route)
  ↓ (adds FD_INGEST_KEY, external_message_id)
Orchestrator (/ingest endpoint)
  ↓
Response with replyText
  ↓
Displayed in chat UI
```

### Security Features

1. **Server-Side Authentication**: `FD_INGEST_KEY` is never exposed to the client
2. **Rate Limiting**: IP-based rate limiting (10 req/min) prevents abuse
3. **CORS Protection**: Only allowed origins can access API routes
4. **Request Timeout**: 30-second timeout prevents hanging requests
5. **Security Headers**: Configured in `next.config.js` (CSP, X-Frame-Options, etc.)

### Retry Logic Details

- **Max Retries**: 3 attempts (initial + 3 retries = 4 total)
- **Backoff Strategy**: Exponential with jitter
  - Attempt 1: ~500ms delay
  - Attempt 2: ~1s delay
  - Attempt 3: ~2s delay
  - Max delay: 10 seconds
- **Retry Conditions**:
  - ✅ Retries on: 429 (rate limit), 5xx (server errors), network errors
  - ❌ No retry on: 401 (auth), 400 (bad request), other 4xx errors

## Monitoring

### Sentry Integration

Errors are automatically tracked in Sentry:
- Client-side errors (browser)
- Server-side errors (API routes)
- Edge function errors (if applicable)

### Key Metrics to Monitor

1. **Error Rates**: Track 401, 429, 5xx errors in Sentry
2. **Response Times**: Monitor Orchestrator response times
3. **Rate Limit Hits**: Track how often rate limits are hit
4. **Retry Success Rate**: Monitor how often retries succeed

## Troubleshooting

### Common Issues

#### 1. "Missing FD_INGEST_KEY" Error

**Symptom**: API returns 500 with "Missing FD_INGEST_KEY"

**Solution**:
- Verify `FD_INGEST_KEY` is set in Vercel environment variables
- Ensure it's marked as "Server-Side Only" (not exposed to client)
- Redeploy after adding the variable

#### 2. "Authentication failed" (401)

**Symptom**: Chat messages return 401 error

**Solution**:
- Verify `FD_INGEST_KEY` matches the Orchestrator's expected key
- Check Orchestrator logs for authentication failures
- Ensure the key hasn't expired or been rotated

#### 3. Rate Limit Errors (429)

**Symptom**: Users see "Too many requests" after sending multiple messages

**Solution**:
- This is expected behavior (10 requests per minute per IP)
- Users should wait before retrying
- Consider adjusting `RATE_LIMIT_MAX_REQUESTS` in `/api/ingest.js` if needed

#### 4. Timeout Errors (504)

**Symptom**: Requests timeout after 30 seconds

**Solution**:
- Check Orchestrator health and response times
- Verify network connectivity between Vercel and Orchestrator
- Consider increasing `REQUEST_TIMEOUT` if Orchestrator is consistently slow

## Production Checklist

Before going live, verify:

- [ ] All environment variables are set in Vercel
- [ ] `FD_INGEST_KEY` is correct and matches Orchestrator
- [ ] `ALLOWED_ORIGIN` includes your production domain
- [ ] Sentry is configured and receiving errors
- [ ] Privacy policy page is accessible (`/privacy`)
- [ ] Security headers are enabled (check `next.config.js`)
- [ ] Rate limiting is working (test with curl)
- [ ] Error messages are user-friendly (test error scenarios)
- [ ] Retry logic is working (test with network throttling)
- [ ] WhatsApp CTA appears when conditions are met
- [ ] Instructor list loads correctly
- [ ] Chat messages are sent and received properly

## Support

For issues or questions:
1. Check Sentry for error logs
2. Review Vercel function logs
3. Test with curl to isolate client vs server issues
4. Verify environment variables are set correctly
