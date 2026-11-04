import { forwardRef } from 'react'
import {
  KeyboardAwareScrollView as NativeKeyboardAwareScrollView,
  type KeyboardAwareScrollViewProps as ControllerKeyboardAwareScrollViewProps,
} from 'react-native-keyboard-controller'
import { Platform, type ScrollView } from 'react-native'

export type KeyboardAwareScrollViewProps = Omit<ControllerKeyboardAwareScrollViewProps, 'bottomOffset'> & {
  /** Extra space to keep labels, errors, and sticky controls above the keyboard. */
  keyboardClearance?: number
  bottomOffset?: number
}

/**
 * Drapeon's scrolling form primitive. Keyboard movement and focused-input reveal
 * are owned by react-native-keyboard-controller; screens only add any extra
 * clearance required by their own sticky content.
 */
export const KeyboardAwareScrollView = forwardRef<ScrollView, KeyboardAwareScrollViewProps>(
  function KeyboardAwareScrollView({
    keyboardClearance,
    bottomOffset = keyboardClearance ?? (Platform.OS === 'android' ? 132 : 104),
    extraKeyboardSpace = 16,
    disableScrollOnKeyboardHide = true,
    keyboardShouldPersistTaps = 'handled',
    keyboardDismissMode = Platform.OS === 'ios' ? 'interactive' : 'on-drag',
    scrollEventThrottle = 16,
    ...props
  }, ref) {
    return (
      <NativeKeyboardAwareScrollView
        ref={ref}
        bottomOffset={bottomOffset}
        extraKeyboardSpace={extraKeyboardSpace}
        disableScrollOnKeyboardHide={disableScrollOnKeyboardHide}
        keyboardShouldPersistTaps={keyboardShouldPersistTaps}
        keyboardDismissMode={keyboardDismissMode}
        scrollEventThrottle={scrollEventThrottle}
        {...props}
      />
    )
  },
)

KeyboardAwareScrollView.displayName = 'KeyboardAwareScrollView'
