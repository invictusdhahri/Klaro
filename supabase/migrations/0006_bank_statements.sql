-- =============================================================================
-- Klaro — bank_statements table
-- Stores uploaded bank statement files (Path B: manual upload alternative).
-- Tracks verification pipeline results and extracted transaction counts.
-- =============================================================================

create table public.bank_statements (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references public.profiles(id) on delete cascade,

  -- File metadata
  file_name           text not null,
  mime_type           text not null,
  storage_path        text not null,
  file_hash           text not null,            -- sha-256, used for dedup

  -- Processing state
  status              text not null default 'pending'
    check (status in ('pending', 'processing', 'processed', 'verification_failed', 'failed')),
  error_message       text,

  -- Extraction results (populated after processing)
  extracted_count     integer not null default 0,
  coherence_score     double precision check (coherence_score between 0 and 1),

  -- Full pipeline reports (jsonb for flexibility)
  verification_report jsonb not null default '{}'::jsonb,
  anomaly_report      jsonb not null default '{}'::jsonb,

  created_at          timestamptz not null default now(),

  unique (user_id, file_hash)
);

create index bank_statements_user_created_idx on public.bank_statements(user_id, created_at desc);
create index bank_statements_user_status_idx  on public.bank_statements(user_id, status);

-- ---------------------------------------------------------------------------
-- RLS — users can only see / manage their own statements
-- ---------------------------------------------------------------------------

alter table public.bank_statements enable row level security;

create policy "Users see own bank statements"
  on public.bank_statements
  for all
  using (auth.uid() = user_id);
