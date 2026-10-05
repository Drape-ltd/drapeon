create table if not exists public.order_studio_design_versions (
  order_id text not null references public.orders(id) on delete cascade,
  version integer not null check (version > 0),
  authored_by uuid not null references auth.users(id),
  design jsonb not null check (jsonb_typeof(design) = 'object' and octet_length(design::text) <= 1000000),
  sheet_photo_url text not null check (length(sheet_photo_url) between 1 and 2048),
  created_at timestamptz not null default now(),
  primary key (order_id, version)
);

create index if not exists order_studio_design_versions_recent_idx
  on public.order_studio_design_versions (order_id, version desc);

alter table public.order_studio_design_versions enable row level security;

create policy "Order participants can read Studio design versions"
  on public.order_studio_design_versions for select to authenticated
  using (exists (
    select 1 from public.orders o
    where o.id = order_id
      and (o.customer_id::text = auth.uid()::text or o.tailor_id::text = auth.uid()::text)
  ));

grant select on public.order_studio_design_versions to authenticated;
