-- Technical retries and real-world bank operations have different identifiers.
-- A confirmed bank/ledger reference may be counted only once within a case.
create unique index payments_confirmed_reference_unique
  on public.payments (case_id, lower(btrim(payment_reference)))
  where status = 'confirmed' and payment_reference is not null;
