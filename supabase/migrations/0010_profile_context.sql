-- =============================================================================
-- Klaro — profile_context enrichment column
--
-- Stores free-form context signals that are extracted from a user's
-- clarification answers during the statement review loop, e.g.:
--   { "income_source": "Freelance / remote work",
--     "confirmed_remote_work": true,
--     "income_source_explanation": "Part-time job" }
--
-- These signals feed back into buildUserContext() so every subsequent
-- ML pipeline run (new statement, re-analysis) gets a richer profile
-- without requiring the user to re-answer the same questions.
-- =============================================================================

alter table public.profiles
  add column if not exists profile_context jsonb not null default '{}'::jsonb;

comment on column public.profiles.profile_context is
  'Free-form enrichment signals extracted from clarification answer rounds. '
  'Merged non-destructively: existing keys are overwritten by newer answers, '
  'but structural profile columns (occupation_category etc.) are only written '
  'when they were previously NULL.';
