# Ops Money Desk response guard, 2026-10-02

Scope: a source audit found that the founder execution panel treated any HTTP 200 as a recorded provider outcome, even when the response body lacked an execution result. It also rotated the retry key. This could falsely display terminal success after an ambiguous broker response.

The client now requires a successful envelope, a nonempty execution attempt ID, and a matching state/status pair: `PROCESSING` with HTTP 202, or `SUCCEEDED` with HTTP 200. Anything else shows a correlated warning, keeps the same in-memory retry key, and refreshes the authoritative Money Desk request. The key rotates only after verified `SUCCEEDED`. The server's approval, founder, MFA, and idempotent execution gates were not changed.

Verification: two focused unit tests cover terminal, processing, missing, contradictory, and failed response shapes. Ops interaction contracts (98 checks), typecheck, and lint passed. A temporary development-only preview returned a mocked HTTP 200 with `{ ok: true, result: {} }`; the live browser rendered the warning rather than terminal success. No provider or server command was sent. Desktop, 834px tablet, and 390px phone views were inspected. The tablet and phone preview initially overflowed because the disabled-help grid item forced an implicit second column; the responsive grid was corrected and read-only browser dimensions then showed `scrollWidth === innerWidth` at both sizes. The temporary preview route, local server, and generated build cache were removed afterward.

Not verified: an authenticated production Money Desk attempt, real provider execution, or terminal callback. Those require a separately authorized financial test; this exercise did not move funds or modify money records.

## Adjacent protected actions

The same audit found HTTP-200-only success claims in Money Desk scope elevation, founder approve/reject, and payout-destination preparation. These now require the fields returned by their respective database RPCs: grant ID plus expiry; the exact request ID plus a decision-compatible status; or a prepared request ID plus a recognized status. A response for an already-progressed preparation is shown as a warning rather than a new founder-approval request. Reasons and review acknowledgements are preserved on ambiguous responses while the authoritative page refreshes.

Focused tests cover valid and malformed shapes. In a temporary local preview, each action received a mocked HTTP 200 with an empty result; all three rendered correlated warnings, not success. Desktop visual inspection and 390px phone and 834px tablet overflow checks passed (`scrollWidth === innerWidth`). The preview route and server were removed. No protected production action, email, Slack notification, or financial transaction was triggered.
