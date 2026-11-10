# Batch K keyboard system

Branch: `codex/keyboard-system`
Rebased on: `origin/main` at `488343e72255453f9d645d6ccf14451dc5b5fc15` (2026-11-10)

This is a mobile UI change only. Copy, validation, domain behavior, APIs, server code, databases, Edge Functions, and Production remain out of scope.

## Baseline failure signature — before native changes

The review reported Android fields covered by the keyboard, duplicate iOS keyboard movement, delayed field reveal, dock overlap, and numeric keyboards without a Done action. The source on `main` confirms:

- `KeyboardAvoidingView` appears in 47 mobile files (165 source matches).
- `automaticallyAdjustKeyboardInsets` appears 5 times.
- The hand-written `KeyboardAwareScrollView` waits 40 ms on iOS or 120 ms on Android, measures window coordinates as a fallback, and reveals the focused input again on content-size changes.
- The mobile app has 96 `<TextInput>` occurrences, 35 `returnKeyType` props, 18 `onSubmitEditing` props, and 24 static `number-pad` / `decimal-pad` keyboard-type occurrences.
- No `inputAccessoryView` occurrence exists in the mobile source.
- `MessageThread` scrolls to the end from its `onContentSizeChange` handler.
- `BottomSheetScaffold` already sets Gorhom `keyboardBehavior="interactive"`, `keyboardBlurBehavior="restore"`, and `android_keyboardInputMode="adjustResize"`; bottom-sheet inputs are not using `BottomSheetTextInput` yet.
- The checked-in source has no generated `apps/mobile/android/gradle.properties` or Android manifest. Neither `edgeToEdgeEnabled` nor `windowSoftInputMode` is present in tracked source, so that part of the report is not confirmed from this checkout.

The raw baseline source matches were saved before code changes at `/private/tmp/batch-k-main-kav.log`, `/private/tmp/batch-k-main-insets.log`, and `/private/tmp/batch-k-main-input-controls.log`.

The new static contract was run against an archive of the exact `origin/main` tree before migration and failed with 82 findings. Its four rule tests pass on the task branch.

No app-level keyboard failure video has been captured yet. The only attached Android device is the Pixel 8 reserved by C1; there is no Android emulator binary/AVD listed. I did not use either C1 device or create an Android AVD. A dedicated, C1-free iPhone SE simulator has a pre-rebase 1.0.4 Dev client installed and loaded the prior branch head. The unauthenticated sign-in result is recorded below; no modal, chat, Vision, or authenticated tailor-flow result is claimed without the owner-held Dev fixture credential. The dependency and JS migration are in the task branch, but no generated native source/configuration has been changed.

## Branch implementation status

- Added one Expo 54 compatible `react-native-keyboard-controller@1.18.5` dependency.
- Added the root `KeyboardProvider` and Drape toolbar with previous, next, and Done actions. The root toolbar is disabled for the chat composer; native Modal form bodies and fixed Modal forms mount their own toolbar in the Modal window. The library supplies the accessibility labels and hints; theme colors use Drape light and dark tokens.
- Replaced the hand-written focused-input timer/measurement fallback with the library `KeyboardAwareScrollView`, and moved standard screens, native Modal scroll bodies, and fallback sheets onto it.
- Removed every avoiding wrapper around a keyboard-aware scroll body. Fixed layouts retain the library avoiding/sticky primitives only where they own the layout.
- Routed app TextInput JSX through `DrapeTextInput`. Next submits without blurring, dynamically changes to Done at the last focused single-line field, and preserves multiline newline behavior. Gorhom sheet content switches to `BottomSheetTextInput` through the scaffold scope.
- Replaced React Native keyboard-avoiding imports with the library-backed Drape primitive; removed screen-level automatic keyboard insets. The static contract now rejects a keyboard-aware scroll body nested in an avoiding view.
- Added Android translucent status/navigation bar props to React Native Modals.
- Floating action docks follow keyboard progress with a fade/slide and are removed from pointer and accessibility interaction while the keyboard is open.
- Chat uses interactive iOS keyboard dismissal and follows new messages only when the reader is already near the bottom; a successful user send explicitly returns the thread to its newest message.
- Native Gorhom sheets now render a plain footer through `NativeSheetFrame`; the
  sheet body cannot render `KeyboardStickyView` or `DrapeKeyboardToolbar`, so
  Gorhom owns the movement and the root toolbar remains the only toolbar.
  The React Native Modal fallback has exactly one owner instead: a fixed sheet
  uses its Modal avoiding view and local toolbar, while a scrollable fallback
  uses its sticky footer and local toolbar.

The first dedicated iOS 1.0.4 Dev client was installed on the C1-free Declutter iPhone SE simulator and loaded the pre-rebase branch from Metro. The replacement client from the rebased head is installed on the C1-free iPhone SE and iPhone 17 Pro Max. Android and the authenticated runtime evidence matrix remain pending.

## Native runtime and over-the-air update safety

This change adds a native module, so the Expo `appVersion` runtime policy remains appropriate only with a new app version. The app version is bumped from `1.0.3` to `1.0.4`, producing a distinct EAS runtime for rebuilt development and store clients.

Do not run `eas update` from `main` to a channel that contains a binary built before this change. In particular, do not reload the C1 development clients onto this JavaScript bundle; rebuild them at `1.0.4` after C1 finishes. The new development clients must be installed before device evidence begins.

## Library and client builds

| Item | Version / identifier |
| --- | --- |
| Expo SDK | 54.0.33 |
| React Native | 0.81.5 |
| Reanimated | 4.1.7 |
| `react-native-keyboard-controller` | 1.18.5 |
| iOS Dev client build ID | EAS `5cd7453c-87d1-4ad6-944e-5a254d7c01e3` (finished 2026-11-10; pre-rebase `5f6476ed`); replacement EAS `56f743af-caaa-4569-9d07-4c35ac9330d4` (finished 2026-11-10; rebased `f593e9ef`) |
| Android Dev client build ID | EAS `90d0ee37-a52c-42ae-9a97-136de720aa15` (finished 2026-11-10; build source `a7768c5e`) |
| Pixel 8 Dev client build ID after C1 | EAS `90d0ee37-a52c-42ae-9a97-136de720aa15` finished; installation remains pending until C1 releases the device |

## Device matrix

Capture short before-and-after videos from main and this branch. On 2026-11-10, C1 confirmed no money action is mid-run and made both iOS simulator sessions and the Pixel available for this UI pass. Both simulators have QA customer sessions signed in; preserve those sessions. The owner's physical iPhone is excluded.

Coordination update (2026-11-10): C1 confirmed no money action is mid-run and
cleared the iPhone SE, iPhone 17 Pro Max, and Pixel for this keyboard pass. Do
not sign out the QA customer sessions or perform any money action.

| Device | Main build ID | Branch build ID | Status | Evidence filenames |
| --- | --- | --- | --- | --- |
| Declutter iPhone SE simulator | Pending | EAS `56f743af-caaa-4569-9d07-4c35ac9330d4` | C1-cleared for this pass; QA customer session remains signed in. Narrow sign-in keyboard fixture passed; authenticated flows remain pending. | `fixtures/ios-se-sign-in-keyboard-rebased.png` |
| iPhone 17 Pro Max simulator | Pending | EAS `56f743af-caaa-4569-9d07-4c35ac9330d4` | C1-cleared for this pass; QA customer session remains signed in. Sign-in last field shows one flush toolbar and Done. Page-sheet and authenticated flows remain pending. | `fixtures/ios-faceid-sign-in-keyboard-rebased.png` |
| Separate Android emulator | Pending | Pending | Pending; no emulator listed by `adb devices` | Pending |
| Pixel 8 | Pending | EAS `90d0ee37-a52c-42ae-9a97-136de720aa15` | C1-cleared for this pass; client installation and UI checks pending. | Pending |
| Owner's physical iPhone | — | — | Unverified; owner pass required | — |

## #114 blocking-review device matrix

This is the required final evidence set for the review finding. Capture only
fixture content and record a branch-build screenshot for each completed row;
the Pixel is available for this pass. Preserve QA sessions and do not take a
money action while reaching these screens.

| Check | iPhone SE | iPhone 17 Pro Max | Pixel 8 | Required observation |
| --- | --- | --- | --- | --- |
| `ConsultationLifecyclePanel` cancellation sheet | Pending | Pending | Pending | Focus its reason field: one toolbar, footer immediately above keyboard, no clipping or double movement. |
| `ReferencePhotoAttributionFields` details sheet | Pending | Pending | Pending | Focus the details field: one toolbar, footer immediately above keyboard, no clipping or double movement. |
| `MessageThread` media/action sheet | Pending | Pending | Pending | Open and close both sheet variants with their inputs where available; one toolbar and a stable footer. |
| Input `Next` / last-field `Done` | Partial: sign-in only | Partial: sign-in only | Pending | Next moved focus without blurring; the last single-line field showed Done on first focus. Repeat in the required sheet inputs. |
| Page-sheet form | Pending | Pending | Pending | On the Face ID device, toolbar is flush above the keyboard with no home-indicator-sized gap. |
| Chat composer | Pending | Pending | Pending | No Drape toolbar above composer; sending a fixture message reaches newest message. |
| Narrow device, 200% text, light and dark | Pending | Pending | Pending | Inputs, labels, errors, caret, footer, and dismissal/reopen remain visible. |
| Android back with keyboard open | — | — | Pending | Back first dismisses keyboard cleanly; reopening the sheet preserves one owner. |

## Priority screen matrix

For each device above, record pass/fail for the keyboard checks below and name the main/branch video files. The Pixel remains pending until the Dev client is installed and the checks are captured. A simulator/emulator result does not replace the later physical-device pass.

| Priority screen / flow | iPhone SE | Large iPhone | Android emulator | Pixel 8 | Main / branch video filenames |
| --- | --- | --- | --- | --- | --- |
| Ready-made checkout | Pending | Pending | Pending | Pending | Pending |
| Customer setup | Pending | Pending | Pending | Pending | Pending |
| Brief | Pending | Pending | Pending | Pending | Pending |
| Measurements and guided fit | Pending | Pending | Pending | Pending | Pending |
| Tailor setup | Pending | Pending | Pending | Pending | Pending |
| Shop / New item | Pending | Pending | Pending | Pending | Pending |
| Tailor quote modal and quote review | Pending | Pending | Pending | Pending | Pending |
| Tailor quote price field: iOS number pad shows Done and the Modal toolbar is visible | Pending | Pending | Pending | Pending | Pending |
| Fulfillment payment | Pending | Pending | Pending | Pending | Pending |
| Payout setup | Pending | Pending | Pending | Pending | Pending |
| Profile edit and personal info | Pending | Pending | Pending | Pending | Pending |
| Sign in and sign up | Pending | Pending | Pending | Pending | Pending |
| Phone country search and phone OTP | Pending | Pending | Pending | Pending | Pending |
| Collection code | Pending | Pending | Pending | Pending | Pending |
| Customer and tailor message threads | Pending | Pending | Pending | Pending | Pending |
| Message thread with photos: opens newest, preserves newest while keyboard/composer grows, and returns to newest after own text, photo, and voice send | Pending | Pending | Pending | Pending | Pending |
| Drape Vision: Garment QC or size-guide form | Pending | Pending | Pending | Pending | Pending |
| Address autocomplete | Pending | Pending | Pending | Pending | Pending |
| One dialog from each of the four order-dialog files | Pending | Pending | Pending | Pending | Pending |

For each priority screen, verify field/label/error/caret visibility, next/previous focus movement, growing multiline text, keyboard-height changes, Done/interactive dismissal/hardware back, dock behavior, sheet dismissal/reopen, 200% text size, and light/dark mode.

## Web checks

On iOS Safari and Android Chrome, check checkout, sign-in, sign-up, and tailor setup for field zoom, focus visibility, and sticky/floating action overlap. Fix only observed web issues.

| Platform / form | Zoom | Field reveal | CTA overlap | Result / evidence |
| --- | --- | --- | --- | --- |
| iOS Safari checkout | Pending | Pending | Pending | Pending |
| iOS Safari sign-in / sign-up | Pending | Pending | Pending | Pending |
| iOS Safari tailor setup | Pending | Pending | Pending | Pending |
| Android Chrome checkout | Pending | Pending | Pending | Pending |
| Android Chrome sign-in / sign-up | Pending | Pending | Pending | Pending |
| Android Chrome tailor setup | Pending | Pending | Pending | Pending |

## Captured device fixtures

These are narrow, reproducible fixtures only. They do not replace a complete
device matrix or establish parity with `main`. The two rebased sign-in fixtures
only establish baseline keyboard behavior; they do not replace the required
authenticated native-sheet, page-sheet, chat, theme, text-size, or Android
checks.

| File | Device / build | Flow | MD5 | Result |
| --- | --- | --- | --- | --- |
| `fixtures/ios-sign-in-keyboard-branch.png` | Declutter iPhone SE; EAS `5cd7453c-87d1-4ad6-944e-5a254d7c01e3`; pre-rebase `5f6476ed` | Empty email field focused on the sign-in form | `f72f958c689c7ab3556f15da5ccc521c` | Historical pre-rebase capture, retained with its checksum. Superseded by the rebased SE fixture below. |
| `fixtures/ios-se-sign-in-keyboard-rebased.png` | Declutter iPhone SE; EAS `56f743af-caaa-4569-9d07-4c35ac9330d4`; rebased `f593e9ef` | Empty email field focused on the sign-in form | `49f7399b2c3034cd4fe2c5b812cc47f1` | One visible Previous / Next / Done toolbar, no clipping on the narrow device. Native Next is available. |
| `fixtures/ios-faceid-sign-in-keyboard-rebased.png` | iPhone 17 Pro Max; EAS `56f743af-caaa-4569-9d07-4c35ac9330d4`; rebased `f593e9ef` | Password field focused on the sign-in form | `d7a53256d5c31f64de1eaffdcdce4994` | One Previous / Next / Done toolbar is flush above the keyboard on the Face ID device; the last field shows Done. This is not a page-sheet result. |

## Verification log

| Check | Result |
| --- | --- |
| Baseline review on `main` | Recorded above before edits |
| Mobile typecheck | Passed on rebased `f593e9ef` (`pnpm --dir apps/mobile typecheck`, Node 22.23.2) |
| Mobile lint | Passed through `pnpm launch:contracts` (0 errors; 401 existing repository warnings) |
| Unit tests | Keyboard guard tests: 7/7 passed; full launch-contract suite passed |
| New keyboard static contract on `main` | Failed as expected: 82 pre-migration findings |
| Nested avoiding/scroll rule on initial #114 head `e8edeb02` | Failed as expected: 51 violations; the exact baseline output is recorded in the task log |
| Native-sheet guard on initial #114 head `e8edeb02` | Failed as expected: it has no `NativeSheetFrame`, so the native sheet body can retain `KeyboardStickyView` and `DrapeKeyboardToolbar` |
| New keyboard static contract on rebased branch | Passed on `f593e9ef`; guard tests 7/7 pass and reject both the initial native-sheet shape and a sticky/footer toolbar inside `NativeSheetFrame` |
| Rebase on latest `origin/main` | Passed on `a2144936`; one import conflict in public Explore was resolved by retaining the main `MarketplaceCategory` type and the branch keyboard imports |
| Keyboard guard tests after latest rebase | Passed: 7/7 |
| Mobile typecheck after latest rebase | Passed on Node 22.23.2 |
| `pnpm launch:contracts` after latest rebase | Passed on Node 22.23.2, base `a2144936` (existing mobile/web lint warnings only) |
| `git diff --check` | Passed after this documentation update |
| Narrow Simulator sign-in keyboard flow | Passed on rebased `f593e9ef`: the C1-free iPhone SE showed one Previous / Next / Done toolbar with no clipping. Fixture and checksum recorded above. |
| Face ID Simulator sign-in focus / last-field check | Passed on rebased `f593e9ef`: native Next moved from the empty email field to password (triggering expected required-email validation), where the last field showed Done on first focus. Return dismissed the keyboard. The flush toolbar fixture is recorded above; it does not prove the separate page-sheet dialog requirement. |
| Other Simulator/emulator flows | Unverified: no modal, chat, Vision, or authenticated-tailor check is claimed. The Dev fixture password is intentionally owner-held rather than stored in the repository. |
| iOS physical-device pass | Unverified; owner must perform |
| Current rebase onto `main` | Passed at `488343e`; rebased code head `5696e5f9` |
| `pnpm launch:contracts` after current rebase | Passed with Node 22.23.2 and `TMPDIR=/private/tmp`; the launch suite and mobile/web lint completed without errors |
