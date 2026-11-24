-- Pin the remaining public functions reported by the Supabase mutable-search-path advisor.
-- These functions use built-ins and explicitly-qualified public objects only.
alter function public.prevent_commercial_benefit_history_mutation() set search_path = public, pg_temp;
alter function public.set_ops_slack_delivery_updated_at() set search_path = public, pg_temp;
alter function public.set_web_push_subscription_updated_at() set search_path = public, pg_temp;
alter function public.derive_seller_item_stock_status(boolean, integer) set search_path = public, pg_temp;
alter function public.is_terminal_order_stage(public.order_stage) set search_path = public, pg_temp;
alter function public.enforce_custom_order_detail_rules() set search_path = public, pg_temp;
alter function public.safe_order_support_meta(text) set search_path = public, pg_temp;
alter function public.prevent_money_desk_append_only_mutation() set search_path = public, pg_temp;
alter function public.protect_money_desk_request_claim() set search_path = public, pg_temp;
alter function public.set_provider_health_updated_at() set search_path = public, pg_temp;
alter function public.set_ops_issue_updated_at() set search_path = public, pg_temp;
alter function public.touch_custom_order_details_updated_at() set search_path = public, pg_temp;
alter function public.enforce_custom_order_stage_rules() set search_path = public, pg_temp;
alter function public.set_job_queue_updated_at() set search_path = public, pg_temp;
alter function public.set_updated_at() set search_path = public, pg_temp;
alter function public.normalize_account_phone_e164(text) set search_path = public, pg_temp;
alter function public.prevent_commercial_ledger_mutation() set search_path = public, pg_temp;
alter function public.assert_commercial_ledger_transaction_balanced() set search_path = public, pg_temp;
alter function public.prevent_financial_case_append_only_mutation() set search_path = public, pg_temp;
alter function public.protect_financial_case_claim() set search_path = public, pg_temp;
alter function public.prevent_resolution_append_only_mutation() set search_path = public, pg_temp;
alter function public.protect_resolution_proposal_claim() set search_path = public, pg_temp;
alter function public.valid_reviewed_tax_source_urls(text[]) set search_path = public, pg_temp;
alter function public.prevent_fulfillment_selection_event_mutation() set search_path = public, pg_temp;
alter function public.prevent_tax_decision_artifact_mutation() set search_path = public, pg_temp;
alter function public.copy_receipt_tax_decision_snapshot() set search_path = public, pg_temp;
alter function public.validate_tax_responsibility_dependency() set search_path = public, pg_temp;
alter function public.prevent_tax_policy_control_mutation() set search_path = public, pg_temp;
alter function public.prevent_fabric_event_mutation() set search_path = public, pg_temp;

