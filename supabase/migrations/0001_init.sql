-- =============================================================================
-- Klaro — initial schema
-- Tables: profiles, kyc_documents, bank_connections, transactions,
--         credit_scores, anomaly_flags, bank_consents, chat_messages, audit_logs
-- =============================================================================

create extension if not exists "pgcrypto";

-- ---------- profiles --------------------------------------------------------
create table public.profiles (
  id uuid references auth.users(id) on delete cascade primary key,
  full_name text not null,
  date_of_birth date,
  age integer generated always as (extract(year from age(date_of_birth))::int) stored,
  occupation text,
  occupation_category text check (
    occupation_category in (
      'student','salaried','freelance','business_owner','unemployed','retired'
    )
  ),
  education_level text,
  location_governorate text,
  location_country text default 'TN',
  phone text,
  kyc_status text not null default 'pending'
    check (kyc_status in ('pending','verified','flagged','rejected')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index profiles_kyc_status_idx on public.profiles(kyc_status);

-- ---------- kyc_documents ---------------------------------------------------
create table public.kyc_documents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  document_type text not null
    check (document_type in ('cin','passport','driver_license','proof_of_address')),
  storage_path text not null,
  ocr_data jsonb,
  deepfake_score double precision check (deepfake_score between 0 and 1),
  authenticity_score double precision check (authenticity_score between 0 and 1),
  consistency_score double precision check (consistency_score between 0 and 1),
  verification_status text not null default 'pending'
    check (verification_status in ('pending','verified','flagged','rejected')),
  document_hash text not null,
  created_at timestamptz not null default now(),
  unique (user_id, document_hash)
);

create index kyc_documents_user_idx on public.kyc_documents(user_id);

-- ---------- bank_connections ------------------------------------------------
create table public.bank_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  bank_name text not null,
  connection_method text not null
    check (connection_method in ('scraping','manual_upload')),
  last_sync_at timestamptz,
  sync_status text not null default 'pending'
    check (sync_status in ('pending','syncing','success','failed')),
  account_count integer not null default 0,
  created_at timestamptz not null default now()
);

create index bank_connections_user_idx on public.bank_connections(user_id);

-- ---------- transactions ----------------------------------------------------
create table public.transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  bank_connection_id uuid references public.bank_connections(id) on delete set null,
  transaction_date date not null,
  amount numeric(14, 3) not null,
  currency text not null default 'TND',
  transaction_type text not null check (transaction_type in ('credit','debit')),
  category text,
  description text,
  counterparty text,
  source text not null check (source in ('scraped','manual_upload','ocr_extracted')),
  created_at timestamptz not null default now()
);

create index transactions_user_date_idx on public.transactions(user_id, transaction_date desc);
create index transactions_user_category_idx on public.transactions(user_id, category);

-- ---------- credit_scores ---------------------------------------------------
create table public.credit_scores (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  score integer not null check (score between 0 and 1000),
  score_band text check (score_band in ('POOR','FAIR','GOOD','VERY_GOOD','EXCELLENT')),
  confidence double precision check (confidence between 0 and 1),
  risk_category text check (risk_category in ('low','medium','high','very_high')),
  data_sufficiency double precision check (data_sufficiency between 0 and 1),
  breakdown jsonb not null default '{}'::jsonb,
  feature_importance jsonb not null default '{}'::jsonb,
  flags jsonb not null default '[]'::jsonb,
  recommendations jsonb not null default '[]'::jsonb,
  data_gaps jsonb not null default '[]'::jsonb,
  model_version text not null,
  created_at timestamptz not null default now()
);

create index credit_scores_user_created_idx on public.credit_scores(user_id, created_at desc);

-- ---------- anomaly_flags ---------------------------------------------------
create table public.anomaly_flags (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  flag_type text not null,
  severity text not null check (severity in ('low','medium','high','critical')),
  description text,
  evidence jsonb,
  resolution_status text not null default 'open'
    check (resolution_status in ('open','resolved','dismissed')),
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);

create index anomaly_flags_user_status_idx on public.anomaly_flags(user_id, resolution_status);

-- ---------- bank_consents ---------------------------------------------------
create table public.bank_consents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  bank_id uuid not null,
  consent_granted boolean not null default false,
  consent_scope text[] not null default '{}',
  granted_at timestamptz,
  revoked_at timestamptz,
  unique (user_id, bank_id)
);

create index bank_consents_bank_idx on public.bank_consents(bank_id);

-- ---------- chat_messages ---------------------------------------------------
create table public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null check (role in ('user','assistant','system')),
  content text not null,
  context_snapshot jsonb,
  created_at timestamptz not null default now()
);

create index chat_messages_user_created_idx on public.chat_messages(user_id, created_at desc);

-- ---------- audit_logs ------------------------------------------------------
create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_type text not null check (actor_type in ('user','bank','system','admin')),
  actor_id uuid not null,
  action text not null,
  resource_type text,
  resource_id uuid,
  metadata jsonb,
  ip_address inet,
  created_at timestamptz not null default now()
);

create index audit_logs_actor_idx on public.audit_logs(actor_id, created_at desc);

-- ---------- profile auto-create trigger -------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)));
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ---------- updated_at trigger ----------------------------------------------
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_touch_updated_at
  before update on public.profiles
  for each row execute procedure public.touch_updated_at();

-- ---------- RLS -------------------------------------------------------------
alter table public.profiles         enable row level security;
alter table public.kyc_documents    enable row level security;
alter table public.bank_connections enable row level security;
alter table public.transactions     enable row level security;
alter table public.credit_scores    enable row level security;
alter table public.anomaly_flags    enable row level security;
alter table public.bank_consents    enable row level security;
alter table public.chat_messages    enable row level security;
alter table public.audit_logs       enable row level security;

create policy "Users see own profile"
  on public.profiles for all
  using (auth.uid() = id)
  with check (auth.uid() = id);

create policy "Users see own kyc documents"
  on public.kyc_documents for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users see own bank connections"
  on public.bank_connections for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users see own transactions"
  on public.transactions for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users see own scores"
  on public.credit_scores for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users see own anomaly flags"
  on public.anomaly_flags for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users see own consents"
  on public.bank_consents for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users see own chat messages"
  on public.chat_messages for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- audit_logs are service-role only by default (no policies).
