# Batch K keyboard system

Branch: `codex/keyboard-system`  
Baseline: `main` at `60c9f67d6f26d7c18e6cf6ddb635f329683c8704` (2026-11-04)

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

No app-level keyboard failure video has been captured yet. The only attached Android device is the Pixel 8 reserved by C1; there is no Android emulator binary/AVD listed. I did not use either C1 device or create an Android AVD. A dedicated, C1-free iPhone SE simulator is available and has a freshly installed 1.0.4 Dev client. It launched the branch-local bundle and exposed the sign-in email field's native `Next` key; the host locked before the toolbar and focus-transition capture, so this is not recorded as a device pass. Authenticated tailor flows remain unavailable without the owner-held Dev-account credential. The dependency and JS migration are in the task branch, but no generated native source/configuration has been changed.

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

The dedicated iOS 1.0.4 Dev client is installed and the branch-local bundle has launched. Android and the full runtime evidence matrix remain pending. These code changes are not a device pass.

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
| iOS Dev client build ID | Local C1-free iPhone SE installation; app version 1.0.4 (EAS build ID not applicable) |
| Android Dev client build ID | Pending |
| Pixel 8 Dev client build ID after C1 | Pending |

## Device matrix

Capture short before-and-after videos from main and this branch. Use the C1-free devices first; do not use the Pixel 8 until C1 is complete. The owner's physical iPhone is excluded.

| Device | Main build ID | Branch build ID | Status | Evidence filenames |
| --- | --- | --- | --- | --- |
| iPhone SE simulator | Pending | Local Dev client 1.0.4 | Branch bundle launched; sign-in first field exposes native Next. Toolbar/focus capture interrupted by host lock; no pass claimed | Pending |
| Large iPhone simulator | Pending | Pending | Pending; CoreSimulator unavailable | Pending |
| Separate Android emulator | Pending | Pending | Pending; no emulator listed by `adb devices` | Pending |
| Pixel 8 (after C1 only) | Pending | Pending | Reserved by C1 | Pending |
| Owner's physical iPhone | — | — | Unverified; owner pass required | — |

## Priority screen matrix

For each device above, record pass/fail for the keyboard checks below and name the main/branch video files. “Pixel 8” remains pending until C1 is finished. A simulator/emulator result does not replace the later physical-device pass.

| Priority screen / flow | iPhone SE | Large iPhone | Android emulator | Pixel 8 after C1 | Main / branch video filenames |
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

## Verification log

| Check | Result |
| --- | --- |
| Baseline review on `main` | Recorded above before edits |
| Mobile typecheck | Passed after the review correction (`pnpm --dir apps/mobile typecheck`, Node 22.23.2) |
| Mobile lint | Passed through `pnpm launch:contracts` (0 errors; 401 existing repository warnings) |
| Unit tests | Keyboard guard tests: 5/5 passed; full launch-contract suite passed |
| New keyboard static contract on `main` | Failed as expected: 82 pre-migration findings |
| Nested avoiding/scroll rule on initial #114 head `e8edeb02` | Failed as expected: 51 violations; the exact baseline output is recorded in the task log |
| New keyboard static contract on branch | Passed after the review correction |
| `pnpm launch:contracts` on Node 22.23.2 | Passed after the review correction |
| `git diff --check` | Passed after the review correction |
| Simulator/emulator flows | Branch bundle launched on the dedicated iPhone SE; sign-in email resolves to Next. All visual, focus-transition, modal, chat, Vision, and authenticated-flow checks remain pending after host lock. |
| iOS physical-device pass | Unverified; owner must perform |

