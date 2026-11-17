do $$
declare
  result jsonb;
begin
  result := public.create_ops_source_case('order','fixture-order-2',
    'The customer concern needs an independent order review.', 'fixture-order-review-0002',
    '11111111-1111-4111-8111-111111111111', 'ops-qa@example.invalid', 'DEVELOPMENT',
    '66666666-6666-4666-8666-666666666666');
  if result->>'caseId' is distinct from '44444444-4444-4444-8444-444444444444' then
    raise exception 'rollback did not restore the original broad case lookup: %', result;
  end if;
end $$;
