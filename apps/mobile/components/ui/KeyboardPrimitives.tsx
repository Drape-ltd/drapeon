import type { ComponentProps } from 'react'
import { KeyboardAvoidingView as ControllerKeyboardAvoidingView } from 'react-native-keyboard-controller'
import { DrapeKeyboardToolbar, DRAPE_KEYBOARD_TOOLBAR_HEIGHT } from './DrapeKeyboardToolbar'

export type DrapeKeyboardAvoidingViewProps = ComponentProps<typeof ControllerKeyboardAvoidingView>

/** Drapeon keyboard avoidance primitive backed by KeyboardController. */
export function DrapeKeyboardAvoidingView(props: DrapeKeyboardAvoidingViewProps) {
  return <ControllerKeyboardAvoidingView {...props} />
}

/**
 * Use for a fixed form in a native Modal. The toolbar must live in the Modal's
 * native window, and the avoiding view reserves its height when the keyboard opens.
 */
export function DrapeKeyboardFormAvoidingView({
  keyboardVerticalOffset = DRAPE_KEYBOARD_TOOLBAR_HEIGHT,
  ...props
}: DrapeKeyboardAvoidingViewProps) {
  return (
    <>
      <ControllerKeyboardAvoidingView
        {...props}
        keyboardVerticalOffset={keyboardVerticalOffset}
      />
      <DrapeKeyboardToolbar />
    </>
  )
}
