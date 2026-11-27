do $$ begin
  if (select public from storage.buckets where id='order-photos') then raise exception 'bucket remains public'; end if;
  if (select count(*) from pg_policies where schemaname='storage' and tablename='objects' and policyname in ('order-photos: parties can read','order-photos: parties can upload')) <> 2 then raise exception 'party policies missing'; end if;
end $$;

begin;
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000002';
do $$ begin
  if (select count(*) from storage.objects where bucket_id='order-photos') <> 4 then raise exception 'customer lost order-media read'; end if;
end $$;
rollback;

begin;
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000004';
do $$ begin
  if (select count(*) from storage.objects where bucket_id='order-photos') <> 4 then raise exception 'assigned tailor lost order-media read'; end if;
end $$;
rollback;

begin;
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000099';
do $$ begin
  if (select count(*) from storage.objects where bucket_id='order-photos') <> 0 then raise exception 'unrelated account can read order media'; end if;
end $$;
rollback;
