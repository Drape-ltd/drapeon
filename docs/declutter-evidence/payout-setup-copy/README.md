# Payout setup copy evidence

## Rebase and contract gate

- Rebased PR #93 onto main `35558b94`. The only conflict was the payout success panel. Pending Stripe first-release review retains main's “You can take paid orders once this review clears”; pending Bachs and replacement/manual states retain their existing messages. The staged schedule appears only for the ready state.
- Reinstalled lockfile dependencies in this worktree and passed `pnpm launch:contracts` twice on Node 22.23.2, including after the web heading follow-up. `git diff --check` passed.
- No money action or Production change was made.

## Live Dev web check

- Opened `/account/payout` from this branch's localhost web server against Supabase Dev `pqptfuqogvrajozfsqzi`, authenticated as the QA tailor. Inspected the desktop viewport and a 390 × 844 viewport in the in-app browser.
- The account rendered Ready, Stripe, USD, and Stripe Connect Connected. The disclosure rendered shipped orders as 70% at verified carrier acceptance or Drapeon custody, 20% at verified delivery plus 72 hours, and 10% fourteen days after verified delivery. Local collection rendered 80% at authenticated handoff and 20% 72 hours later. No raw `SHIPPED` or `LOCAL_HANDOFF` enum appeared in the visible copy.
- Read-only comparison: a real Dev ready-made local-collection order was confirmed, with no handoff yet. Its $135.31 amount and stage were visible on the order page; the disclosure correctly places its first earning release at authenticated handoff, not order confirmation.
- At narrow width the heading originally ran into the first schedule sentence. The web change puts “When earnings are released” on its own line; the same browser page was rechecked at narrow and desktop widths after the change, with no clipping observed.
- The web app has no dark-theme mode or `prefers-color-scheme` styles, so a distinct web dark presentation is not available to inspect. The mobile payout success screen still needs a device visual pass, including dark mode where supported.
