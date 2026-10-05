-- Named Studio looks sync across a customer's or tailor's devices. Drafts remain
-- local so an interrupted edit is recoverable even without connectivity.
create table if not exists public.studio_collections (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  revision bigint not null default 1 check (revision > 0),
  looks jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  constraint studio_collections_shape check (
    jsonb_typeof(looks) = 'array'
    and jsonb_array_length(looks) <= 12
    and octet_length(looks::text) <= 8000000
  )
);

alter table public.studio_collections enable row level security;

create policy "owners read their Studio collection"
  on public.studio_collections for select to authenticated
  using (owner_id = auth.uid());

revoke all on public.studio_collections from anon, authenticated;
grant select on public.studio_collections to authenticated;
grant all on public.studio_collections to service_role;

comment on table public.studio_collections is
  'Private account-scoped named Studio looks. Writes use studio-collection-action with an expected revision; order snapshots are separate.';
