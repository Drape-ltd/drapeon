# Batch K keyboard system and Explore presentation

Branch: `codex/keyboard-system`
Rebased on: `main` at `2fa3e7fd` (2026-11-10)

This PR contains the mobile keyboard system, mobile Explore presentation, and shared/web browse-only price and cover presentation. Copy, validation, domain behavior, APIs, server code, databases, Edge Functions, and Production remain out of scope.

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
- A focused QA chat composer must not show the shared toolbar. `KeyboardToolbar`'s `enabled` prop disables keyboard movement but leaves its controls mounted, so `DrapeKeyboardToolbar` now returns `null` when disabled. A launch-contract test guards this behavior.
- Opening the chat attachment-source sheet blurs the composer and dismisses the keyboard before presenting the sheet.
- The chat attachment sheet uses a 60% snap point on narrow iPhones so the source choices and Cancel action remain fully visible.
- Native Gorhom sheets now render a plain footer through `NativeSheetFrame`; the
  sheet body cannot render `KeyboardStickyView` or `DrapeKeyboardToolbar`, so
  Gorhom owns the movement and the root toolbar remains the only toolbar.
  The React Native Modal fallback has exactly one owner instead: a fixed sheet
  uses its Modal avoiding view and local toolbar, while a scrollable fallback
  uses its sticky footer and local toolbar.

The first dedicated iOS 1.0.4 Dev client was installed on the C1-free Declutter iPhone SE simulator and loaded the pre-rebase branch from Metro. The replacement client from the rebased head is installed on the C1-free iPhone SE and iPhone 17 Pro Max. Android and the authenticated runtime evidence matrix remain pending.

## Explore header and browse presentation addition

- `DrapeCategoryTabs` is shared by signed-in customer Explore and signed-out public Explore. Its options still come from `marketplaceCategoriesForUi`; a missing gateway capability produces only `TAILORING`, and the primitive hides the one-option row.
- Sketch Room, Vision, and Guide remain secondary chips. The customer active-orders header now reads “Your orders” / “See all”; horizontal cards show the garment title and tailor on separate single lines, with a centered chevron and a visible next-card peek on narrow screens.
- `formatBrowseMoney` is used only for browse price hints, where whole values omit `.00` and fractional minor units remain visible. `formatMoney` and transaction displays are unchanged.
- The shared cover resolver prefers real portfolio photos, structured images, or video posters over default Drapeon marks. It keeps the mark as a last resort when there is no real media. Mobile public Explore now passes gateway structured media into this resolver.
- Added the public web Streetwear re-land note to the merged [#135](https://github.com/Drape-ltd/drapeon/pull/135) checklist: reuse the icon-above-label tabs and gate them on the read-gateway `STREETWEAR` capability.

### Explore visual evidence status

The requested matrix is incomplete. The signed-in SE and signed-out iPhone 17 Pro Max now run the current `codex/keyboard-system` Metro bundle on port 19084, using the Dev project's publishable key in an ignored local `.env.local`. The SE shows Tailors/Streetwear tabs, secondary chips, a next-card peek, real covers, and whole-number browse prices. The Pro Max public Explore shows both tabs, real covers, and whole-number browse prices. The Pixel is pending for the package conflict described below.

| Current-branch visual | Image | MD5 |
| --- | --- | --- |
| Signed-in SE Explore | `fixtures/ios-se-explore-current-branch.png` | `42314a6301afc91bd3d69ef6cabda940` |
| Public Pro Max Explore | `fixtures/ios-pro-max-public-explore-current-branch.png` | `9412ac2d9e5a1eb07e0417b873f40619` |
| SE message actions, all actions visible | `fixtures/ios-se-message-actions-current-branch.png` | `371354591532e37ccd2c3a5fe622a455` |
| SE chat composer above keyboard, no extra toolbar | `fixtures/ios-se-chat-keyboard-current-branch.png` | `bf164ca2525250361ea45da96a5b3f8a` |
| SE media sheet, all three sources and Cancel visible | `fixtures/ios-se-media-sheet-current-branch.png` | `66afaeeabf5b63e3ed87f75240b9ecb7` |
| Pro Max sign-in after Next, Password focused with Done | `fixtures/ios-pro-max-sign-in-next-done-current-branch.png` | `2ff44e443e1fa2579376acc00dc04035` |
| SE Orders card with exact `$135.31` | `fixtures/ios-se-orders-cents-current-branch.png` | `58b39f29e3168cdb3b191eb16bbcaac1` |

The current SE Orders list displays `$135.31` for the Stripe Regression
ready-made order and the Pixel QA Tailor Gele Set order. This supports the
earlier conclusion that the `$135` report came from stale device code; no
formatter change or V1.1 backlog item is warranted from that observation.

Visual follow-up for the messages batch: the SE simulator renders all five
reaction emoji in the message-actions sheet as replacement boxes. A direct
Apple Color Emoji font override did not change the rendering, so it was
reverted. Check this on a physical device before changing the shared reaction
presentation; the current-branch sheet screenshot records the symptom.

| Screen / condition | iPhone SE | Large iPhone | Android | Evidence status |
| --- | --- | --- | --- | --- |
| Signed-in customer Explore, both categories and secondary chips | Captured on current branch | Pending signed-in session | Pending; Pixel package conflict | SE image above |
| Active orders, long titles, next-card peek | Pending current branch bundle | Pending | Pending; Pixel reserved for C1 | No branch capture |
| Browse whole/fractional prices and real portfolio cover | Pending current branch bundle | Pending | Pending; Pixel reserved for C1 | Unit tests cover formatter and resolver only |
| Signed-out public Explore and missing-capability state | Pending missing-capability state | Public Explore captured; missing-capability pending | Pending | Pro Max image above |

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

Founder-directed visual spot check (2026-11-10): on the iPhone SE and iPhone 17 Pro simulators, focused the QA customer's `Pixel QA Tailor / Dashiki / Danshiki` message composer. After the toolbar fix, the composer stays visible above the software keyboard and no Drape keyboard toolbar appears. On the SE, the attachment sheet now dismisses the keyboard and shows all three media choices with Cancel; the before/after screenshots are recorded below. No message was sent, no media source was selected, and no Stripe Regression thread was opened. This remains a focused check, not completion of the keyboard matrix. The Pro screenshot and rest of the device matrix remain pending.

Coordination update (2026-11-10): C1 confirmed no money action is mid-run and
cleared the iPhone SE, iPhone 17 Pro Max, and Pixel for this keyboard pass. Do
not sign out the QA customer sessions or perform any money action.

Current coordination status (2026-11-10): the owner directed this pass on the
signed-in devices. The Declutter iPhone SE QA customer session was used for a
read-only message-sheet check; no message or payment action was sent. The
Pixel's installed clients remain older than this branch's 1.0.4 Dev client.

The SE exposed an additional defect: a long message preview and reaction row
leave only Reply and part of Translate visible in the message-actions sheet at
its 46% snap point. `MessageThread` now gives multi-action sheets an 88% snap
point (50% for one action). The installed SE client was connected to the older
`0748f680` Metro checkout; its `MessageThread` and sheet components were
byte-identical to this branch before the change. I temporarily applied only
the snap-point change to that Metro source, reopened the same message, and
visually confirmed Reply, Translate, and Report message were all visible. I
then restored the older checkout to its clean state. This is focused component
evidence on the signed-in SE, not a full current-branch bundle pass.

| SE message-actions state | Image | MD5 |
| --- | --- | --- |
| Before, 46% snap point, Report clipped | `fixtures/ios-se-message-actions-clipped-before.png` | `7abfb26a3f80936e4a98af950b84c88e` |
| After, 88% snap point, all actions visible | `fixtures/ios-se-message-actions-expanded-after.png` | `3ca1e942bc4aec5b616c90ea9150292a` |

| Device | Main build ID | Branch build ID | Status | Evidence filenames |
| --- | --- | --- | --- | --- |
| Declutter iPhone SE simulator | Pending | EAS `56f743af-caaa-4569-9d07-4c35ac9330d4`; current JS from port 19084 | QA customer session remains signed in. Current-branch Explore, message actions, and composer keyboard captured. Other authenticated sheet/form flows remain pending. | Current-branch images in the table above; earlier fixture images below |
| iPhone 17 Pro Max simulator | Pending | EAS `56f743af-caaa-4569-9d07-4c35ac9330d4`; current JS from port 19084 | The documented verified Dev tailor is signed in. Public Explore, sign-in, Shop Price, portfolio pageSheet, Specialties, and Clients search keyboard states were captured. The observed Price and pageSheet regressions are fixed; other authenticated flows remain pending. | Current-branch images above and below |
| Separate Android emulator | Pending | Pending | Pending; no emulator listed by `adb devices` | Pending |
| Pixel 8 | Pending | EAS `90d0ee37-a52c-42ae-9a97-136de720aa15` | The 1.0.4 APK is finished but cannot be installed alongside C1: `development` and C1's current app both use `com.drape.app`. Installing with `adb install -r` would replace C1's app/session. No install was attempted. | Pending |
| Owner's physical iPhone | — | — | Unverified; owner pass required | — |

| Additional Pro Max visual finding | Image | MD5 |
| --- | --- | --- |
| Shop / Add item Price focused: toolbar Done plus floating Next | `fixtures/ios-pro-max-shop-price-double-controls-before.png` | `f499dc0f16c490b6af2c8fed738ba138` |
| Shop / Add item Price after: one Drape toolbar, no floating Next | `fixtures/ios-pro-max-shop-price-single-toolbar-after.png` | `a02f914ce90b6ef2e892bb8bc7de03f9` |
| Clients search before: single field shows Next on first focus | `fixtures/ios-pro-max-clients-search-next-before.png` | `e221c5775ade89aaaf2abeacf036f276` |
| Clients search after: single field shows Done on first focus | `fixtures/ios-pro-max-clients-search-done-after.png` | `90f9b69b7e034217b14b81b64cfb3d86` |
| MessageThread media sheet: three choices and Cancel visible | `fixtures/ios-pro-max-message-media-sheet-current.png` | `007b52319145fdff06230e59e7fa9f1d` |
| MessageThread focused composer: no Drapeon toolbar | `fixtures/ios-pro-max-message-composer-no-toolbar-current.png` | `0df7c1d159d77536c023f3dacaaeef47` |
| Customer brief garment picker before: two toolbars and hidden choices | `fixtures/ios-pro-max-brief-garment-picker-double-toolbar-before.png` | `51f75dc7417c9ae56d6d16aae27915a4` |
| Customer brief garment picker after: result visible above keyboard, one native Done | `fixtures/ios-pro-max-brief-garment-picker-single-done-after.png` | `c6f7f9dab9cf1566c89c3958708db9f3` |
| Profile edit / Specialties before: search and options clipped below header | `fixtures/ios-pro-max-specialties-clipped-before.png` | `81041af5a8b223feb1c87a6d4bcd9e64` |
| Profile edit / Specialties after: search and options visible | `fixtures/ios-pro-max-specialties-visible-after.png` | `f6e74d7b02b240be4cdfe7144779ef34` |
| Specialties search before keyboard fix: custom toolbar covers options | `fixtures/ios-pro-max-specialties-keyboard-gap-before.png` | `04ae952d25308831e50907713a40cb9b` |
| Specialties search intermediate: bottom gap reduced, options still covered | `fixtures/ios-pro-max-specialties-keyboard-gap-intermediate.png` | `12da8f17032d782732d0678d45c26e73` |
| Specialties search final: sheet rises above keyboard, options visible, one native Done | `fixtures/ios-pro-max-specialties-keyboard-final-after.png` | `a0cb86d85777021d31f08cd914669423` |
| Portfolio Edit piece pageSheet before: bottom safe-area gap above software keyboard | `fixtures/ios-pro-max-portfolio-page-sheet-before.png` | `c79d92a8c9ef417a50eb7e7d70721d00` |
| Portfolio Edit piece pageSheet after: Details focused, toolbar flush above software keyboard | `fixtures/ios-pro-max-portfolio-page-sheet-after.png` | `5a06cdd0260d60d81f64002d1981371a` |

Changing this Price field's `returnKeyType` to `done` did not remove the floating Next control on the running iOS client; that experiment was reverted. On a repeat Pro Max check, tapping the floating Next dismissed the keyboard and left no field focused when the item had no sizes. React Native's iOS `RCTTextInputComponentView` creates an input accessory for number pads with Next/Done return types, while Drape's root toolbar already supplies those actions. `DrapeTextInput` now defaults number-pad return types to `default`, leaving explicitly supplied return types alone. On the live Pro Max 1.0.4 Dev client, the same Price field showed one Drape toolbar above the number pad and no floating native Next. Other number-pad fields and Android remain unverified.

The signed-in Pro Max revealed another Batch K regression: `KeyboardAwareModalBody` uses a flex child, while the profile Specialties modal had only `maxHeight`. The sheet collapsed to its header and an idle toolbar. Setting the modal to 86% height restored the search and option list. With the software keyboard connected, the custom toolbar covered options and left a gap above the keyboard. This search-only modal now uses a plain scroll body inside one keyboard-avoiding view, removes its bottom safe-area padding while the keyboard is open, and uses the keyboard's native Done key. The final screenshot was recaptured after this structure change and shows the options above the keyboard with one Done control. On the same Pro Max, searching for `Ready` displayed the last `Ready-made` option without clipping; the original Kaftans and Boubou selection was restored before leaving. Scrolling through the full list with the keyboard open and Android behavior remain unverified.

The Pro Max portfolio Edit piece pageSheet exposed the same Face ID gap: its `SafeAreaView` kept the bottom inset while the keyboard was open. The focused Details field left the toolbar floating above the keyboard. The pageSheet now retains the bottom inset only when the keyboard is closed. On the live 1.0.4 Dev client, the first field showed Next, Next focused Details, and its toolbar sat directly over the keyboard without covering the Details label. The before and after screenshots show the gap closing on the same fixture. Other pageSheet forms and the Pixel remain unverified.

The Clients screen has one search input for Customers and Diary. Its Customers keyboard showed Next on first focus despite having no subsequent field. Setting that field's return key to Done produced Done on first focus on the same Pro Max Dev client. Switching to Diary and focusing the same input also showed Done. Both tabs remained empty, and no client data was entered.

The verified Dev tailor switched to the customer side on the same Pro Max and opened an existing Dev order conversation without taking an order or payment action. The media sheet showed Choose from library, Take photo, Record video, and Cancel without clipping; the backdrop closed it. Focusing the empty composer lifted it above the keyboard with no Drapeon toolbar. The thread had no messages, so the message-action sheet and send-to-newest behavior remain unverified. No message was sent.

In a new Dev custom brief for the synthetic Pixel QA Tailor profile, focusing the garment picker search exposed two Done toolbars while the choices sat below the visible sheet. The picker combined a flex child inside a max-height sheet with a second toolbar inside a transparent Modal. It now has a bounded full-height sheet, one keyboard-avoiding owner, a plain scroll list, and the search field's native Done key. On the Pro Max, filtering for `shirt` kept Dress shirt visible and selectable above the keyboard with one Done control. Selecting it returned to step 1; no order was submitted. The saved Dev brief draft is fixture state only. The adjacent brief description field restored its normal Drapeon toolbar after the picker closed. Android and large-text behavior remain unverified.

### Installed-client diagnosis (2026-11-10)

- The Declutter iPhone SE and iPhone 17 Pro Max Dev menus report runtime
  `1.0.4`; both connect to Metro running from this `keyboard-system` worktree.
- A separate iPhone 17 Pro simulator reports runtime `1.0.3` and connects to
  Metro from the unrelated `pr135-fix` checkout. It is not a Batch K test device
  and none of its screenshots count as branch evidence.
- The Pixel's installed packages report `com.drape.app` `1.0.3`,
  `com.drape.app.preview` `1.0.3`, `com.drape.app.studiodev` `1.0.1`, and
  `com.drape.app.qa` `1.0.1`. The finished EAS `90d0ee37-a52c-42ae-9a97-136de720aa15`
  Android Dev client is not installed, so no Pixel UI result is claimed. The
  finished build uses the `development` profile; `app.config.js` maps that
  profile to `com.drape.app`, the same installed package C1 uses. A separate
  test package/build or a C1 release of that app is required before install.

## #114 blocking-review device matrix

This is the required final evidence set for the review finding. Capture only
fixture content and record a branch-build screenshot for each completed row;
the Pixel requires a separate test package or C1 release. Preserve QA sessions and do not take a
money action while reaching these screens.

| Check | iPhone SE | iPhone 17 Pro Max | Pixel 8 | Required observation |
| --- | --- | --- | --- | --- |
| `ConsultationLifecyclePanel` cancellation sheet | Pending | Pending | Pending | Focus its reason field: one toolbar, footer immediately above keyboard, no clipping or double movement. |
| `ReferencePhotoAttributionFields` details sheet | Pending | Pending | Pending | Focus the details field: one toolbar, footer immediately above keyboard, no clipping or double movement. |
| Customer brief garment picker search | Pending | Passed on Pro Max: filtered Dress shirt visible and selectable above keyboard with one native Done | Pending | Search result and close action remain reachable with the keyboard open. |
| `MessageThread` media/action sheet | Partial: all three attachment choices and Cancel visible at 60%; before/after screenshots recorded. Message action sheet remains pending. | Partial: media choices and Cancel visible; backdrop dismissed; message-action sheet pending | Pending | Open and close both sheet variants with their inputs where available; one toolbar and a stable footer. |
| Input `Next` / last-field `Done` | Partial: sign-in only | Partial: sign-in, portfolio Next, and Clients Customers/Diary first-focus Done | Pending | Next moved focus without blurring; the last single-line field showed Done on first focus. Repeat in the required sheet inputs. |
| Page-sheet form | Pending | Portfolio Edit piece passed after the safe-area fix: toolbar flush above keyboard; Next reached Details | Pending | Verify other page-sheet forms and Android separately. |
| Chat composer | Pending | Partial: focused empty composer stayed above keyboard without a Drapeon toolbar; send-to-newest pending | Pending | No Drape toolbar above composer; sending a fixture message reaches newest message. |
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
| Customer and tailor message threads | Partial: composer visible above keyboard, no Drape toolbar; screenshot + MD5 recorded | Partial: composer visual check only; screenshot pending | Pending | Pending | Pending |
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
| `fixtures/ios-se-chat-composer-keyboard-branch.png` | Declutter iPhone SE; EAS `56f743af-caaa-4569-9d07-4c35ac9330d4`; QA customer session | Existing QA conversation with the message composer focused and software keyboard open | `9d0dd7d50ca00ed26428d100d8cbeec2` | Composer stays visible; no Drape keyboard toolbar appears. Fixture-only screen; no message sent. |
| `fixtures/ios-se-message-media-sheet-clipped-before-fix.png` | Declutter iPhone SE; EAS `56f743af-caaa-4569-9d07-4c35ac9330d4`; QA customer session | Send media sheet at the original 44% snap point | `b5467aa8c8bfd9539507f2d00f34e4af` | Before screenshot: Record video is clipped beneath the fixed Cancel action. |
| `fixtures/ios-se-message-media-sheet-branch.png` | Declutter iPhone SE; EAS `56f743af-caaa-4569-9d07-4c35ac9330d4`; QA customer session | Send media sheet after tapping Attach from the focused composer; keyboard dismissed | `be88dad5ff2d4f5d632b2127da29b4a3` | After screenshot: Choose from library, Take photo, Record video, and Cancel are all visible. No source selected and no message sent. |

All six fixture images currently listed here have distinct MD5 checksums.

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
| Chat composer visual spot check | Passed on iPhone SE and iPhone 17 Pro simulators with the QA customer in the Pixel QA Tailor thread: composer stayed visible and no Drape toolbar appeared. No message was sent. SE screenshot and checksum recorded above; Pro screenshot remains pending. Modal, Vision, authenticated-tailor, Android, and new-message-follow behavior are unverified. |
| Chat attachment sheet visual spot check | Passed on iPhone SE after the fix: tapping Attach from the focused composer dismissed the keyboard and the 60% sheet showed all three choices plus Cancel without clipping. Before/after screenshots and MD5s are recorded above. No media source was selected. MessageContextSheet and other devices remain unverified. |
| iOS physical-device pass | Unverified; owner must perform |
| Earlier rebase milestone (superseded) | Passed at `488343e`; later rebased onto `9fada99e` as recorded below |
| Earlier launch-contract run (superseded) | Passed with Node 22.23.2 and `TMPDIR=/private/tmp`; latest run is recorded below |
| Toolbar visibility and SE attachment-sheet fixes | Passed on Node 22.23.2 after the SE attachment-sheet follow-up: `pnpm launch:contracts` and `git diff --check`; keyboard contract tests 9/9, mobile/web typechecks and remaining gate passed. Existing lint warnings only. The initial shell run used Node 18 and failed an unrelated worker-source lexer test; the documented Node 22 run passed. |
| Latest rebase onto `main` | Passed at `2fa3e7fd`; the four new main commits contain Production planning documentation only. The #114 branch was clean after rebase. |
| `pnpm launch:contracts` on latest rebased tree | Passed on Node 22.23.2 at current code head; ran outside the filesystem sandbox because tsx IPC socket binding is denied there |
| Latest mobile and web typechecks | Passed on the latest rebased tree |
| Shared browse-presentation and media tests | Passed: 12/12 |
| Final `git diff --check` | Passed |
| Explore device screenshot matrix | Signed-in SE and public Pro Max captured on the current branch with MD5s above; Android and missing-capability state remain pending. |
| Current environment and device gate | Dev URL and publishable key are held only in an ignored `.env.local`. Current branch runs on Metro port 19084. SE and Pro Max checks above passed. Pixel install is held by its `com.drape.app` package collision with C1. |
| Specialties modal regression follow-up | `pnpm launch:contracts` and `git diff --check` passed on Node 22.23.2 after the sheet height and idle-toolbar fix. Pro Max closed-keyboard before/after screenshot pair and MD5s above; keyboard-open behavior still unverified. |
| 2026-11-10 rebase onto current main | Rebased onto `a1bea1a6` after GitHub reported #114 as conflicting. Resolved the shared `presentation.ts` import conflict by retaining main's explicit `.ts` extensions and Batch K's browse formatter imports. `origin/main` is now an ancestor of the branch. The full `pnpm launch:contracts` gate passed on Node 22.23.2; the sandboxed attempt hit a local `tsx` IPC permission error, then the allowed rerun passed. |
