do $$
begin
  if not exists (
    select 1 from pg_trigger
    where tgrelid = 'public.payout_claims'::regclass
      and tgname = 'payout_claim_blocked_transition_guard'
      and not tgisinternal
  ) then
    raise exception 'Blocked payout transition guard is missing';
  end if;
  if has_function_privilege('anon',
      'public.prevent_unreviewed_blocked_payout_transition()', 'EXECUTE')
    or has_function_privilege('authenticated',
      'public.prevent_unreviewed_blocked_payout_transition()', 'EXECUTE') then
    raise exception 'Blocked payout transition trigger must not be callable by clients';
  end if;
end;
$$;
