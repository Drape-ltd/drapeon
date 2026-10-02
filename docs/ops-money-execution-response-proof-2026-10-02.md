# Ops Money Desk response guard, 2026-10-02

Scope: a source audit found that the founder execution panel treated any HTTP 200 as a recorded provider outcome, even when the response body lacked an execution result. It also rotated the retry key. This could falsely display terminal success after an ambiguous broker response.

The client now requires a successful envelope, a nonempty execution attempt ID, and a matching state/status pair: `PROCESSING` with HTTP 202, or `SUCCEEDED` with HTTP 200. Anything else shows a correlated warning, keeps the same in-memory retry key, and refreshes the authoritative Money Desk request. The key rotates only after verified `SUCCEEDED`. The server's approval, founder, MFA, and idempotent execution gates were not changed.

Verification: two focused unit tests cover terminal, processing, missing, contradictory, and failed response shapes. Ops interaction contracts (98 checks), typecheck, and lint passed. A temporary development-only preview returned a mocked HTTP 200 with `{ ok: true, result: {} }`; the live browser rendered the warning rather than terminal success. No provider or server command was sent. Desktop, 834px tablet, and 390px phone views were inspected. The tablet and phone preview initially overflowed because the disabled-help grid item forced an implicit second column; the responsive grid was corrected and read-only browser dimensions then showed `scrollWidth === innerWidth` at both sizes. The temporary preview route, local server, and generated build cache were removed afterward.

Not verified: an authenticated production Money Desk attempt, real provider execution, or terminal callback. Those require a separately authorized financial test; this exercise did not move funds or modify money records.
