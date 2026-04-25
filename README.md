# Klaro

> Alternative credit scoring for Tunisia. KYC, bank insights, and an AI advisor that knows you better than you know yourself.

Klaro is a web-first platform that builds a transparent, AI-powered credit score from a user's KYC documents, bank activity, and payment behavior — without depending on credit bureau gatekeeping.

This repository is a **pnpm + Turborepo monorepo** containing the Next.js frontend, the Express backend, the Python FastAPI ML sidecar, and shared TypeScript packages, all wired to Supabase.

> **Note:** The originally planned React Native mobile app has been deferred. The monorepo is structured so a future `apps/mobile` can consume the same `packages/shared` and back-end services without changes.

---

## Repository layout

```
Klaro/
├── apps/
│   ├── frontend/       Next.js 15 (App Router) — user app + bank dashboard
│   ├── backend/        Express.js + TypeScript API
│   └── ml/             FastAPI Python sidecar (KYC + 4-layer credit scoring)
├── packages/
│   ├── shared/         TS types, Zod schemas, API client, constants
│   ├── ui/             Tiny shared UI helpers (cn, etc.)
│   ├── eslint-config/  Shared ESLint presets
│   └── tsconfig/       Shared tsconfig presets
├── supabase/           Supabase CLI config + SQL migrations (0001–0013)
├── infra/docker/       Production Dockerfiles (backend, frontend, ml, scraper)
├── docs/               Feature branch summaries and design decisions
├── docker-compose.yml  Local dev orchestration for backend + ml
├── ARCHITECTURE.md     Web-first architecture, diagrams, request flows
└── turbo.json          Turborepo pipeline
```

---

## Prerequisites

| Tool                | Version  |
| ------------------- | -------- |
| Node.js             | 20.11+   |
| pnpm                | 9.0+     |
| Python              | 3.11+    |
| [`uv`](https://docs.astral.sh/uv/) | latest |
| Docker              | 24+      |
| [Supabase CLI](https://supabase.com/docs/guides/cli) | latest |

---

## Quickstart

```bash
# 1. Install JS deps
pnpm install

# 2. Configure environment
cp .env.example .env
# Fill in NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY,
# SUPABASE_SERVICE_ROLE_KEY, ANTHROPIC_API_KEY (optional).

# 3. Start Supabase locally (Postgres + Auth + Storage + Studio)
supabase start
# Copy the displayed anon key + service-role key into your .env file.

# 4. Apply database migrations + generate TS types
pnpm db:migrate
pnpm gen:types

# 5. Install Python deps for the ML sidecar
cd apps/ml && uv sync --extra dev && cd -

# 6. Run everything in parallel
pnpm dev
# - apps/frontend → http://localhost:3000
# - apps/backend  → http://localhost:4000
# - apps/ml       → http://localhost:8000
```

Supabase Studio (local): <http://127.0.0.1:54323>

### Bank self-registration

Banks register themselves through the public sign-up page at
[`/bank/register`](http://localhost:3000/bank/register) (also linked from the
login page). The form collects:

- **Bank profile** — name, slug, two-letter country code, optional logo URL.
- **Administrator account** — full name, work email, password.

Submitting the form hits `POST /api/bank/register`, which (atomically, with
rollback on failure) creates:

1. A row in `public.banks` (the canonical bank organisation).
2. A Supabase auth user with `app_metadata = { role: 'bank', bank_id }`.
3. A `public.bank_users` link row with role `admin`.

The administrator is then auto-signed-in and lands on `/bank` (the dashboard).
Subsequent admins for the same bank can be invited later via Supabase Studio
or a future invite flow — just add a row to `bank_users` and set the same
`bank_id` on the new auth user's `app_metadata`.

### Run via Docker

```bash
docker compose up --build
```

This brings up the backend and ML sidecar in containers. The Next.js frontend stays in `pnpm dev` for fast iteration.

---

## Scripts

Root scripts (run with `pnpm <script>`):

| Script           | Description                                           |
| ---------------- | ----------------------------------------------------- |
| `dev`            | Run all apps in parallel via Turborepo                |
| `build`          | Build all apps (uses Turborepo cache)                 |
| `lint`           | ESLint across the workspace                           |
| `typecheck`      | `tsc --noEmit` across the workspace                   |
| `test`           | Run all tests                                         |
| `format`         | Prettier write across the repo                        |
| `db:start`       | `supabase start`                                      |
| `db:stop`        | `supabase stop`                                       |
| `db:reset`       | `supabase db reset` (re-applies migrations + seed)    |
| `db:migrate`     | Apply pending migrations                              |
| `db:diff`        | Generate a new migration from local schema changes    |
| `gen:types`      | Regenerate `packages/shared/src/types/database.ts`    |

---

## App entry points

| Surface                | Path                                                                          |
| ---------------------- | ----------------------------------------------------------------------------- |
| Marketing              | `/`                                                                           |
| Auth                   | `/login`, `/register`, `/bank/register`                                       |
| User app               | `/dashboard`, `/kyc`, `/connect-bank`, `/transactions`, `/documents`, `/chat` |
| Bank operator console  | `/bank`, `/bank/clients`, `/bank/clients/[id]`                                |
| API health             | `GET http://localhost:4000/health`                                            |
| ML health              | `GET http://localhost:8000/health`                                            |

Bank dashboard is gated by `app_metadata.role = 'bank'` plus a non-null `app_metadata.bank_id`. Both fields are populated automatically by the `POST /api/bank/register` flow described above.

---

## Environment variables

See [`.env.example`](.env.example) for the full list. The most important:

| Variable                              | Used by            | Notes                                        |
| ------------------------------------- | ------------------ | -------------------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`            | frontend, backend  | Public                                       |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY`       | frontend           | Public                                       |
| `SUPABASE_SERVICE_ROLE_KEY`           | backend            | **Server-only.** Never expose to browser.    |
| `ANTHROPIC_API_KEY`                   | backend, ml        | Required for chat + LLM scoring              |
| `ML_BASE_URL`                         | backend            | URL of the FastAPI sidecar                   |
| `NEXT_PUBLIC_API_BASE_URL`            | frontend           | URL of the Express backend                   |
| `CREDENTIAL_ENCRYPTION_PUBLIC_KEY`    | frontend (shipped) | RSA-OAEP public key for bank credentials     |
| `CREDENTIAL_ENCRYPTION_PRIVATE_KEY`   | backend (server)   | Decrypts the envelope; **never** logged      |

---

## Internal documentation

These documents are the canonical source of truth for the project's design decisions. Read them before touching core subsystems.

| Document | What it covers |
| -------- | -------------- |
| [`ARCHITECTURE.md`](ARCHITECTURE.md) | Full system architecture — monorepo layout, request flows (Mermaid diagrams), middleware stack, AI model routing table, Supabase schema overview, security checkpoints. **Start here.** |
| [`docs/branch-feature-deepfake.md`](docs/branch-feature-deepfake.md) | Everything added in `feature/deepfake`: document forensics pipeline (ELA, FFT, vision ensemble), Layer 4 reasoner with clarification Q&A, chat sessions + long-term memory, score action UX, and the migrations (`0007`–`0010`) that wire it all together. Read before touching `apps/ml/statements/`, `apps/backend/routes/chat.routes.ts`, or the score dashboard components. |

### Where things live

A quick map for contributors who need to find something fast:

**Credit scoring pipeline** — `apps/ml/src/klaro_ml/scoring/`
- `compose.py` — assembles Layers 1–4 into a single score response
- `rule_scorecard.py` — Layer 1 deterministic rules
- `anomaly_detector.py` — Layer 2 IsolationForest (`--extra ml` required)
- `llm_scorer.py` — Layer 3 Claude Sonnet coaching + rubric
- `context_builder.py` — user context assembly (profile, transactions, KYC status, bank connections)
- `impact_estimator.py` — calculates expected score change for each recommended action

**Statement verification pipeline** — `apps/ml/src/klaro_ml/statements/`
- `deepfake.py` — orchestrates all forensic passes on uploaded PDFs
- `forensics/pdf_structure.py` — PDF metadata and object tree analysis
- `forensics/image_forensics.py` — ELA, FFT noise, JPEG ghost detection
- `forensics/rule_engine.py` — deterministic fraud-signal rules
- `forensics/vision_ensemble.py` — multi-model vision classification
- `consistency.py` — cross-field and temporal consistency checks
- `income_plausibility.py` — income vs. Tunisian salary-band validation (`data/salary_bands_tn.py`)
- `authenticity.py` — overall authenticity scoring
- `reasoner.py` — Layer 4 rubric-weighted verdict (`approved` / `needs_review` / `rejected`), narrative reasoning, per-flag explanations, clarification questions; LLM score is clamped so it cannot override deterministic critical signals
- `extractor.py` — structured field extraction from raw OCR output

**KYC pipeline** — `apps/ml/src/klaro_ml/kyc/`
- `liveness.py` / `vision_liveness.py` — MediaPipe-based liveness detection
- `face.py` / `face_detect.py` — AdaFace stubs for face matching
- `ocr.py` / `vision_extractor.py` — document OCR via PaddleOCR
- `haiku_parser.py` — structured field extraction with Claude Haiku

**Bank scraping** — `apps/backend/src/services/scraping/`
- `orchestrator.ts` — spawns and manages ephemeral Playwright workers, one container per session
- `adapters/` — per-bank Playwright scrapers: `attijari.ts`, `biat.ts`, `stb.ts`, `ubci.ts` (plus `base.ts` for shared logic)

**Chat & memory** — `apps/backend/src/routes/chat.routes.ts`
- Session management (create, list, title), `session_id`-scoped message persistence, stale-session summarization, `user_memories` extraction and injection into the advisor system prompt. Full design in [`docs/branch-feature-deepfake.md`](docs/branch-feature-deepfake.md).

**Shared contract** — `packages/shared/src/`
- `api/endpoints.ts` — single source of truth for all API paths (import, don't hardcode)
- `schemas/` — Zod schemas for every request/response body; validated on both client and server
- `types/` — TypeScript interfaces derived from schemas + `database.generated.ts` (auto-generated; do not hand-edit)
- `constants/ai-models.ts` — model map mirrored in `apps/ml/src/klaro_ml/settings.py`

**Database** — `supabase/migrations/`

| Migration | What it adds |
| --------- | ------------ |
| `0001_init.sql` | `profiles`, `kyc_documents`, `bank_connections`, `transactions`, `credit_scores`, `anomaly_flags`, `bank_consents`, `chat_messages`, `audit_logs`; auto profile trigger; `updated_at` trigger |
| `0002_storage.sql` | Private buckets `kyc-docs`, `bank-statements`, `selfies` with owner-scoped RLS policies |
| `0003_roles.sql` | `app_role` enum, `current_user_role()`, `has_role()`, bank-visibility policies gated by `bank_consents` |
| `0004_score_band_generated.sql` | Generated `score_band` column on `credit_scores` |
| `0005_bank_portal.sql` | Bank portal support tables |
| `0006_bank_statements.sql` | `bank_statements` table for uploaded PDF/CSV/Excel files |
| `0007_statement_review.sql` | Extends `bank_statements` with `reasoning`, `clarification_questions`, `clarification_answers`, `risk_score`, `income_assessment`, `needs_review` status |
| `0008_transactions_statement_id.sql` | Nullable `statement_id` FK on `transactions` tying OCR rows to their source statement |
| `0009_chat_sessions_and_memory.sql` | `chat_sessions`, `session_id` on `chat_messages` (with legacy backfill), `user_memories` for extracted facts |
| `0010_profile_context.sql` | `profiles.profile_context` JSONB for persisting enrichment from clarification answers |
| `0011_banks.sql` | `banks` table for multi-tenant bank registration |
| `0012_bank_dashboard.sql` | Dashboard views and aggregates for bank operators |
| `0013_bank_api_keys.sql` | API key management for bank-to-bank integrations |

---

## Deployment

### Render (Recommended for Quick Start)

The repository includes a `render.yaml` Blueprint for one-click deployment:

1. **Push your code to GitHub**

2. **Go to [Render Dashboard](https://dashboard.render.com)**

3. **Click "Blueprints" → "New Blueprint Instance"**

4. **Connect your repository** — Render will detect `render.yaml` and create two services:
   - `klaro-backend` — Node.js/Express API (public Web Service)
   - `klaro-ml` — Python/FastAPI ML sidecar (Private Service)

5. **Set environment variables** in the Render dashboard for both services:

   | Variable | Backend | ML | Source |
   |----------|---------|-----|--------|
   | `NEXT_PUBLIC_SUPABASE_URL` | ✅ | ✅ | Supabase Project Settings |
   | `SUPABASE_SERVICE_ROLE_KEY` | ✅ | ✅ | Supabase Project Settings |
   | `ANTHROPIC_API_KEY` | ✅ | ✅ | [Anthropic Console](https://console.anthropic.com) |
   | `TAVILY_API_KEY` | - | ✅ (optional) | [Tavily](https://tavily.com) |
   | `CREDENTIAL_ENCRYPTION_PUBLIC_KEY` | ✅ | - | Generate locally (see below) |
   | `CREDENTIAL_ENCRYPTION_PRIVATE_KEY` | ✅ | - | Generate locally (see below) |
   | `CORS_ORIGINS` | ✅ | - | Your frontend URL(s) |

6. **Generate RSA keys for credential encryption** (run locally):
   ```bash
   openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:4096 -out private.pem
   openssl pkey -in private.pem -pubout -out public.pem
   # Base64-encode for env vars (no newlines)
   base64 -i private.pem | tr -d '\n'  # → CREDENTIAL_ENCRYPTION_PRIVATE_KEY
   base64 -i public.pem | tr -d '\n'  # → CREDENTIAL_ENCRYPTION_PUBLIC_KEY
   ```

7. **Deploy the frontend** (Vercel recommended):
   ```bash
   cd apps/frontend
   vercel
   ```
   Set `NEXT_PUBLIC_API_BASE_URL` to your Render backend URL.

### Manual Render Setup (without Blueprint)

If you prefer manual service creation:

**Backend Service:**
- **Runtime:** Node
- **Build Command:** `corepack enable && corepack prepare pnpm@9.12.3 --activate && env NODE_ENV=development pnpm install --frozen-lockfile && pnpm --filter @klaro/backend run build`
- **Start Command:** `pnpm --filter @klaro/backend start`
- **Environment Variables:** Set `ML_BASE_URL=http://klaro-ml:8000` (internal Render URL)

**ML Service:**
- **Runtime:** Python 3.11
- **Build Command:** `cd apps/ml && pip install -e ".[ml,kyc,statements]"`
- **Start Command:** `cd apps/ml && uvicorn klaro_ml.main:app --host 0.0.0.0 --port 8000`
- **Type:** Private Service

### Alternative Platforms

- **Frontend**: Vercel (recommended) or Cloudflare Pages
- **Backend**: Fly.io, Railway, or AWS ECS
- **ML**: Cloud Run (GPU optional for heavy inference)
- **Database**: Supabase managed Postgres (already required)
- **Scraper workers**: Run as ephemeral jobs (Cloud Run Jobs / Fly Machines). Never reuse containers across users.

---

## License

MIT — see [`LICENSE`](LICENSE).
