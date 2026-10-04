-- Storage policies do not create their target bucket. Production uploads were
-- failing with NoSuchBucket before authorization could evaluate the brief path.
-- Restore the bucket contract used by the mobile and web reference uploaders.
-- Existing buckets are preserved; a subsequent migration may change settings.
begin;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'order-photos',
  'order-photos',
  true,
  31457280,
  array['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/quicktime']
)
on conflict (id) do nothing;

commit;
