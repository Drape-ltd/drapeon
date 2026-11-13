do $$
declare
  result jsonb;
  again jsonb;
begin
  result := public.create_ops_source_case('order','fixture-order-1',
    'The customer concern needs an independent order review.', 'fixture-order-review-0001',
    '11111111-1111-4111-8111-111111111111', 'ops-qa@example.invalid', 'DEVELOPMENT',
    '55555555-5555-4555-8555-555555555555');
  if result->>'caseId' = '33333333-3333-4333-8333-333333333333' then
    raise exception 'unrelated push issue was returned as dispute review';
  end if;
  if result->>'caseId' is null or result->>'existing' is not null then
    raise exception 'new order review was not created: %', result;
  end if;
  if (select count(*) from public.ops_issues where order_id='fixture-order-1' and issue_type='ORDER_REVIEW') <> 1 then
    raise exception 'expected exactly one order review issue';
  end if;
  again := public.create_ops_source_case('order','fixture-order-1',
    'The customer concern needs an independent order review.', 'fixture-order-review-0001',
    '11111111-1111-4111-8111-111111111111', 'ops-qa@example.invalid', 'DEVELOPMENT',
    '55555555-5555-4555-8555-555555555555');
  if again->>'caseId' is distinct from result->>'caseId' or again->>'duplicate' is distinct from 'true' then
    raise exception 'replay did not return the same order review receipt: %', again;
  end if;
end $$;
