-- =============================================================================
-- Klaro — storage buckets + policies
-- =============================================================================

insert into storage.buckets (id, name, public)
values
  ('kyc-docs', 'kyc-docs', false),
  ('bank-statements', 'bank-statements', false),
  ('selfies', 'selfies', false)
on conflict (id) do nothing;

-- Path convention: <bucket>/<user_id>/<filename>
-- All access scoped to the owning user.

create policy "kyc-docs: owner read"
  on storage.objects for select
  using (
    bucket_id = 'kyc-docs'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

create policy "kyc-docs: owner insert"
  on storage.objects for insert
  with check (
    bucket_id = 'kyc-docs'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

create policy "kyc-docs: owner delete"
  on storage.objects for delete
  using (
    bucket_id = 'kyc-docs'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

create policy "bank-statements: owner read"
  on storage.objects for select
  using (
    bucket_id = 'bank-statements'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

create policy "bank-statements: owner insert"
  on storage.objects for insert
  with check (
    bucket_id = 'bank-statements'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

create policy "bank-statements: owner delete"
  on storage.objects for delete
  using (
    bucket_id = 'bank-statements'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

create policy "selfies: owner read"
  on storage.objects for select
  using (
    bucket_id = 'selfies'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

create policy "selfies: owner insert"
  on storage.objects for insert
  with check (
    bucket_id = 'selfies'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

create policy "selfies: owner delete"
  on storage.objects for delete
  using (
    bucket_id = 'selfies'
    and auth.uid()::text = (storage.foldername(name))[1]
  );
