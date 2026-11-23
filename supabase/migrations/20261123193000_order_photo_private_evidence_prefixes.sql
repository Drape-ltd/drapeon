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
          join public.tailor_profiles tp on tp.id::text = o.tailor_profile_id::text
          where o.id::text = split_part(name, '/', 2)
            and tp.user_id::text = auth.uid()::text
        )
      )
      or (
        split_part(name, '/', 1) = 'receipts'
        and exists (
          select 1 from public.orders o
          where o.id::text = split_part(name, '/', 2)
            and o.customer_id::text = auth.uid()::text
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
          join public.tailor_profiles tp on tp.id::text = o.tailor_profile_id::text
          cross join lateral unnest(coalesce(o.reference_photos, '{}'::text[])) as reference(value)
          where tp.user_id::text = auth.uid()::text
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
          left join public.tailor_profiles tp on tp.id::text = o.tailor_profile_id::text
          where o.id::text = split_part(name, '/', 2)
            and (o.customer_id::text = auth.uid()::text or tp.user_id::text = auth.uid()::text)
        )
      )
      or (
        -- Canonical path: vision-qc/<order-id>/<file>.
        split_part(name, '/', 1) = 'vision-qc'
        and exists (
          select 1
          from public.orders o
          left join public.tailor_profiles tp on tp.id::text = o.tailor_profile_id::text
          where o.id::text in (split_part(name, '/', 2), split_part(name, '/', 3))
            and (o.customer_id::text = auth.uid()::text or tp.user_id::text = auth.uid()::text)
        )
      )
    )
  );
