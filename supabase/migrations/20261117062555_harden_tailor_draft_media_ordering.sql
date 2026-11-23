-- Forward-only repair for Development and fresh installs. The original PR 1
-- migration was exercised in Development before these rules existed.

create or replace function public.update_tailor_draft_media_layout(
  p_invite_id uuid,p_asset_id uuid,p_sort_order integer,p_is_cover boolean,p_focal_x numeric,p_focal_y numeric
) returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
begin
  perform 1 from public.tailor_claim_invites where id=p_invite_id and status='DRAFT' for update;
  if not found then return false; end if;
  perform 1 from public.tailor_draft_media where id=p_asset_id and invite_id=p_invite_id and confirmed_at is not null for update;
  if not found then return false; end if;
  if p_is_cover then update public.tailor_draft_media set is_cover=false,updated_at=now() where invite_id=p_invite_id and is_cover; end if;
  update public.tailor_draft_media set sort_order=p_sort_order,is_cover=p_is_cover,focal_x=p_focal_x,focal_y=p_focal_y,updated_at=now()
  where id=p_asset_id and invite_id=p_invite_id;
  return true;
end;$$;
revoke all on function public.update_tailor_draft_media_layout(uuid,uuid,integer,boolean,numeric,numeric) from public,anon,authenticated;
grant execute on function public.update_tailor_draft_media_layout(uuid,uuid,integer,boolean,numeric,numeric) to service_role;

create or replace function public.reorder_tailor_draft_media(
  p_invite_id uuid,p_asset_ids uuid[]
) returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_supplied integer:=coalesce(array_length(p_asset_ids,1),0);
begin
  perform 1 from public.tailor_claim_invites where id=p_invite_id and status='DRAFT' for update;
  if not found then return false; end if;

  if v_supplied=0
    or (select count(distinct value) from unnest(p_asset_ids) as input(value))<>v_supplied
    or exists(select 1 from unnest(p_asset_ids) as input(value) where not exists(
      select 1 from public.tailor_draft_media media
      where media.id=input.value and media.invite_id=p_invite_id and media.confirmed_at is not null
    )) then return false;
  end if;

  update public.tailor_draft_media media
  set sort_order=ordered.ordinality-1,updated_at=now()
  from unnest(p_asset_ids) with ordinality ordered(asset_id,ordinality)
  where media.id=ordered.asset_id and media.invite_id=p_invite_id and media.confirmed_at is not null;

  -- Append any confirmed rows that an older client cannot display (for example,
  -- a legacy duplicate avatar). Incomplete uploads remain outside the order.
  with remaining as (
    select id,row_number() over(order by sort_order,id) as position
    from public.tailor_draft_media
    where invite_id=p_invite_id and confirmed_at is not null and not (id=any(p_asset_ids))
  )
  update public.tailor_draft_media media
  set sort_order=v_supplied+remaining.position-1,updated_at=now()
  from remaining where media.id=remaining.id;
  return true;
end;$$;
revoke all on function public.reorder_tailor_draft_media(uuid,uuid[]) from public,anon,authenticated;
grant execute on function public.reorder_tailor_draft_media(uuid,uuid[]) to service_role;

create or replace function public.enforce_one_tailor_draft_avatar()
returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
  if new.media_kind='AVATAR' then
    perform 1 from public.tailor_claim_invites where id=new.invite_id for update;
  end if;
  if new.media_kind='AVATAR' and exists(
    select 1 from public.tailor_draft_media
    where invite_id=new.invite_id and media_kind='AVATAR' and id<>new.id
  ) then raise exception using errcode='23505',message='A draft can have only one avatar.';
  end if;
  return new;
end;$$;
drop trigger if exists trg_one_tailor_draft_avatar on public.tailor_draft_media;
create trigger trg_one_tailor_draft_avatar before insert or update of invite_id,media_kind
on public.tailor_draft_media for each row execute function public.enforce_one_tailor_draft_avatar();
revoke all on function public.enforce_one_tailor_draft_avatar() from public,anon,authenticated;
grant execute on function public.enforce_one_tailor_draft_avatar() to service_role;
