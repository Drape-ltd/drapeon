-- TIP claims may already have reserved or completed money operations.
-- Roll forward with a corrective migration; never drop their audit history.
do $$
begin
  raise exception 'Forward-only TIP claim closure: do not drop claim history';
end;
$$;
