-- =============================================================================
-- Klaro — Bank API keys
--
-- Banks can mint long-lived secret API keys from the dashboard and use them to
-- programmatically query their own consented users via `/api/v1/bank/*`.
--
-- Storage model (industry standard, à la GitHub / Stripe):
--   * Plaintext key is shown to the user EXACTLY ONCE at creation time.
--   * Server stores SHA-256(plaintext) in `key_hash` (binary).
--   * `key_prefix` (first ~12 chars) is stored for UX so the dashboard can
--     show "klaro_live_a3f9…" and the user can identify which key is which.
--   * `last_used_at` is bumped (best-effort) on every successful auth.
--   * Revocation is soft: setting `revoked_at` makes the key fail auth.
--
-- A key is *strictly* scoped to its owning bank — there is no cross-bank
-- access path. The bank_id stamped on the key is the ONLY bank visible to
-- requests authenticated with it.
-- =============================================================================

create table public.bank_api_keys (
  id                uuid primary key default gen_random_uuid(),
  bank_id           uuid not null references public.banks(id) on delete cascade,
  name              text not null check (length(name) between 1 and 80),
  key_prefix        text not null,              -- e.g. "klaro_live_a3f9"
  key_hash          text not null unique,       -- hex(sha256(plaintext))
  scopes            text[] not null default '{read:clients,read:scores,read:transactions,read:statements}'::text[],
  created_by        uuid references auth.users(id) on delete set null,
  created_at        timestamptz not null default now(),
  last_used_at      timestamptz,
  revoked_at        timestamptz
);

create index bank_api_keys_bank_idx
  on public.bank_api_keys(bank_id)
  where revoked_at is null;

create index bank_api_keys_active_hash_idx
  on public.bank_api_keys(key_hash)
  where revoked_at is null;

comment on table public.bank_api_keys is
  'Secret API keys issued to a bank organisation. Plaintext is hashed at rest '
  '(sha256). Only the owning bank can list/revoke its keys via the dashboard; '
  'public /api/v1/bank/* routes authenticate by hashing the X-API-Key header '
  'and looking up the matching active row.';

-- ---------- RLS --------------------------------------------------------------
alter table public.bank_api_keys enable row level security;

-- Bank-role users can read API key metadata for their own bank.
create policy "Bank users can read own api keys"
  on public.bank_api_keys for select
  to authenticated
  using (
    public.has_role('bank')
    and bank_id = public.current_bank_id()
  );

-- All writes go through the backend's service-role client (which validates the
-- caller's bank_id from JWT before inserting). No anon/authenticated insert.
