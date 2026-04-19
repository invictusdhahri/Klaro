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
│   └── ml/             FastAPI Python sidecar (KYC + 3-layer credit scoring)
├── packages/
│   ├── shared/         TS types, Zod schemas, API client, constants
│   ├── ui/             Tiny shared UI helpers (cn, etc.)
│   ├── eslint-config/  Shared ESLint presets
│   └── tsconfig/       Shared tsconfig presets
├── supabase/           Supabase CLI config + SQL migrations
├── infra/docker/       Production Dockerfiles (backend, frontend, ml, scraper)
├── internal_docs/      Architecture & security source-of-truth docs
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
# - apps/backend → http://localhost:4000
# - apps/ml      → http://localhost:8000
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

| Surface                | Path                                       |
| ---------------------- | ------------------------------------------ |
| Marketing              | `/`                                        |
| Auth                   | `/login`, `/register`, `/bank/register`    |
| User app               | `/dashboard`, `/kyc`, `/connect-bank`, `/transactions`, `/documents`, `/chat` |
| Bank operator console  | `/bank`, `/bank/clients`, `/bank/clients/[id]` |
| API health             | `GET http://localhost:4000/health`         |
| ML health              | `GET http://localhost:8000/health`         |

Bank dashboard is gated by `app_metadata.role = 'bank'` plus a non-null `app_metadata.bank_id`. Both fields are populated automatically by the `POST /api/bank/register` flow described above.

---

## Environment variables

See [`.env.example`](.env.example) for the full list. The most important:

| Variable                              | Used by         | Notes                                       |
| ------------------------------------- | --------------- | ------------------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`            | frontend, backend | Public                                      |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY`       | frontend          | Public                                      |
| `SUPABASE_SERVICE_ROLE_KEY`           | backend           | **Server-only.** Never expose to browser.   |
| `ANTHROPIC_API_KEY`                   | backend, ml       | Required for chat + LLM scoring             |
| `ML_BASE_URL`                         | backend           | URL of the FastAPI sidecar                  |
| `NEXT_PUBLIC_API_BASE_URL`            | frontend          | URL of the Express backend                  |
| `CREDENTIAL_ENCRYPTION_PUBLIC_KEY`    | frontend (shipped) | RSA-OAEP public key for bank credentials    |
| `CREDENTIAL_ENCRYPTION_PRIVATE_KEY`   | backend (server) | Decrypts the envelope; **never** logged     |

---

## Documentation

- [`ARCHITECTURE.md`](ARCHITECTURE.md) — web-first system architecture, diagrams, request flows
- [`internal_docs/06_Updated_Architecture_TechStack.md`](internal_docs/06_Updated_Architecture_TechStack.md) — original technical architecture (includes deprecated React Native sections, kept for reference)
- [`internal_docs/05_Security_Vulnerability_Audit.md`](internal_docs/05_Security_Vulnerability_Audit.md) — threat model and mitigations

---

## Deployment (TODO)

- **Frontend**: Vercel (recommended) or Cloud Run.
- **Backend**: Fly.io / Railway / Render. Needs the service-role key in a secret store and the credential-decryption private key mounted at runtime.
- **ML**: Cloud Run (GPU optional). Build the full image with KYC extras enabled (`uv sync --extra ml --extra kyc`).
- **Database**: Supabase managed Postgres.
- **Scraper workers**: Run as ephemeral Cloud Run Jobs / Fly Machines triggered by the backend. Never reuse a container across users.

---

## License

MIT — see [`LICENSE`](LICENSE).
