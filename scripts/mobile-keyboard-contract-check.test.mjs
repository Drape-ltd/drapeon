import assert from 'node:assert/strict'
import test from 'node:test'
import {
  findKeyboardViolations,
  findNativeSheetBodyKeyboardViolations,
} from './mobile-keyboard-contract-check.mjs'

test('rejects KeyboardAvoidingView imported from react-native, including aliases', () => {
  const violations = findKeyboardViolations(
    "import { View, KeyboardAvoidingView as NativeAvoider } from 'react-native'",
    'app/example.tsx',
  )

  assert.equal(violations.length, 1)
  assert.match(violations[0].rule, /Drape keyboard primitive/u)
})

test('rejects a platform behavior branch that is undefined on one platform', () => {
  const violations = findKeyboardViolations(
    `<KeyboardAvoidingView\n  behavior={Platform.OS === 'ios' ? 'padding' : undefined}\n/>`,
    'app/example.tsx',
  )

  assert.equal(violations.length, 1)
  assert.match(violations[0].rule, /both platforms/u)
})

test('rejects screen-owned automatic keyboard insets', () => {
  const violations = findKeyboardViolations(
    '<ScrollView automaticallyAdjustKeyboardInsets={Platform.OS === \'ios\'} />',
    'app/example.tsx',
  )

  assert.equal(violations.length, 1)
  assert.match(violations[0].rule, /Drape keyboard primitive/u)
})

test('rejects the nested avoiding and keyboard-aware scroll pattern from the initial Batch K branch', () => {
  const violations = findKeyboardViolations(
    `
      import { DrapeKeyboardAvoidingView as KeyboardAvoidingView } from '@/components/ui/KeyboardPrimitives'
      import { KeyboardAwareScrollView } from '@/components/ui/KeyboardAwareScrollView'
      <KeyboardAvoidingView behavior="padding">
        <KeyboardAwareScrollView />
      </KeyboardAvoidingView>
    `,
    'app/example.tsx',
  )

  assert.equal(violations.length, 1)
  assert.match(violations[0].rule, /scroll primitive owns keyboard movement/u)
})

test('allows platform handling inside the shared Drape keyboard primitives', () => {
  const violations = findKeyboardViolations(
    "import { KeyboardAvoidingView } from 'react-native'\n<KeyboardAvoidingView automaticallyAdjustKeyboardInsets behavior={Platform.OS === 'ios' ? 'padding' : undefined} />",
    'components/ui/KeyboardAwareScrollView.tsx',
  )

  assert.deepEqual(violations, [])
})

test('rejects the initial Batch K native sheet shape that had no dedicated keyboard-free frame', () => {
  const violations = findNativeSheetBodyKeyboardViolations(
    `
      function SheetFrame() {
        return <><KeyboardStickyView /><DrapeKeyboardToolbar /></>
      }
      function BottomSheetScaffold() {
        return <RuntimeBottomSheetModal><SheetFrame useNativeSheetBody /></RuntimeBottomSheetModal>
      }
    `,
  )

  assert.equal(violations.length, 1)
  assert.match(violations[0].rule, /must use NativeSheetFrame/u)
})

test('rejects sticky footers and toolbars inside the native sheet frame', () => {
  const violations = findNativeSheetBodyKeyboardViolations(
    `
      function NativeSheetFrame() {
        return <><KeyboardStickyView /><DrapeKeyboardToolbar /></>
      }
      function BottomSheetScaffold() {
        return <RuntimeBottomSheetModal><NativeSheetFrame /></RuntimeBottomSheetModal>
      }
    `,
  )

  assert.equal(violations.length, 2)
  assert.match(violations[0].rule, /KeyboardStickyView/u)
  assert.match(violations[1].rule, /DrapeKeyboardToolbar/u)
})
