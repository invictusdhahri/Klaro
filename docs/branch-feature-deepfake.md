# Branch summary: `feature/deepfake`

This document captures the main work on **`feature/deepfake`**: hardened bank-statement verification (including deepfake / document forensics), a critical-thinking reasoner with user clarification, chat sessions with long-term memory, credit-score UX improvements, and the database migrations that support them.

---

## Database (Supabase migrations)

| Migration | Purpose |
|-----------|---------|
| **0007** `statement_review.sql` | Extends `bank_statements` with `reasoning`, `clarification_questions`, `clarification_answers`, `risk_score`, `income_assessment`, and status **`needs_review`**. Indexed for dashboard queries. |
| **0008** `transactions_statement_id.sql` | Adds nullable `statement_id` on `transactions` (FK to `bank_statements`, cascade delete) so OCR rows are tied to their statement and Path-A bank data stays `NULL`. |
| **0009** `chat_sessions_and_memory.sql` | Introduces **`chat_sessions`**, `session_id` on **`chat_messages`** (with legacy backfill), **`user_memories`** for extracted facts, and RLS policies. |
| **0010** `profile_context.sql` | Adds **`profiles.profile_context`** (JSONB) to persist enrichment from clarification answers across later ML runs. |

---

## ML service (`apps/ml`)

### Layer 1 — Deepfake / forensics

- **`statements/deepfake.py`**: Orchestrates PDF structure checks, pixel-level image forensics (ELA, FFT, noise), and a multi-model vision ensemble; CSV/Excel skip visual checks by design.
- **`statements/forensics/`**: Modular bundle — `pdf_structure`, `image_forensics`, `rule_engine`, `vision_ensemble`, etc.

### Later pipeline layers

- **`statements/consistency.py`**, **`statements/income_plausibility.py`**: Consistency and income-plausibility signals (incl. salary-band context where applicable).
- **`data/salary_bands_tn.py`**: Reference data for regional income plausibility.
- **`statements/reasoner.py`**: **Layer 4 reasoner** — rubric-weighted `risk_score`, verdicts (`approved` / `needs_review` / `rejected`), narrative reasoning, per-flag explanations, clarification questions; LLM score clamped so it cannot override deterministic critical signals; targeted re-runs after user answers.

### Scoring & context

- **`scoring/context_builder.py`**, **`scoring/impact_estimator.py`**: Richer user/context assembly for scoring; impact estimation for recommended actions.
- **`scoring/compose.py`**, **`scoring/llm_scorer.py`**, **`routes/score.py`**: Composed scoring and API surface updates.
- **`routes/statements.py`**: Statement pipeline integration (review loop, clarification, persistence expectations).
- **`utils/web_search.py`**: Utility support where the pipeline needs external grounding (as wired in this branch).

Dependencies in **`pyproject.toml`** / **`uv.lock`** were updated to match new capabilities.

---

## Backend (`apps/backend`)

- **`routes/chat.routes.ts`**: Chat **sessions** (get/create, titles), message persistence with `session_id`, **summarization** of stale sessions, **`user_memories`** extraction and injection into advisor context.
- **`routes/documents.routes.ts`**: Document / statement flows aligned with review status, clarification Q&A, and profile context updates.
- **`services/ml.client.ts`**: Calls into updated ML endpoints and payloads.
- **`services/score.service.ts`**: Score retrieval/composition aligned with new breakdown and actions.

---

## Shared package (`packages/shared`)

- **`api/endpoints.ts`**: API route constants for new or changed surfaces.
- **`schemas/chat.schema.ts`**, **`types/chat.ts`**: Session-aware chat types and validation.
- **`types/score.ts`**: Extended score model (e.g. **`ScoreAction`**, richer **`ScoreBreakdown`**).
- **`types/database.generated.ts`**: Regenerated types for new tables/columns.

---

## Frontend (`apps/frontend`)

- **Chat**: **`chat/layout.tsx`**, **`chat/[id]/page.tsx`**, **`chat-sessions-rail.tsx`**, updates to **`chat/page.tsx`**, **`chat-stream.tsx`**, **`message-bubble.tsx`** — multi-session UI, routing per session, streaming aligned with backend session APIs.
- **Documents**: **`documents/page.tsx`** — UX for statement status including review / clarification when applicable.
- **Score dashboard**: **`score-actions.tsx`**, **`score-breakdown.tsx`**, **`score-dashboard-client.tsx`** — actions with expected impact, clearer breakdown presentation.
- **`package.json`** / root **`pnpm-lock.yaml`**: Dependency updates for the above.

---

## How to apply database changes

Run Supabase migrations (or your usual migration workflow) so `0007`–`0010` are applied before deploying backend/ML that depends on the new columns and tables.

---

## Related commit on this line of work

Recent history includes **`feat: align statement processing, authenticity checks, and app flows`** (`1fa53e7`), which sits on top of merges from document upload, dashboard, and bank-console work. The uncommitted changes on this branch add the migrations, forensics bundle, reasoner, chat memory, and UI listed above.
