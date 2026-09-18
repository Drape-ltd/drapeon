# Headed-browser visual trace

Browser: Codex In-app Browser, visible tab, local preview on port `3018`.

The local server log recorded successful responses for all three routes: `GET /sign-in 200`, `GET /sign-up?role=TAILOR 200`, and `GET /account/orders 200`.

## 1. Sign-in route

URL: `http://localhost:3018/sign-in`

Observed in the headed browser:

- Drapeon header and sign-in card rendered.
- Email and password fields rendered.
- Forgot-password link points to `/account/recovery`.
- Sign-in button and trust-device control rendered.

## 2. Tailor sign-up route

URL: `http://localhost:3018/sign-up?role=TAILOR`

Observed in the headed browser:

- `CREATE ACCOUNT` and `Start your Drapeon account.` rendered.
- Tailor-compatible profile photo, display name, phone, email, password, and confirmation fields rendered.
- Continue action rendered.

## 3. Protected account route

URL: `http://localhost:3018/account/orders`

Observed in the headed browser while signed out:

- Account surface did not flash order data.
- It rendered `Sign in to continue.` with a sign-in link carrying `next=/account/orders`.

This verifies the route guard visually and confirms the local preview did not expose protected content before identity resolution.

## Native status

- Android: `adb devices` returned no connected device.
- iOS: CoreSimulatorService was unavailable (`simctl` could not discover runtimes).

Therefore native screenshots/build evidence remains a required follow-up before EAS promotion; this run does not claim it.
