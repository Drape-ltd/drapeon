-- Deliberately no-op. Restoring table access to owner-only verification and
-- payout columns would reintroduce the cross-account disclosure this forward
-- security repair closes. Roll forward with a reviewed, scoped compatibility
-- migration if a consumer was missed.
do $$
begin
  null;
end $$;
