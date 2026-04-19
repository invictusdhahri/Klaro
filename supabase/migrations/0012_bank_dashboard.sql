-- =============================================================================
-- Klaro — Bank dashboard RLS + RPCs
--
--  * Tightens get_bank_clients to use banks.id (semantics already match — the
--    function is unchanged in shape but now p_bank_id is a banks.id).
--  * Adds get_bank_dashboard_stats(p_bank_id) for the new dashboard home.
--  * Adds bank-role SELECT policies on bank_statements and transactions
--    (consent + bank_id match).
-- =============================================================================

-- ---------- Bank-role SELECT policies on statements/transactions ------------

create policy "Banks see consented users' bank statements"
  on public.bank_statements for select
  using (
    public.has_role('bank')
    and bank_id = public.current_bank_id()
    and exists (
      select 1
      from public.bank_consents bc
      where bc.user_id = bank_statements.user_id
        and bc.bank_id = public.current_bank_id()
        and bc.consent_granted = true
        and bc.revoked_at is null
    )
  );

create policy "Banks see consented users' transactions"
  on public.transactions for select
  using (
    public.has_role('bank')
    and bank_id = public.current_bank_id()
    and exists (
      select 1
      from public.bank_consents bc
      where bc.user_id = transactions.user_id
        and bc.bank_id = public.current_bank_id()
        and bc.consent_granted = true
        and bc.revoked_at is null
    )
  );

create policy "Banks see consented users' anomaly flags"
  on public.anomaly_flags for select
  using (
    public.has_role('bank')
    and exists (
      select 1
      from public.bank_consents bc
      where bc.user_id = anomaly_flags.user_id
        and bc.bank_id = public.current_bank_id()
        and bc.consent_granted = true
        and bc.revoked_at is null
    )
  );

-- ---------- get_bank_dashboard_stats ----------------------------------------
-- One-shot aggregate for the dashboard home. SECURITY DEFINER so the backend
-- (service role) can call it cheaply with a single round-trip.

create or replace function public.get_bank_dashboard_stats(p_bank_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_total_clients              integer;
  v_avg_score                  numeric;
  v_score_distribution         jsonb;
  v_kyc_pass_rate              numeric;
  v_statements_processing      integer;
  v_statements_needs_review    integer;
  v_statements_processed       integer;
  v_anomaly_count_30d          integer;
  v_recent_uploads             jsonb;
begin
  -- Distinct consented client ids for this bank
  with client_ids as (
    select distinct bc.user_id
    from public.bank_consents bc
    where bc.bank_id = p_bank_id
      and bc.consent_granted = true
      and bc.revoked_at is null
  ),
  latest_score as (
    select cs.user_id, cs.score, cs.score_band
    from public.credit_scores cs
    join client_ids ci on ci.user_id = cs.user_id
    where cs.created_at = (
      select max(created_at)
      from public.credit_scores
      where user_id = cs.user_id
    )
  )
  select
    (select count(*) from client_ids),
    (select avg(score) from latest_score),
    coalesce(
      (
        select jsonb_object_agg(coalesce(score_band, 'UNSCORED'), n)
        from (
          select score_band, count(*) as n
          from latest_score
          group by score_band
        ) t
      ),
      '{}'::jsonb
    ),
    (
      select case when count(*) = 0 then 0
                  else (count(*) filter (where p.kyc_status = 'verified'))::numeric
                       / count(*)::numeric
             end
      from public.profiles p
      join client_ids ci on ci.user_id = p.id
    )
  into v_total_clients, v_avg_score, v_score_distribution, v_kyc_pass_rate;

  -- Statement pipeline counts (only this bank's stamped rows)
  select
    count(*) filter (where status = 'processing'),
    count(*) filter (where status = 'needs_review'),
    count(*) filter (where status = 'processed')
  into v_statements_processing, v_statements_needs_review, v_statements_processed
  from public.bank_statements
  where bank_id = p_bank_id;

  -- Anomalies opened in the last 30 days for consented clients
  select count(*)
  into v_anomaly_count_30d
  from public.anomaly_flags af
  join public.bank_consents bc on bc.user_id = af.user_id
  where bc.bank_id = p_bank_id
    and bc.consent_granted = true
    and bc.revoked_at is null
    and af.created_at > now() - interval '30 days';

  -- Last 5 uploads (denormalized list for the dashboard)
  select coalesce(
    jsonb_agg(row_to_json(t) order by t.created_at desc),
    '[]'::jsonb
  )
  into v_recent_uploads
  from (
    select bs.id,
           bs.user_id,
           p.full_name,
           bs.file_name,
           bs.status,
           bs.created_at
    from public.bank_statements bs
    join public.profiles p on p.id = bs.user_id
    where bs.bank_id = p_bank_id
    order by bs.created_at desc
    limit 5
  ) t;

  return jsonb_build_object(
    'totalClients',          v_total_clients,
    'avgScore',              v_avg_score,
    'scoreDistribution',     v_score_distribution,
    'kycPassRate',           v_kyc_pass_rate,
    'statementsProcessing',  v_statements_processing,
    'statementsNeedsReview', v_statements_needs_review,
    'statementsProcessed',   v_statements_processed,
    'anomalyCount30d',       v_anomaly_count_30d,
    'recentUploads',         v_recent_uploads
  );
end;
$$;

revoke execute on function public.get_bank_dashboard_stats(uuid) from public, anon, authenticated;
grant  execute on function public.get_bank_dashboard_stats(uuid) to service_role;

comment on function public.get_bank_dashboard_stats(uuid) is
  'Aggregated dashboard payload for a single bank (consented clients only). '
  'Service-role only — the backend resolves the caller bank from JWT.';
