-- Deliberately no-op. Stage A adds an owner-scoped RPC that released web
-- clients depend on. Removing it in a rollback could break those clients;
-- roll forward with a reviewed corrective migration instead.
do $$
begin
  null;
end $$;
