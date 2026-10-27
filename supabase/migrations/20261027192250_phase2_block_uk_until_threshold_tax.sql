-- Keep UK delivery fail-closed until the actual consignment-value threshold
-- calculation and above-£135 treatment are implemented and reviewed. The
-- existing VAT-registration and low-value flags are not sufficient evidence:
-- current GB tax resolution applies a static rate without a threshold input.
do $migration$
begin
  if exists (
    select 1
    from public.delivery_country_rules
    where country_code = 'GB' and status = 'READY'
  ) then
    raise exception using
      errcode = '23514',
      message = 'Disable existing UK delivery rules through the audited Ops workflow before applying the threshold-tax gate';
  end if;
end
$migration$;

alter table public.delivery_country_rules
  add constraint delivery_country_rules_uk_threshold_tax_implemented_ck
  check (country_code <> 'GB' or status <> 'READY');

comment on constraint delivery_country_rules_uk_threshold_tax_implemented_ck
  on public.delivery_country_rules is
  'Temporary fail-closed launch gate. Replace only when the versioned UK consignment-value VAT calculation and treatment above GBP 135 are implemented, tested, and reviewed.';
