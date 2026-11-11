import { forwardRef } from 'react'
import { Platform, StyleSheet, View, type ScrollView } from 'react-native'
import {
  KeyboardAwareScrollView,
  type KeyboardAwareScrollViewProps,
} from './KeyboardAwareScrollView'
import { useKeyboardState } from 'react-native-keyboard-controller'
import { DrapeKeyboardToolbar } from './DrapeKeyboardToolbar'

/** Shared scroll body for native Modal forms. The modal owns avoidance; this body reveals fields. */
export const KeyboardAwareModalBody = forwardRef<ScrollView, KeyboardAwareScrollViewProps>(
  function KeyboardAwareModalBody({
    bottomOffset = Platform.OS === 'android' ? 132 : 104,
    extraKeyboardSpace = 16,
    disableScrollOnKeyboardHide = true,
    keyboardShouldPersistTaps = 'handled',
    keyboardDismissMode = Platform.OS === 'ios' ? 'interactive' : 'on-drag',
    style,
    ...props
  }, ref) {
    const keyboardVisible = useKeyboardState((state) => state.isVisible)
    return (
      <View style={styles.formFrame}>
        <KeyboardAwareScrollView
          ref={ref}
          style={[styles.scroll, style]}
          bottomOffset={bottomOffset}
          extraKeyboardSpace={extraKeyboardSpace}
          disableScrollOnKeyboardHide={disableScrollOnKeyboardHide}
          keyboardShouldPersistTaps={keyboardShouldPersistTaps}
          keyboardDismissMode={keyboardDismissMode}
          {...props}
        />
        {keyboardVisible ? <DrapeKeyboardToolbar /> : null}
      </View>
    )
  },
)

KeyboardAwareModalBody.displayName = 'KeyboardAwareModalBody'

const styles = StyleSheet.create({
  formFrame: { flex: 1 },
  scroll: { flex: 1 },
})
