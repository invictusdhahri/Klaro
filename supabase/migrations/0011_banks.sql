-- =============================================================================
-- Klaro — Bank entity (banks catalog) + bank_users join + denormalized bank_id
--
-- Until now, "bank_id" in `bank_consents` was implicitly the auth.users.id of
-- a bank-role principal — i.e. one Supabase auth user == one bank. This made
-- multi-staff banks, branding, and per-bank dashboards awkward.
--
-- This migration introduces a proper `public.banks` catalog plus a
-- `public.bank_users` join table so that:
--
--   * Multiple Supabase users can belong to a single bank organisation.
--   * Bank-role JWTs carry their `bank_id` in `app_metadata.bank_id`.
--   * `bank_consents.bank_id`, `bank_connections.bank_id`,
--     `bank_statements.bank_id` and `transactions.bank_id` all reference
--     `public.banks(id)` consistently.
--
-- Existing rows in `bank_consents` (where `bank_id` was an auth.users.id)
-- are migrated to point at synthetic banks rows so nothing is lost. Any
-- consents whose original principal cannot be resolved are dropped.
-- =============================================================================

-- ---------- banks -----------------------------------------------------------
create table public.banks (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null unique,
  name        text not null,
  logo_url    text,
  country     text not null default 'TN',
  created_at  timestamptz not null default now()
);

create index banks_country_idx on public.banks(country);

comment on table public.banks is
  'Catalog of bank organisations. A single bank can have many bank-role '
  'auth users (see bank_users). All bank-scoped resources reference banks(id).';

-- ---------- bank_users ------------------------------------------------------
create table public.bank_users (
  bank_id    uuid not null references public.banks(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  role       text not null default 'analyst' check (role in ('admin', 'analyst')),
  created_at timestamptz not null default now(),
  primary key (bank_id, user_id)
);

create index bank_users_user_idx on public.bank_users(user_id);

comment on table public.bank_users is
  'Maps Supabase auth users (with app_role=bank) to bank organisations.';

-- ---------- helper: current_bank_id() ---------------------------------------
-- Reads bank_id from the JWT app_metadata. Returns NULL for non-bank principals.
create or replace function public.current_bank_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select nullif(auth.jwt() -> 'app_metadata' ->> 'bank_id', '')::uuid;
$$;

-- ---------- bank_id on existing tables --------------------------------------
-- Nullable for now: existing rows have no bank attribution. New rows will
-- always be stamped by the backend when the user's bank can be resolved.

alter table public.bank_connections
  add column if not exists bank_id uuid references public.banks(id) on delete set null;

create index if not exists bank_connections_bank_idx
  on public.bank_connections(bank_id)
  where bank_id is not null;

-- Allow upsert(user_id, bank_id) for the scraping orchestrator. NULL bank_ids
-- are excluded so legacy rows without a resolved bank don't collide.
create unique index if not exists bank_connections_user_bank_unique
  on public.bank_connections(user_id, bank_id)
  where bank_id is not null;

alter table public.bank_statements
  add column if not exists bank_id uuid references public.banks(id) on delete set null;

create index if not exists bank_statements_bank_idx
  on public.bank_statements(bank_id)
  where bank_id is not null;

alter table public.transactions
  add column if not exists bank_id uuid references public.banks(id) on delete set null;

create index if not exists transactions_bank_idx
  on public.transactions(bank_id)
  where bank_id is not null;

-- ---------- bank_consents.bank_id semantics migration -----------------------
-- Existing rows used auth.users.id as bank_id. Create one banks row per
-- distinct legacy principal so no consent data is lost, then point
-- bank_consents.bank_id at the new banks(id).

with legacy_principals as (
  select distinct bc.bank_id as legacy_auth_id
  from public.bank_consents bc
  left join public.banks b on b.id = bc.bank_id
  where b.id is null  -- only treat ids that aren't already banks rows
),
inserted as (
  insert into public.banks (id, slug, name, country)
  select
    legacy_auth_id,
    'legacy-' || substring(legacy_auth_id::text from 1 for 8),
    'Legacy bank ' || substring(legacy_auth_id::text from 1 for 8),
    'TN'
  from legacy_principals
  on conflict (id) do nothing
  returning id
)
select count(*) from inserted;

-- Now we can safely add the FK.
alter table public.bank_consents
  drop constraint if exists bank_consents_bank_id_fkey;

alter table public.bank_consents
  add constraint bank_consents_bank_id_fkey
  foreign key (bank_id) references public.banks(id) on delete cascade;

-- ---------- RLS on the new tables -------------------------------------------
alter table public.banks      enable row level security;
alter table public.bank_users enable row level security;

-- Anyone authenticated can read the bank catalog (logos, names, slugs).
create policy "Authenticated can read banks"
  on public.banks for select
  to authenticated
  using (true);

-- Bank users can see their own membership row.
create policy "Bank users see own membership"
  on public.bank_users for select
  to authenticated
  using (user_id = auth.uid());

-- (No INSERT/UPDATE/DELETE policies → service role only for both tables.)
