-- The invoker trigger only compares OLD/NEW fields. Pin an empty search path
-- so the accepted-route mirror guard cannot resolve caller-controlled objects.
alter function private.guard_accepted_payout_route_legacy_mirrors()
  set search_path = '';
