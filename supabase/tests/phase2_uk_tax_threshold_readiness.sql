-- Rollback-only proof that UK VAT checkboxes cannot mark GB delivery ready
-- before threshold taxation has an implemented and reviewed calculation.
begin;
-- This is a local superuser-only constraint proof; disable audit triggers so the
-- test does not need a real workforce actor fixture. CHECK constraints remain active.
set local session_replication_role = replica;

do $test$
declare
  v_rule_id uuid;
  v_status text;
begin
  insert into public.delivery_country_rules (
    country_code, version, status, vat_registration_ready, collect_vat_under_gbp_135
  ) values ('GB', 990001, 'DISABLED', true, true)
  returning id into v_rule_id;

  begin
    update public.delivery_country_rules
    set status = 'READY'
    where id = v_rule_id;
    raise exception 'GB readiness unexpectedly succeeded';
  exception when check_violation then
    null;
  end;

  select status into v_status
  from public.delivery_country_rules
  where id = v_rule_id;
  if v_status <> 'DISABLED' then
    raise exception 'failed readiness attempt changed GB status to %', v_status;
  end if;

  begin
    insert into public.delivery_country_rules (
      country_code, version, status, vat_registration_ready, collect_vat_under_gbp_135
    ) values ('GB', 990002, 'READY', true, true);
    raise exception 'GB READY insert unexpectedly succeeded';
  exception when check_violation then
    null;
  end;

  -- The temporary UK gate must not affect the unrelated US duty rule.
  insert into public.delivery_country_rules (
    country_code, version, status, duties_customer_pays
  ) values ('US', 990003, 'READY', true);
end;
$test$;

rollback;
