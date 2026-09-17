-- Email-code re-authentication for sensitive account changes.
--
-- Until now a sensitive change (phone, email, password, deletion, payout
-- account) could only be confirmed by re-entering the account password. Tailors
-- who created their account with Google or Apple have no password, which left
-- them with no way to add the phone number that tailor setup requires.
--
-- This table backs a second way to earn the same short-lived reauth proof: a
-- six-digit code sent to the account email address. It mirrors
-- auth_device_challenges, but is kept separate so device-trust semantics and
-- sensitive-action semantics never share a row.

create table if not exists public.auth_reauth_challenges (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  purpose text not null
    check (purpose in (
      'ACCOUNT_DELETION',
      'EMAIL_CHANGE',
      'PASSWORD_CHANGE',
      'PHONE_CHANGE',
      'PAYOUT_ACCOUNT_CHANGE'
    )),
  code_hash text not null check (char_length(code_hash) = 64),
  status text not null default 'PENDING'
    check (status in ('PENDING', 'VERIFIED', 'EXPIRED', 'LOCKED', 'CANCELLED')),
  attempts integer not null default 0 check (attempts between 0 and 5),
  expires_at timestamptz not null,
  verified_at timestamptz,
  delivery_status text not null default 'PENDING'
    check (delivery_status in ('PENDING', 'ACCEPTED', 'FAILED')),
  provider text,
  provider_reference text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint auth_reauth_challenges_expiry_after_create check (expires_at > created_at)
);

create index if not exists auth_reauth_challenges_user_pending_idx
  on public.auth_reauth_challenges (user_id, purpose, created_at desc)
  where status = 'PENDING';

alter table public.auth_reauth_challenges enable row level security;

-- Only the edge function (service role) ever touches these rows. A client that
-- could read code hashes or attempt counters would weaken the challenge.
revoke all on table public.auth_reauth_challenges from public, anon, authenticated;
grant select, insert, update, delete on table public.auth_reauth_challenges to service_role;

comment on table public.auth_reauth_challenges is
  'Six-digit email codes that let a user confirm a sensitive account change without a password. Service-role only.';
