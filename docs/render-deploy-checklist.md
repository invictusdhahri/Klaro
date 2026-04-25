# Render Deployment Checklist

Quick reference for deploying Klaro to Render.

## Pre-Deployment

- [ ] Code pushed to GitHub
- [ ] Supabase project created and migrations applied
- [ ] Anthropic API key obtained
- [ ] RSA keypair generated for credential encryption
- [ ] (Optional) Tavily API key obtained

## Files Created/Modified

| File | Purpose |
|------|---------|
| `render.yaml` | Blueprint defining both services |
| `.renderignore` | Excludes unnecessary files from builds |
| `docs/deployment-render.md` | Full deployment guide |
| `docs/render-deploy-checklist.md` | This checklist |

## Deploy Steps

```bash
# 1. Commit all changes
git add render.yaml .renderignore docs/deployment-render.md docs/render-deploy-checklist.md
git commit -m "Add Render deployment configuration and documentation"
git push origin main
```

## Render Dashboard Steps

### 1. Create Blueprint Instance
- https://dashboard.render.com/blueprints
- Click "New Blueprint Instance"
- Select your repo
- Render creates: `klaro-backend` (Web) + `klaro-ml` (Private)

### 2. Add Environment Variables

**klaro-backend:**
```
NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...
ANTHROPIC_API_KEY=sk-ant-...
CREDENTIAL_ENCRYPTION_PRIVATE_KEY=LS0tLS1CRUdJTi...
CREDENTIAL_ENCRYPTION_PUBLIC_KEY=LS0tLS1CRUdJTi...
CORS_ORIGINS=https://your-frontend.vercel.app
```

**klaro-ml:**
```
SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...
ANTHROPIC_API_KEY=sk-ant-...
TAVILY_API_KEY=tvly-...  # optional
```

### 3. Deploy Frontend (Vercel)
```bash
cd apps/frontend
vercel
```

Set Vercel env vars:
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` (anon, not service_role)
- `NEXT_PUBLIC_API_BASE_URL=https://klaro-backend-xxx.onrender.com`
- `CREDENTIAL_ENCRYPTION_PUBLIC_KEY`

### 4. Update CORS
After frontend deploy, update `CORS_ORIGINS` on backend with actual Vercel URL.

## Post-Deployment Verification

```bash
# Test backend health
curl https://klaro-backend-xxx.onrender.com/health
# Expected: {"status":"ok","service":"klaro-backend","uptime":...}

# Test registration flow via frontend
# Upload KYC document
# Connect bank account
# Verify transactions appear
```

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Build fails | Check `render.yaml` syntax; backend must build with **pnpm from repo root** (not `npm` in `apps/backend` — `workspace:*` needs the monorepo install) |
| ML service OOM | Upgrade to Starter plan (512MB) or reduce dependencies |
| Cold starts | Normal on free tier; upgrade or add cron job to keep warm |
| Backend can't reach ML | Verify `ML_BASE_URL` is auto-set; check both services in same region |

## Monthly Costs (Estimate)

| Service | Plan | Cost |
|---------|------|------|
| klaro-backend | Starter | ~$7 |
| klaro-ml | Starter | ~$7 |
| Supabase | Free | $0 |
| Vercel | Free | $0 |
| **Total** | | **~$14/month** |

## Important Security Notes

1. **Never commit** `.env` files or keys
2. **Never expose** `SUPABASE_SERVICE_ROLE_KEY` to frontend
3. **Never expose** `CREDENTIAL_ENCRYPTION_PRIVATE_KEY`
4. ML service is Private (pserv) — not accessible from internet
5. Always use HTTPS in production
