-- Development-only equivalence cleanup, recorded by Development as
-- version 20261124035736. This retired RPC creates a placeholder
-- bootstrap before provider proof; the live claim action has used
-- prepare_tailor_claim_provider_proof instead since the secure provider flow.
drop function if exists public.prepare_tailor_claim_provider_bootstrap_session(text, uuid);
