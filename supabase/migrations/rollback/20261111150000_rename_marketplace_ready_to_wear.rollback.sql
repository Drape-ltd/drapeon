-- Roll back Edge, web and mobile code first: they send READY_TO_WEAR.
alter type public.marketplace_category rename value 'READY_TO_WEAR' to 'STREETWEAR';

comment on column public.tailor_profiles.marketplace_category is
  'Ops-assigned Explore section. It is independent of seller_type and specialty tags.';
