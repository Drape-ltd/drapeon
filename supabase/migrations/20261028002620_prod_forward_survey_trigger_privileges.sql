-- Survey scheduling is trigger-only. It must not be executable over the Data API.
revoke execute on function public.schedule_customer_completion_survey()
  from public, anon, authenticated;
revoke execute on function public.schedule_support_resolution_survey()
  from public, anon, authenticated;
revoke execute on function public.schedule_tailor_first_order_survey()
  from public, anon, authenticated;
