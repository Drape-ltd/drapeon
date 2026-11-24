-- Production-forward privacy release. The old Dev source versions are not replayed.
-- Require a Production-only ledger marker and UUID order/profile identities.
do $prod_guard$
begin
  if not exists (select 1 from supabase_migrations.schema_migrations where version = '20261124170000')
     or (select atttypid from pg_attribute where attrelid = 'public.orders'::regclass and attname = 'id' and not attisdropped) <> 'uuid'::regtype
     or (select atttypid from pg_attribute where attrelid = 'public.tailor_profiles'::regclass and attname = 'id' and not attisdropped) <> 'uuid'::regtype then
    raise exception 'ORDER_PHOTOS_PRODUCTION_ENVIRONMENT_GUARD';
  end if;
  if not exists (select 1 from storage.buckets where id = 'order-photos') then
    raise exception 'ORDER_PHOTOS_BUCKET_MISSING';
  end if;
end
$prod_guard$;

-- Keep order-media private without removing an assigned tailor's access to a
-- customer's brief reference files. Existing objects may contain either a bare
-- path or a legacy public/signed delivery URL in orders.reference_photos.
--
-- This is intentionally policy-only. The later bucket-private migration is a
-- separate release unit after every reader/writer has been verified in Dev.

drop policy if exists "order-photos: parties can read" on storage.objects;
create policy "order-photos: parties can read"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'order-photos'
    and (
      -- The customer may always read their own draft/brief assets.
      (
        split_part(name, '/', 1) in ('brief', 'briefs')
        and split_part(name, '/', 2) = auth.uid()::text
      )
      -- The assigned tailor may read only the exact brief asset attached to an
      -- order assigned to them. This supports both bare paths and the legacy
      -- public/signed object URLs stored before the private-media rollout.
      or (
        split_part(name, '/', 1) in ('brief', 'briefs')
        and exists (
          select 1
          from public.orders o
          join public.tailor_profiles tp on tp.id = o.tailor_profile_id
          cross join lateral unnest(coalesce(o.reference_photos, '{}'::text[])) as reference(value)
          where tp.user_id = auth.uid()
            and regexp_replace(
              regexp_replace(
                regexp_replace(reference.value, '^.*/storage/v1/object/(public|sign)/order-photos/', ''),
                '[?#].*$',
                ''
              ),
              '^/?order-photos/',
              ''
            ) = name
        )
      )
      -- Either party on an order may read that order's progress evidence.
      or (
        split_part(name, '/', 1) = 'progress'
        and exists (
          select 1
          from public.orders o
          left join public.tailor_profiles tp on tp.id = o.tailor_profile_id
          where o.id = case when split_part(name, '/', 2) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then split_part(name, '/', 2)::uuid else null end
            and (
              o.customer_id = auth.uid()
              or tp.user_id = auth.uid()
            )
        )
      )
    )
  );
