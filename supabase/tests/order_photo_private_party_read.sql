begin;

-- Contract-only assertions: the policy has exactly the two brief-read paths
-- needed for a private bucket, and remains scoped to authenticated callers.
do $$
declare
  policy_expression text;
  roles name[];
begin
  select qual, roles
    into policy_expression, roles
  from pg_policies
  where schemaname = 'storage'
    and tablename = 'objects'
    and policyname = 'order-photos: parties can read';

  if policy_expression is null then
    raise exception 'order-photos read policy is missing';
  end if;
  if roles <> array['authenticated'::name] then
    raise exception 'order-photos read policy must be authenticated-only: %', roles;
  end if;
  if position('reference_photos' in policy_expression) = 0 then
    raise exception 'assigned tailor brief-read bridge is missing';
  end if;
  if position('storage/v1/object' in policy_expression) = 0 then
    raise exception 'legacy public/signed URL compatibility is missing';
  end if;
end;
$$;

rollback;
