-- Local/Dev rehearsal only. Production recovery is forward-only after client
-- code has used provenance-aware registration.
drop trigger if exists push_tokens_reset_quarantine_on_token_change on public.push_tokens;
drop function if exists public.quarantine_repeated_bad_device_token(text);
drop function if exists public.register_push_token_with_provenance(text,text,text,text,text,text,text);
drop function if exists public.reset_push_quarantine_on_token_change();
