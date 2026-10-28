create trigger payout_claim_sync_returned_snapshot_tranche
after update of status,transfer_status on public.payout_claims
for each row execute function private.sync_returned_snapshot_tranche_payout();
