revoke all on function public.queue_reviewed_fabric_release_recovery(uuid,text,text) from public,anon,authenticated,service_role;
drop function if exists public.queue_reviewed_fabric_release_recovery(uuid,text,text);
