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
      -- Either party on an order may read that order's progress evidence.
      or (
        split_part(name, '/', 1) = 'progress'
        and exists (
          select 1
          from public.orders o
          left join public.tailor_profiles tp on tp.id::text = o.tailor_profile_id::text
          where o.id::text = split_part(name, '/', 2)
            and (
              o.customer_id::text = auth.uid()::text
              or tp.user_id::text = auth.uid()::text
            )
        )
      )
    )
  );
