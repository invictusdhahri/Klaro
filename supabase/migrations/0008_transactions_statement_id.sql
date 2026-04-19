-- =============================================================================
-- Klaro — Link transactions to their source bank_statement
--
-- Adds `statement_id` (nullable FK with CASCADE DELETE) to `transactions` so:
--   1. OCR-extracted transactions are cleaned up when their statement is deleted.
--   2. We can guard against double-insertion if a statement is re-approved.
--   3. Path-A (bank-connection) transactions are unaffected (statement_id stays NULL).
-- =============================================================================

alter table public.transactions
  add column if not exists statement_id uuid
    references public.bank_statements(id) on delete cascade;

create index if not exists transactions_statement_id_idx
  on public.transactions(statement_id)
  where statement_id is not null;
