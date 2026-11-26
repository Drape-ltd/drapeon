# Dev-only S3 rehearsal

`20261126082447_phase4_s3_forward_retry_repair.sql` is the exact source
applied to Dev for the S3 rehearsal. It is stored here to preserve the Dev
ledger provenance, outside `supabase/migrations` so broad Production promotion
cannot pick it up. **Do not apply it to Production.** Its current Dev function
bodies have UUID/text runtime comparisons that are unsafe against the
Production schema. The Production repair needs a new forward version with
native UUID comparisons and runtime proofs.
