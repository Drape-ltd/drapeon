import type { ComponentProps } from 'react'
import { KeyboardAvoidingView as ControllerKeyboardAvoidingView } from 'react-native-keyboard-controller'

export type DrapeKeyboardAvoidingViewProps = ComponentProps<typeof ControllerKeyboardAvoidingView>

/** Drapeon keyboard avoidance primitive backed by KeyboardController. */
export function DrapeKeyboardAvoidingView(props: DrapeKeyboardAvoidingViewProps) {
  return <ControllerKeyboardAvoidingView {...props} />
}
