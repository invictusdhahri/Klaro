-- =============================================================================
-- Klaro — RBAC: app_role enum + helper functions
-- Roles are stored in auth.users.app_metadata.role (set via service-role API).
-- =============================================================================

create type public.app_role as enum ('user', 'bank', 'admin');

create or replace function public.current_user_role()
returns public.app_role
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (auth.jwt() -> 'app_metadata' ->> 'role')::public.app_role,
    'user'::public.app_role
  );
$$;

create or replace function public.has_role(target public.app_role)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_user_role() = target
      or public.current_user_role() = 'admin'::public.app_role;
$$;

-- Banks see only consented users' scores.
create policy "Banks see consented users' scores"
  on public.credit_scores for select
  using (
    public.has_role('bank')
    and exists (
      select 1
      from public.bank_consents bc
      where bc.user_id = credit_scores.user_id
        and bc.consent_granted = true
        and bc.revoked_at is null
    )
  );

create policy "Banks see consented users' profiles"
  on public.profiles for select
  using (
    public.has_role('bank')
    and exists (
      select 1
      from public.bank_consents bc
      where bc.user_id = profiles.id
        and bc.consent_granted = true
        and bc.revoked_at is null
    )
  );
