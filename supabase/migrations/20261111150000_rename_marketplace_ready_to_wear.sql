-- The secondary Explore placement is "Ready-to-wear", not a single style.
-- Renaming the enum value keeps every existing row; no function, view, policy
-- or check references the old label (verified on Dev before this migration).
alter type public.marketplace_category rename value 'STREETWEAR' to 'READY_TO_WEAR';

comment on column public.tailor_profiles.marketplace_category is
  'Ops-assigned Explore placement: TAILORING (Tailors) or READY_TO_WEAR (Ready-to-wear). Independent of seller_type and specialty tags.';
