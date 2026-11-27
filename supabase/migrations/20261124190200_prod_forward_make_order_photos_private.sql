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

-- The code and Storage policies for authenticated signed order-media URLs are
-- already deployed before this switch. This release unit intentionally changes
-- only the bucket's delivery mode; it neither broadens Storage policies nor
-- rewrites stored references.
--
-- This migration is deliberately timestamped after the two order-photo policy
-- migrations (20261123190000 and 20261123193000). A clean replay must never
-- privatize the bucket before those authorization rules exist.
--
-- Recovery is a forward compatibility repair, never a broad return to public
-- media. Do not set this bucket public again as a rollback mechanism.

do $$
begin
  if not exists (
    select 1
    from storage.buckets
    where id = 'order-photos'
  ) then
    raise exception 'order-photos bucket is missing; refuse private-mode switch';
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'order-photos: parties can read') or not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'order-photos: parties can upload') then
    raise exception 'ORDER_PHOTOS_PARTY_POLICIES_MISSING';
  end if;

  update storage.buckets
  set public = false
  where id = 'order-photos'
    and public is distinct from false;

  if not exists (
    select 1
    from storage.buckets
    where id = 'order-photos'
      and public = false
  ) then
    raise exception 'order-photos bucket was not made private';
  end if;
end;
$$;
