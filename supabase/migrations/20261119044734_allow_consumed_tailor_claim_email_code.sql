-- Consuming a verified email code preserves when it was verified. The original
-- status/verified_at check allowed only VERIFIED, so prepare failed before it
-- could issue a claim transition receipt.
alter table public.tailor_claim_email_codes
  drop constraint tailor_claim_email_codes_check1;

alter table public.tailor_claim_email_codes
  add constraint tailor_claim_email_codes_verified_status_check
  check ((status in ('VERIFIED', 'CONSUMED')) = (verified_at is not null));

comment on constraint tailor_claim_email_codes_verified_status_check
  on public.tailor_claim_email_codes is
  'A verified timestamp persists when the one-time code is consumed.';
