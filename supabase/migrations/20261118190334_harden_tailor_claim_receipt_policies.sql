-- Development-only PR 2, Stage 3 migration 3/5.
-- The receipt tables are service-only, but every RLS-enabled public table must
-- also carry the STAFF_DRAFT restrictive boundary as defense in depth.

drop policy if exists deny_staff_draft_claim_session on public.tailor_claim_transition_receipts;
create policy deny_staff_draft_claim_session
on public.tailor_claim_transition_receipts
as restrictive for all to authenticated
using (not public.is_staff_draft_identity())
with check (not public.is_staff_draft_identity());

drop policy if exists deny_staff_draft_claim_session on public.tailor_claim_finalize_receipts;
create policy deny_staff_draft_claim_session
on public.tailor_claim_finalize_receipts
as restrictive for all to authenticated
using (not public.is_staff_draft_identity())
with check (not public.is_staff_draft_identity());

create index if not exists tailor_claim_transition_receipts_bootstrap_session_idx
  on public.tailor_claim_transition_receipts(bootstrap_session_id);
