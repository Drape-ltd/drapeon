-- Development created orders.id as text, while production has orders.id as uuid.
-- Create the UUID variant before the original Studio version migration runs.
-- That migration's IF NOT EXISTS then adds the same index, policy, and grants.
-- On development, the existing text-keyed table is left unchanged.
do $$
declare
  v_order_id_type regtype;
begin
  select a.atttypid::regtype into v_order_id_type
  from pg_attribute a
  where a.attrelid = 'public.orders'::regclass
    and a.attname = 'id'
    and not a.attisdropped;

  if v_order_id_type = 'uuid'::regtype then
    create table if not exists public.order_studio_design_versions (
      order_id uuid not null references public.orders(id) on delete cascade,
      version integer not null check (version > 0),
      authored_by uuid not null references auth.users(id),
      design jsonb not null check (jsonb_typeof(design) = 'object' and octet_length(design::text) <= 1000000),
      sheet_photo_url text not null check (length(sheet_photo_url) between 1 and 2048),
      created_at timestamptz not null default now(),
      primary key (order_id, version)
    );
  elsif v_order_id_type <> 'text'::regtype or v_order_id_type is null then
    raise exception 'Unsupported public.orders.id type for Studio: %', v_order_id_type;
  end if;
end;
$$;
