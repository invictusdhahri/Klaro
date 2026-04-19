-- =============================================================================
-- Klaro — Bank portal helpers
-- get_bank_clients: SECURITY DEFINER function — bypasses RLS to join
-- bank_consents → profiles → credit_scores safely for a given bank_id.
-- =============================================================================

create or replace function public.get_bank_clients(p_bank_id uuid)
returns table (
  user_id       uuid,
  full_name     text,
  kyc_status    text,
  score         integer,
  score_band    text,
  consent_scope text[],
  granted_at    timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    p.id            as user_id,
    p.full_name,
    p.kyc_status,
    cs.score,
    cs.score_band,
    bc.consent_scope,
    bc.granted_at
  from bank_consents bc
  join profiles p on p.id = bc.user_id
  left join lateral (
    select score, score_band
    from credit_scores
    where user_id = bc.user_id
    order by created_at desc
    limit 1
  ) cs on true
  where bc.bank_id = p_bank_id
    and bc.consent_granted = true
    and bc.revoked_at is null;
$$;

-- Only the service role (backend) may call this function directly.
revoke execute on function public.get_bank_clients(uuid) from public, anon, authenticated;
grant  execute on function public.get_bank_clients(uuid) to service_role;
