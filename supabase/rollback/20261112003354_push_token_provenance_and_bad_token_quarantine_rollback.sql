-- Roll back code that calls the provenance and quarantine RPCs first.
drop function if exists public.quarantine_repeated_bad_device_token(text);
drop function if exists public.register_push_token_with_provenance(text,text,text,text,text,text,text);
drop trigger if exists push_tokens_reset_quarantine_on_token_change on public.push_tokens;
drop function if exists public.reset_push_quarantine_on_token_change();

alter table public.push_tokens
  drop constraint if exists push_tokens_quarantine_pair_check,
  drop constraint if exists push_tokens_apns_environment_check,
  drop constraint if exists push_tokens_app_variant_check,
  drop column if exists quarantine_reason,
  drop column if exists quarantined_at,
  drop column if exists apns_environment,
  drop column if exists application_id,
  drop column if exists app_variant,
  drop column if exists expo_project_id;
