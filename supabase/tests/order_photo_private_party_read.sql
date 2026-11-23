begin;

-- Contract-only assertions: the private-bucket policy covers every current
-- writer prefix and remains scoped to authenticated callers.
do $$
declare
  policy_expression text;
  upload_expression text;
  policy_roles name[];
  bucket_is_public boolean;
begin
  select public
    into bucket_is_public
  from storage.buckets
  where id = 'order-photos';

  if bucket_is_public is distinct from false then
    raise exception 'order-photos bucket must be private after the release: %', bucket_is_public;
  end if;

  select p.qual, p.roles
    into policy_expression, policy_roles
  from pg_policies p
  where p.schemaname = 'storage'
    and p.tablename = 'objects'
    and p.policyname = 'order-photos: parties can read';

  if policy_expression is null then
    raise exception 'order-photos read policy is missing';
  end if;
  if policy_roles <> array['authenticated'::name] then
    raise exception 'order-photos read policy must be authenticated-only: %', policy_roles;
  end if;
  if position('reference_photos' in policy_expression) = 0 then
    raise exception 'assigned tailor brief-read bridge is missing';
  end if;
  if position('storage/v1/object' in policy_expression) = 0 then
    raise exception 'legacy public/signed URL compatibility is missing';
  end if;
  if position('fabric-receipts' in policy_expression) = 0
    or position('vision-qc' in policy_expression) = 0
    or position('receipts' in policy_expression) = 0 then
    raise exception 'order evidence read prefixes are incomplete';
  end if;

  select with_check
    into upload_expression
  from pg_policies p
  where p.schemaname = 'storage'
    and p.tablename = 'objects'
    and p.policyname = 'order-photos: parties can upload';
  if upload_expression is null
    or position('fabric-receipts' in upload_expression) = 0
    or position('vision-qc' in upload_expression) = 0
    or position('receipts' in upload_expression) = 0 then
    raise exception 'order evidence upload prefixes are incomplete';
  end if;
end;
$$;

rollback;
