-- =============================================================================
-- Klaro — Statement review fields (Layer 4 reasoner + clarification loop)
-- Adds the columns and status value needed by the hardened /documents pipeline:
--   * reasoning             — narrative summary, per-flag explanations, rubric
--   * clarification_questions — questions surfaced to the user
--   * clarification_answers — answers the user has submitted so far
--   * risk_score            — final 0-1 risk after the reasoner
--   * income_assessment     — denormalised L3.5 result for fast bank-side queries
--   * status: needs_review  — new state when the user must answer questions
-- =============================================================================

alter table public.bank_statements
  add column if not exists reasoning              jsonb not null default '{}'::jsonb,
  add column if not exists clarification_questions jsonb not null default '[]'::jsonb,
  add column if not exists clarification_answers   jsonb not null default '[]'::jsonb,
  add column if not exists risk_score              double precision
                              check (risk_score is null or risk_score between 0 and 1),
  add column if not exists income_assessment       jsonb not null default '{}'::jsonb;

-- Replace the status check constraint to add 'needs_review'.
alter table public.bank_statements drop constraint if exists bank_statements_status_check;

alter table public.bank_statements
  add constraint bank_statements_status_check
  check (status in (
    'pending',
    'processing',
    'processed',
    'needs_review',
    'verification_failed',
    'failed'
  ));

-- Index for the bank/admin dashboard view that lists items waiting on the user.
create index if not exists bank_statements_user_needs_review_idx
  on public.bank_statements(user_id, status)
  where status = 'needs_review';

-- Comment for future maintainers: see apps/ml/src/klaro_ml/statements/reasoner.py
-- for the rubric that produces `risk_score` and the clamp that prevents the LLM
-- from overriding deterministic critical thinking.
