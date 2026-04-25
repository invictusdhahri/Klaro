# Deploying Klaro to Render

This guide walks you through deploying the Klaro platform to [Render](https://render.com).

## Architecture on Render

```
┌─────────────────┐      ┌─────────────────┐      ┌─────────────────┐
│   Frontend      │      │   Backend       │      │   ML Service    │
│   (Vercel)      │◄────►│   (Web Service) │◄────►│   (Private)     │
│                 │      │                 │      │                 │
│  Next.js 15     │      │  Express.js     │      │  FastAPI        │
│  Static/SSR     │      │  Node.js 20     │      │  Python 3.11    │
└─────────────────┘      └─────────────────┘      └─────────────────┘
         │                       │                          │
         └───────────────────────┴──────────────────────────┘
                                 │
                    ┌────────────▼────────────┐
                    │    Supabase Postgres    │
                    │    (Managed DB)         │
                    └─────────────────────────┘
```

## Quick Deploy (Blueprint Method)

### Step 1: Prerequisites

- [Render account](https://dashboard.render.com)
- [GitHub repository](https://github.com) with your Klaro code
- [Supabase project](https://supabase.com) (managed or self-hosted)
- [Anthropic API key](https://console.anthropic.com) for Claude

### Step 2: Push to GitHub

```bash
git add render.yaml
git commit -m "Add Render deployment configuration"
git push origin main
```

### Step 3: Create Blueprint Instance

1. Go to [Render Dashboard](https://dashboard.render.com)
2. Click **"Blueprints"** in the left sidebar
3. Click **"New Blueprint Instance"**
4. Connect your GitHub repository
5. Render will read `render.yaml` and show two services:
   - `klaro-backend` — Web Service (public API)
   - `klaro-ml` — Private Service (internal ML API)
6. Click **"Apply"**

### Step 4: Configure Environment Variables

After the services are created, you need to set secrets:

#### For `klaro-backend`:

| Variable | Value | How to Get |
|----------|-------|------------|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://xxxx.supabase.co` | Supabase Project Settings → API |
| `SUPABASE_SERVICE_ROLE_KEY` | `eyJ...` | Supabase Project Settings → API → service_role key |
| `ANTHROPIC_API_KEY` | `sk-ant-...` | [Anthropic Console](https://console.anthropic.com) |
| `CREDENTIAL_ENCRYPTION_PRIVATE_KEY` | Base64 PEM | Generate locally (see below) |
| `CORS_ORIGINS` | `https://your-frontend.vercel.app` | Your deployed frontend URL |

#### For `klaro-ml`:

| Variable | Value | How to Get |
|----------|-------|------------|
| `SUPABASE_URL` | Same as above | Supabase Project Settings |
| `SUPABASE_SERVICE_ROLE_KEY` | Same as above | Supabase Project Settings |
| `ANTHROPIC_API_KEY` | Same as above | Anthropic Console |
| `TAVILY_API_KEY` | `tvly-...` | Optional — [Tavily](https://tavily.com) for web search |

### Step 5: Generate RSA Keys for Credential Encryption

Klaro encrypts bank credentials client-side before transmission. You need RSA keypair:

```bash
# Generate private key (4096-bit RSA)
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:4096 -out private.pem

# Extract public key
openssl pkey -in private.pem -pubout -out public.pem

# Base64-encode for environment variables (remove newlines)
export CREDENTIAL_ENCRYPTION_PRIVATE_KEY=$(base64 -i private.pem | tr -d '\n')
export CREDENTIAL_ENCRYPTION_PUBLIC_KEY=$(base64 -i public.pem | tr -d '\n')

echo "Private: $CREDENTIAL_ENCRYPTION_PRIVATE_KEY"
echo "Public: $CREDENTIAL_ENCRYPTION_PUBLIC_KEY"
```

**Important:**
- Set `CREDENTIAL_ENCRYPTION_PRIVATE_KEY` only on the **backend** service
- Set `CREDENTIAL_ENCRYPTION_PUBLIC_KEY` on both backend (for reference) and ship to frontend
- Never expose the private key to the browser or commit it

### Step 6: Deploy Frontend

```bash
cd apps/frontend

# Install Vercel CLI if needed
npm i -g vercel

# Deploy
vercel

# Set environment variables in Vercel dashboard:
# - NEXT_PUBLIC_SUPABASE_URL (same as backend)
# - NEXT_PUBLIC_SUPABASE_ANON_KEY (anon key, not service_role)
# - NEXT_PUBLIC_API_BASE_URL=https://klaro-backend-xxx.onrender.com
# - CREDENTIAL_ENCRYPTION_PUBLIC_KEY (base64 public key from Step 5)
```

### Step 7: Verify Deployment

1. **Backend health check:**
   ```bash
   curl https://klaro-backend-xxx.onrender.com/health
   # Expected: {"status":"ok"}
   ```

2. **ML health check** (internal, but can test via backend):
   The ML service is private, but the backend proxies requests to it.

3. **Test full flow:**
   - Register a user on your frontend
   - Upload KYC documents
   - Connect a bank account
   - Check that transactions are scraped and scored

## Manual Service Setup (No Blueprint)

If you prefer creating services manually:

### Backend Service

1. **New Web Service**
2. **Runtime:** Node
3. **Build Command:**
   ```bash
   cd apps/backend && npm install && npm run build
   ```
4. **Start Command:**
   ```bash
   cd apps/backend && npm start
   ```
5. **Environment Variables:**
   - `NODE_ENV=production`
   - `PORT=4000`
   - `ML_BASE_URL=http://klaro-ml:8000` (internal Render URL)
   - Plus all secrets from Step 4 above

### ML Service

1. **New Private Service**
2. **Runtime:** Python 3.11
3. **Build Command:**
   ```bash
   cd apps/ml && pip install -e ".[ml,kyc,statements]"
   ```
4. **Start Command:**
   ```bash
   cd apps/ml && uvicorn klaro_ml.main:app --host 0.0.0.0 --port 8000
   ```
5. **Environment Variables:**
   - `ML_ENV=production`
   - `ML_PORT=8000`
   - Plus all secrets from Step 4 above

## Troubleshooting

### Cold Starts

Render's free/starter plans have cold starts (30-60s for ML service due to heavy dependencies like PaddleOCR). Consider:
- Upgrading to Starter plan ($7/month) for lower cold start times
- Using [Render's Cron Jobs](https://render.com/docs/cronjobs) to ping `/health` every 10 minutes

### Memory Issues

The ML service with all KYC libraries needs ~512MB+ RAM. If you see OOM errors:
1. Upgrade to Starter plan (512MB)
2. Or reduce dependencies by removing `--extra kyc` (disables OCR/face features)

### ML Service Not Reachable

If backend can't reach ML:
1. Check that ML service is **Private Service** type
2. Verify `ML_BASE_URL` is set correctly (should be `http://klaro-ml:8000`)
3. Check Render's internal networking docs

### Database Connection Failures

Ensure your Supabase project allows connections from Render's IP ranges:
1. In Supabase Dashboard → Database → Network Restrictions
2. Add Render's egress IPs (see [Render docs](https://render.com/docs/static-outbound-ip-addresses))

## Cost Estimate (Render)

| Service | Plan | Monthly Cost |
|---------|------|--------------|
| klaro-backend | Starter | ~$7 |
| klaro-ml | Starter | ~$7 |
| Supabase | Free tier | Free (or $25 for Pro) |
| **Total** | | **~$14-39/month** |

For production workloads, consider upgrading to Standard plans for better performance and uptime SLAs.

## Security Checklist

- [ ] `SUPABASE_SERVICE_ROLE_KEY` only on backend/ML, never in frontend
- [ ] `CREDENTIAL_ENCRYPTION_PRIVATE_KEY` only on backend
- [ ] `ANTHROPIC_API_KEY` set on both backend and ML
- [ ] `CORS_ORIGINS` restricted to your actual frontend domain(s)
- [ ] ML service is Private (not accessible from internet)
- [ ] Database has RLS policies enabled

## Next Steps

- Set up [Render Cron Jobs](https://render.com/docs/cronjobs) for periodic tasks
- Configure [Log Streams](https://render.com/docs/log-streams) for centralized logging
- Set up [Alerting](https://render.com/docs/alerts) for service health
- Consider [Render Disks](https://render.com/docs/disks) if you need persistent storage
