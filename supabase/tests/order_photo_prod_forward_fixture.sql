create role authenticated nologin;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
create schema storage;
create function storage.extension(path text) returns text language sql immutable as $$
  select regexp_replace(path, '^.*\\.', '')
$$;
create table storage.buckets(id text primary key, public boolean not null);
create table storage.objects(id uuid primary key, bucket_id text not null, name text not null);
alter table storage.objects enable row level security;
grant usage on schema storage, auth, public to authenticated;
grant select on storage.objects to authenticated;
create table public.orders(id uuid primary key, customer_id uuid not null, tailor_profile_id uuid, reference_photos text[]);
create table public.tailor_profiles(id uuid primary key, user_id uuid not null);
grant select on public.orders, public.tailor_profiles to authenticated;
create schema supabase_migrations;
create table supabase_migrations.schema_migrations(version text primary key);
insert into supabase_migrations.schema_migrations values ('20261124170000');
insert into storage.buckets values ('order-photos', true);
insert into public.tailor_profiles values ('00000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000004');
insert into public.orders values ('00000000-0000-4000-8000-000000000005','00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000003',array['https://example.supabase.co/storage/v1/object/public/order-photos/brief/00000000-0000-4000-8000-000000000002/photo.jpg']);
insert into storage.objects values
('10000000-0000-4000-8000-000000000001','order-photos','brief/00000000-0000-4000-8000-000000000002/photo.jpg'),
('10000000-0000-4000-8000-000000000002','order-photos','progress/00000000-0000-4000-8000-000000000005/photo.jpg'),
('10000000-0000-4000-8000-000000000003','order-photos','fabric-receipts/00000000-0000-4000-8000-000000000005/photo.jpg'),
('10000000-0000-4000-8000-000000000004','order-photos','vision-qc/00000000-0000-4000-8000-000000000005/photo.jpg');
