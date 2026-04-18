# Klaro

> Alternative credit scoring for Tunisia. KYC, bank insights, and an AI advisor that knows you better than you know yourself.

Klaro is a web-first platform that builds a transparent, AI-powered credit score from a user's KYC documents, bank activity, and payment behavior — without depending on credit bureau gatekeeping.

This repository is a **pnpm + Turborepo monorepo** containing the Next.js web app, the Express API, the Python FastAPI ML sidecar, and shared TypeScript packages, all wired to Supabase.

> **Note:** The originally planned React Native mobile app has been deferred. The monorepo is structured so a future `apps/mobile` can consume the same `packages/shared` and back-end services without changes.

---

## Repository layout

```
Klaro/
├── apps/
│   ├── web/            Next.js 15 (App Router) — user app + bank dashboard
│   ├── api/            Express.js + TypeScript API
│   └── ml/             FastAPI Python sidecar (KYC + 3-layer credit scoring)
├── packages/
│   ├── shared/         TS types, Zod schemas, API client, constants
│   ├── ui/             Tiny shared UI helpers (cn, etc.)
│   ├── eslint-config/  Shared ESLint presets
│   └── tsconfig/       Shared tsconfig presets
├── supabase/           Supabase CLI config + SQL migrations
├── infra/docker/       Production Dockerfiles (api, web, ml, scraper)
├── internal_docs/      Architecture & security source-of-truth docs
├── docker-compose.yml  Local dev orchestration for api + ml
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
# - apps/web → http://localhost:3000
# - apps/api → http://localhost:4000
# - apps/ml  → http://localhost:8000
```

Supabase Studio (local): <http://127.0.0.1:54323>

### Run via Docker

```bash
docker compose up --build
```

This brings up the API and ML sidecar in containers. The Next.js app stays in `pnpm dev` for fast iteration.

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
| Auth                   | `/login`, `/register`                      |
| User app               | `/dashboard`, `/kyc`, `/connect-bank`, `/transactions`, `/documents`, `/chat` |
| Bank operator console  | `/bank/clients`, `/bank/clients/[id]`      |
| API health             | `GET http://localhost:4000/health`         |
| ML health              | `GET http://localhost:8000/health`         |

Bank dashboard is gated by `app_metadata.role = 'bank'` on the Supabase user. Promote a user via the service-role API or Supabase Studio.

---

## Environment variables

See [`.env.example`](.env.example) for the full list. The most important:

| Variable                              | Used by         | Notes                                       |
| ------------------------------------- | --------------- | ------------------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`            | web, api        | Public                                      |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY`       | web             | Public                                      |
| `SUPABASE_SERVICE_ROLE_KEY`           | api             | **Server-only.** Never expose to browser.   |
| `ANTHROPIC_API_KEY`                   | api, ml         | Required for chat + LLM scoring             |
| `ML_BASE_URL`                         | api             | URL of the FastAPI sidecar                  |
| `NEXT_PUBLIC_API_BASE_URL`            | web             | URL of the Express API                      |
| `CREDENTIAL_ENCRYPTION_PUBLIC_KEY`    | web (shipped)   | RSA-OAEP public key for bank credentials    |
| `CREDENTIAL_ENCRYPTION_PRIVATE_KEY`   | api (server)    | Decrypts the envelope; **never** logged     |

---

## Documentation

- [`ARCHITECTURE.md`](ARCHITECTURE.md) — web-first system architecture, diagrams, request flows
- [`internal_docs/06_Updated_Architecture_TechStack.md`](internal_docs/06_Updated_Architecture_TechStack.md) — original technical architecture (includes deprecated React Native sections, kept for reference)
- [`internal_docs/05_Security_Vulnerability_Audit.md`](internal_docs/05_Security_Vulnerability_Audit.md) — threat model and mitigations

---

## Deployment (TODO)

- **Web**: Vercel (recommended) or Cloud Run.
- **API**: Fly.io / Railway / Render. Needs the service-role key in a secret store and the credential-decryption private key mounted at runtime.
- **ML**: Cloud Run (GPU optional). Build the full image with KYC extras enabled (`uv sync --extra ml --extra kyc`).
- **Database**: Supabase managed Postgres.
- **Scraper workers**: Run as ephemeral Cloud Run Jobs / Fly Machines triggered by the API. Never reuse a container across users.

---

## License

MIT — see [`LICENSE`](LICENSE).
