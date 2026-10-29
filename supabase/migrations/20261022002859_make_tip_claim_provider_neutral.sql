-- Keep the claim schema neutral: route providers are versioned data, not an enum
-- that requires a payment-schema migration whenever a provider is introduced.
alter table public.tip_money_operation_claims
  alter column provider type text using provider::text;

alter table public.tip_money_operation_claims
  add constraint tip_money_operation_claims_provider_nonempty
  check (provider is null or nullif(btrim(provider), '') is not null);
