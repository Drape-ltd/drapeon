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

-- Complete the private order-media policy before the bucket itself is made
-- private. Every browser/mobile writer uses an order-id path after this
-- migration; legacy vision-qc objects retain an explicit read bridge.
--
-- This is policy-only and deliberately does not change storage.buckets.public.

drop policy if exists "order-photos: parties can upload" on storage.objects;
create policy "order-photos: parties can upload"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'order-photos'
    and lower(storage.extension(name)) = any(array['jpg', 'jpeg', 'png', 'webp', 'gif', 'mp4', 'mov'])
    and (
      (
        split_part(name, '/', 1) in ('brief', 'briefs')
        and split_part(name, '/', 2) = auth.uid()::text
      )
      or (
        split_part(name, '/', 1) in ('progress', 'fabric-receipts', 'vision-qc')
        and exists (
          select 1
          from public.orders o
          join public.tailor_profiles tp on tp.id = o.tailor_profile_id
          where o.id = case when split_part(name, '/', 2) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then split_part(name, '/', 2)::uuid else null end
            and tp.user_id = auth.uid()
        )
      )
      or (
        split_part(name, '/', 1) = 'receipts'
        and exists (
          select 1 from public.orders o
          where o.id = case when split_part(name, '/', 2) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then split_part(name, '/', 2)::uuid else null end
            and o.customer_id = auth.uid()
        )
      )
    )
  );

drop policy if exists "order-photos: parties can read" on storage.objects;
create policy "order-photos: parties can read"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'order-photos'
    and (
      (
        split_part(name, '/', 1) in ('brief', 'briefs')
        and split_part(name, '/', 2) = auth.uid()::text
      )
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
      or (
        split_part(name, '/', 1) in ('progress', 'receipts', 'fabric-receipts')
        and exists (
          select 1
          from public.orders o
          left join public.tailor_profiles tp on tp.id = o.tailor_profile_id
          where o.id = case when split_part(name, '/', 2) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then split_part(name, '/', 2)::uuid else null end
            and (o.customer_id = auth.uid() or tp.user_id = auth.uid())
        )
      )
      or (
        -- Canonical path: vision-qc/<order-id>/<file>.
        split_part(name, '/', 1) = 'vision-qc'
        and exists (
          select 1
          from public.orders o
          left join public.tailor_profiles tp on tp.id = o.tailor_profile_id
          where (o.id = case when split_part(name, '/', 2) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then split_part(name, '/', 2)::uuid else null end or o.id = case when split_part(name, '/', 3) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then split_part(name, '/', 3)::uuid else null end)
            and (o.customer_id = auth.uid() or tp.user_id = auth.uid())
        )
      )
    )
  );
