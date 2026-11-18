-- Local/Dev rehearsal only. Never remove Production notification columns while
-- an Edge release can write them; production recovery is forward-only.
drop index if exists public.push_delivery_attempts_notification_job_idx;
alter table public.push_delivery_attempts drop column if exists notification_job_id;
alter table public.push_tokens drop constraint if exists push_tokens_quarantine_pair_check;
alter table public.push_tokens drop constraint if exists push_tokens_apns_environment_check;
alter table public.push_tokens drop constraint if exists push_tokens_app_variant_check;
alter table public.push_tokens drop column if exists quarantine_reason;
alter table public.push_tokens drop column if exists quarantined_at;
alter table public.push_tokens drop column if exists token_generation_started_at;
alter table public.push_tokens drop column if exists apns_environment;
alter table public.push_tokens drop column if exists application_id;
alter table public.push_tokens drop column if exists app_variant;
alter table public.push_tokens drop column if exists expo_project_id;
