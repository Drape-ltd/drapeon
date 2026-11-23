-- Entry-point-only rollback; preserve any already created attempt history.
drop function public.start_payout_attempt(uuid,text);
