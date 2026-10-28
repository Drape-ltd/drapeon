-- Phase 3 is dark at rollout: this only makes BACHS a representable provider.
-- No payment route or order is enabled by adding the enum value.
alter type public.payment_provider add value if not exists 'BACHS';
