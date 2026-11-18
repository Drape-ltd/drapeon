-- Deliberately no-op. Re-granting a private profile column reopens an exposure.
-- Roll forward with a reviewed compatibility migration if a released client was
-- found to depend on a B0 field.
do $$
begin
  null;
end $$;
