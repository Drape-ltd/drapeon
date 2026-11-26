# Claim bootstrap reaper rollback reference

Migration `20261126203131_reap_claim_bootstrap_all_invite_states.sql` is already applied to Development and remains immutable. Its header names the earlier Development body, `20261118203934_protect_tailor_claim_auth_handover.sql`.

For a future reviewed Production-forward promotion, the function body this change would replace is in `20261123174414_prod_forward_tailor_claim_transition_finalize.sql`. That promotion needs a new `prod_forward_*` migration. A Production rollback must restore that Production function body in another forward migration; do not replay or edit the Development migration.
