-- Provider bounces and complaints are keyed by a privacy-safe recipient hash.
-- Keep the optional-email gate fast without storing the recipient address.
create index if not exists communication_suppressions_address_lookup_idx
  on public.communication_suppressions (address_hash, channel, purpose)
  where active and address_hash is not null;
