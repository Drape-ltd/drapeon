do $$
begin
  if exists (select 1 from public.tailor_claim_email_codes where status = 'VERIFIED') then
    raise exception 'Refusing to remove verified tailor claim email evidence.';
  end if;
end $$;

drop function if exists public.verify_tailor_claim_email_code(text, text, text);
drop function if exists public.record_tailor_claim_email_job_outcome(uuid, boolean, text, text, text);
drop function if exists public.issue_tailor_claim_email_code(text, text, text);
drop table if exists public.tailor_claim_email_jobs;
drop table if exists public.tailor_claim_email_codes;
drop table if exists public.tailor_claim_email_paths;
