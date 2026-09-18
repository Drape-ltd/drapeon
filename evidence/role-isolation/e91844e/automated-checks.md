# Automated checks

All checks below ran against commit `e91844e` in `/private/tmp/drape-role-isolation-fix`.

| Check | Result | Notes |
| --- | --- | --- |
| `pnpm --dir apps/mobile typecheck` | PASS | No TypeScript errors. |
| `pnpm --dir apps/mobile lint` | PASS | Existing warnings only; no lint errors. |
| `pnpm --dir apps/web typecheck` | PASS | No TypeScript errors. |
| `pnpm --dir apps/web lint` | PASS | Existing warnings only; no lint errors. |
| `deno check supabase/functions/_shared/notify.ts` | PASS | Notification enrichment compiles. |
| Shared Jest suite | PASS | 76 suites, 639 tests passed. |
| `git diff --check` | PASS | No whitespace errors. |

The shared suite includes the new `order-role-scope` tests and the `requiredRole` notification-policy coverage.
