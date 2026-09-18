-- Classify media by its file extension when no MIME type is supplied.
--
-- derive_media_asset_kind() decided media_kind from mime_type alone, and the
-- reconciliation path that backfills portfolio assets inserts with a null
-- mime_type — it works the kind out from the URL, but stores it in metadata,
-- which nothing reads. Every backfilled row therefore fell through to the
-- 'IMAGE' default.
--
-- A video stamped IMAGE renders through an <img> tag, so the portfolio
-- presentation editor showed a broken thumbnail labelled "Image" for a clip.

create or replace function public.derive_media_asset_kind()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  candidate_path text;
begin
  if lower(coalesce(new.mime_type, '')) like 'video/%' then
    new.media_kind := 'VIDEO';
    return new;
  elsif lower(coalesce(new.mime_type, '')) like 'image/%' then
    new.media_kind := 'IMAGE';
    return new;
  elsif lower(coalesce(new.mime_type, '')) like 'audio/%' then
    new.media_kind := 'AUDIO';
    return new;
  end if;

  -- No usable MIME type: fall back to the object path or public URL, stripped
  -- of any query string or fragment.
  candidate_path := lower(split_part(split_part(
    coalesce(nullif(new.object_path, ''), coalesce(new.public_url, '')), '?', 1), '#', 1));

  if candidate_path ~ '\.(mp4|mov|m4v|webm)$' then
    new.media_kind := 'VIDEO';
  elsif candidate_path ~ '\.(m4a|mp3|wav|aac|ogg)$' then
    new.media_kind := 'AUDIO';
  elsif candidate_path ~ '\.(jpg|jpeg|png|webp|heic|heif|gif|avif)$' then
    new.media_kind := 'IMAGE';
  elsif new.media_kind is null then
    new.media_kind := 'IMAGE';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_media_assets_derive_kind on public.media_assets;
create trigger trg_media_assets_derive_kind
before insert or update of mime_type, media_kind, object_path, public_url
  on public.media_assets
for each row execute function public.derive_media_asset_kind();

-- Repair rows already mislabelled by the old rule.
update public.media_assets
set media_kind = 'VIDEO'
where media_kind <> 'VIDEO'
  and lower(split_part(split_part(coalesce(nullif(object_path, ''), coalesce(public_url, '')), '?', 1), '#', 1))
      ~ '\.(mp4|mov|m4v|webm)$';
