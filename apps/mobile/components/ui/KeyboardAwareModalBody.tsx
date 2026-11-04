import { forwardRef } from 'react'
import {
  KeyboardAwareScrollView,
  type KeyboardAwareScrollViewProps,
} from 'react-native-keyboard-controller'
import { Platform, type ScrollView } from 'react-native'

/** Shared scroll body for native Modal forms. The modal owns avoidance; this body reveals fields. */
export const KeyboardAwareModalBody = forwardRef<ScrollView, KeyboardAwareScrollViewProps>(
  function KeyboardAwareModalBody({
    bottomOffset = Platform.OS === 'android' ? 132 : 104,
    extraKeyboardSpace = 16,
    disableScrollOnKeyboardHide = true,
    keyboardShouldPersistTaps = 'handled',
    keyboardDismissMode = Platform.OS === 'ios' ? 'interactive' : 'on-drag',
    ...props
  }, ref) {
    return (
      <KeyboardAwareScrollView
        ref={ref}
        bottomOffset={bottomOffset}
        extraKeyboardSpace={extraKeyboardSpace}
        disableScrollOnKeyboardHide={disableScrollOnKeyboardHide}
        keyboardShouldPersistTaps={keyboardShouldPersistTaps}
        keyboardDismissMode={keyboardDismissMode}
        {...props}
      />
    )
  },
)

KeyboardAwareModalBody.displayName = 'KeyboardAwareModalBody'
