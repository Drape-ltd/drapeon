-- Withdrawal banks are children of the immutable connected-account destination.
-- Order snapshots and transfers remain pinned to payout_destinations (acct_).
create table public.bachs_withdrawal_destinations (
  id uuid primary key default gen_random_uuid(),
  payout_destination_id uuid not null references public.payout_destinations(id) on delete restrict,
  payout_change_request_id uuid references public.payout_change_requests(id) on delete restrict,
  provider_destination_ref text not null
    check (provider_destination_ref ~ '^pd_[A-Za-z0-9_-]{1,196}$'),
  status text not null check (status in (
    'PENDING_CONFIRMATION', 'CURRENT', 'RETIRED', 'REJECTED', 'EXPIRED', 'CANCELLED'
  )),
  bank_name text,
  account_last4 text check (account_last4 is null or account_last4 ~ '^[A-Za-z0-9]{4}$'),
  account_name text,
  requested_at timestamptz not null default now(),
  confirmed_at timestamptz,
  retired_at timestamptz,
  decided_at timestamptz,
  decision_actor_id uuid,
  decision_reason text,
  provider_default_status text not null default 'PENDING'
    check (provider_default_status in ('PENDING', 'SYNCED', 'FAILED')),
  provider_default_synced_at timestamptz,
  ops_review_status text not null default 'PENDING'
    check (ops_review_status in ('PENDING', 'CLEARED', 'BLOCKED')),
  ops_reviewed_at timestamptz,
  ops_review_actor text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint bachs_withdrawal_destination_terminal_metadata check (
    (status = 'CURRENT' and confirmed_at is not null)
    or (status = 'RETIRED' and confirmed_at is not null and retired_at is not null)
    or (status = 'PENDING_CONFIRMATION' and decided_at is null)
    or (status in ('REJECTED', 'EXPIRED', 'CANCELLED') and decided_at is not null)
  )
);

create unique index bachs_withdrawal_destinations_one_current_idx
  on public.bachs_withdrawal_destinations(payout_destination_id)
  where status = 'CURRENT';
create unique index bachs_withdrawal_destinations_one_pending_idx
  on public.bachs_withdrawal_destinations(payout_destination_id)
  where status = 'PENDING_CONFIRMATION';
create index bachs_withdrawal_destinations_change_request_idx
  on public.bachs_withdrawal_destinations(payout_change_request_id)
  where payout_change_request_id is not null;

create or replace function private.guard_bachs_withdrawal_destination_row()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'BACHS_WITHDRAWAL_HISTORY_DELETE_FORBIDDEN' using errcode = '23514';
  end if;
  if tg_op = 'INSERT' then
    if not exists (
      select 1 from public.payout_destinations d
      where d.id = new.payout_destination_id and d.provider = 'BACHS'
    ) then
      raise exception 'BACHS_WITHDRAWAL_PARENT_INVALID' using errcode = '23514';
    end if;
    return new;
  end if;
  if new is not distinct from old then return new; end if;
  if (to_jsonb(new) - array['status','confirmed_at','retired_at','decided_at',
                           'decision_actor_id','decision_reason','updated_at',
                           'provider_default_status','provider_default_synced_at',
                           'ops_review_status','ops_reviewed_at','ops_review_actor'])
     is distinct from
     (to_jsonb(old) - array['status','confirmed_at','retired_at','decided_at',
                           'decision_actor_id','decision_reason','updated_at',
                           'provider_default_status','provider_default_synced_at',
                           'ops_review_status','ops_reviewed_at','ops_review_actor']) then
    raise exception 'BACHS_WITHDRAWAL_IDENTITY_IMMUTABLE' using errcode = '23514';
  end if;
  if old.status = new.status then
    if old.status <> 'CURRENT' or not (
       (old.provider_default_status is distinct from new.provider_default_status and
        new.provider_default_status in ('SYNCED','FAILED') and
        (to_jsonb(new) - array['provider_default_status','provider_default_synced_at','updated_at'])
          is not distinct from
        (to_jsonb(old) - array['provider_default_status','provider_default_synced_at','updated_at']))
       or
       (old.ops_review_status = 'PENDING' and new.ops_review_status in ('CLEARED','BLOCKED') and
        new.ops_reviewed_at is not null and new.ops_review_actor is not null and
        (to_jsonb(new) - array['ops_review_status','ops_reviewed_at','ops_review_actor','updated_at'])
          is not distinct from
        (to_jsonb(old) - array['ops_review_status','ops_reviewed_at','ops_review_actor','updated_at']))
     ) then
      raise exception 'BACHS_WITHDRAWAL_STATUS_TRANSITION_INVALID' using errcode = '23514';
    end if;
    new.updated_at := now();
    return new;
  end if;
  if not ((old.status = 'PENDING_CONFIRMATION' and new.status in
             ('CURRENT','REJECTED','EXPIRED','CANCELLED'))
       or (old.status = 'CURRENT' and new.status = 'RETIRED')) then
    raise exception 'BACHS_WITHDRAWAL_STATUS_TRANSITION_INVALID' using errcode = '23514';
  end if;
  if new.decision_reason is null or btrim(new.decision_reason) = '' then
    raise exception 'BACHS_WITHDRAWAL_DECISION_REASON_REQUIRED' using errcode = '23514';
  end if;
  new.updated_at := now();
  return new;
end $$;

create trigger bachs_withdrawal_destination_row_guard
before insert or update or delete on public.bachs_withdrawal_destinations
for each row execute function private.guard_bachs_withdrawal_destination_row();

alter table public.bachs_withdrawal_destinations enable row level security;
revoke all on public.bachs_withdrawal_destinations from public, anon, authenticated, service_role;
grant select on public.bachs_withdrawal_destinations to service_role;
revoke all on function private.guard_bachs_withdrawal_destination_row() from public, anon, authenticated;
