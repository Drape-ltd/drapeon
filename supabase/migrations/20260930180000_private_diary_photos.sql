-- Fitting photos belong to the tailor's private diary, never public portfolio.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('diary-photos', 'diary-photos', false, 8388608, array['image/jpeg'])
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create table if not exists public.diary_attachments (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null references public.diary_entries(id) on delete cascade,
  tailor_id uuid not null references auth.users(id) on delete cascade,
  storage_path text not null unique,
  caption text not null default '',
  created_at timestamptz not null default now(),
  constraint diary_attachment_caption_fixed check (caption = ''),
  constraint diary_attachment_owner_path check
    (split_part(storage_path, '/', 1) = tailor_id::text
     and split_part(storage_path, '/', 2) = entry_id::text
     and storage_path ~ '^[0-9a-f-]+/[0-9a-f-]+/[0-9a-f-]+\.jpg$')
);

create index if not exists diary_attachments_entry_idx
  on public.diary_attachments (entry_id, created_at desc);
alter table public.diary_attachments enable row level security;

drop policy if exists "Diary photos: tailor reads own" on public.diary_attachments;
create policy "Diary photos: tailor reads own" on public.diary_attachments
for select to authenticated using (
  tailor_id = auth.uid() and exists (
    select 1 from public.diary_entries d
    where d.id = entry_id and d.tailor_id = auth.uid()
  )
);
drop policy if exists "Diary photos: tailor adds own" on public.diary_attachments;
create policy "Diary photos: tailor adds own" on public.diary_attachments
for insert to authenticated with check (
  tailor_id = auth.uid() and exists (
    select 1 from public.diary_entries d
    where d.id = entry_id and d.tailor_id = auth.uid()
  )
);
drop policy if exists "Diary photos: tailor removes own" on public.diary_attachments;
create policy "Diary photos: tailor removes own" on public.diary_attachments
for delete to authenticated using (tailor_id = auth.uid());
revoke update on public.diary_attachments from authenticated;
grant select, insert, delete on public.diary_attachments to authenticated;

drop policy if exists "diary-photos: tailor uploads own entry" on storage.objects;
create policy "diary-photos: tailor uploads own entry" on storage.objects
for insert to authenticated with check (
  bucket_id = 'diary-photos'
  and split_part(name, '/', 1) = auth.uid()::text
  and exists (
    select 1 from public.diary_entries d
    where d.id::text = split_part(name, '/', 2)
      and d.tailor_id = auth.uid()
  )
);
drop policy if exists "diary-photos: tailor reads own entry" on storage.objects;
create policy "diary-photos: tailor reads own entry" on storage.objects
for select to authenticated using (
  bucket_id = 'diary-photos'
  and split_part(name, '/', 1) = auth.uid()::text
);
drop policy if exists "diary-photos: tailor removes own entry" on storage.objects;
create policy "diary-photos: tailor removes own entry" on storage.objects
for delete to authenticated using (
  bucket_id = 'diary-photos'
  and split_part(name, '/', 1) = auth.uid()::text
);
