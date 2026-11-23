-- Allow a dedicated re-authentication purpose for removing a Google or Apple
-- sign-in method. Removing a linked identity is gated server-side by a fresh
-- email-code proof bound to this purpose (account-security-action
-- `unlink-identity`). Purpose-only widening: no row is rewritten.

alter table public.auth_reauth_challenges
  drop constraint if exists auth_reauth_challenges_purpose_check;

alter table public.auth_reauth_challenges
  add constraint auth_reauth_challenges_purpose_check
  check (purpose in (
    'ACCOUNT_DELETION',
    'EMAIL_CHANGE',
    'PASSWORD_CHANGE',
    'PHONE_CHANGE',
    'PAYOUT_ACCOUNT_CHANGE',
    'IDENTITY_UNLINK'
  ));
