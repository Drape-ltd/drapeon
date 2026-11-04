import { createContext, forwardRef, useContext, useEffect, useState, type ReactNode } from 'react'
import { FocusedInputEvents, KeyboardController } from 'react-native-keyboard-controller'
import {
  TextInput,
  type TextInputProps,
  type TextInputFocusEventData,
  type TextInputSubmitEditingEventData,
  type NativeSyntheticEvent,
} from 'react-native'
import { bottomSheetRuntime } from '@/lib/native-sheet-runtime'
import { setDrapeKeyboardToolbarEnabledForFocusedInput } from './DrapeKeyboardToolbar'

const BottomSheetInputContext = createContext(false)

export function DrapeBottomSheetInputScope({ children }: { children: ReactNode }) {
  return <BottomSheetInputContext.Provider value>{children}</BottomSheetInputContext.Provider>
}

/**
 * Drapeon's shared input keeps standard submit behavior intact and provides a
 * keyboard Next action when a single-line field has no screen-specific submit
 * handler. Inside Gorhom sheets it delegates focus tracking to BottomSheetTextInput.
 */
export type DrapeTextInputProps = TextInputProps & {
  /** Disable the shared toolbar for a pinned single-field composer such as chat. */
  keyboardToolbarEnabled?: boolean
}

export const DrapeTextInput = forwardRef<TextInput, DrapeTextInputProps>(function DrapeTextInput(
  {
    multiline,
    returnKeyType,
    submitBehavior,
    onSubmitEditing,
    onFocus,
    onBlur,
    keyboardToolbarEnabled = true,
    ...props
  },
  ref,
) {
  const insideBottomSheet = useContext(BottomSheetInputContext)
  const [focused, setFocused] = useState(false)
  const [focusedInputState, setFocusedInputState] = useState({ current: -1, count: 0 })

  useEffect(() => {
    const subscription = FocusedInputEvents.addListener('focusDidSet', setFocusedInputState)
    return () => subscription.remove()
  }, [])

  const BottomSheetTextInput = insideBottomSheet
    ? bottomSheetRuntime?.BottomSheetTextInput
    : null
  const InputComponent = BottomSheetTextInput ?? TextInput
  const ownsReturnKeyType = returnKeyType == null
  const isLastField = focused && focusedInputState.count > 0 && focusedInputState.current === focusedInputState.count - 1
  const resolvedReturnKeyType = returnKeyType ?? (multiline ? undefined : onSubmitEditing || isLastField ? 'done' : 'next')
  const resolvedSubmitBehavior = submitBehavior ?? (
    resolvedReturnKeyType === 'next'
      ? 'submit'
      : ownsReturnKeyType && !multiline
        ? 'blurAndSubmit'
        : undefined
  )
  const handleSubmit = (event: NativeSyntheticEvent<TextInputSubmitEditingEventData>) => {
    onSubmitEditing?.(event)
    if (resolvedReturnKeyType === 'next') {
      // iOS finishes handling the IME submit after this callback. Waiting one
      // frame preserves the keyboard and gives the native focus navigator the
      // current input hierarchy instead of the just-submitted field state.
      requestAnimationFrame(() => KeyboardController.setFocusTo('next'))
    }
  }

  return (
    <InputComponent
      {...props}
      ref={ref}
      multiline={multiline}
      returnKeyType={resolvedReturnKeyType}
      submitBehavior={resolvedSubmitBehavior}
      onSubmitEditing={handleSubmit}
      onFocus={(event: NativeSyntheticEvent<TextInputFocusEventData>) => {
        setFocused(true)
        setDrapeKeyboardToolbarEnabledForFocusedInput(keyboardToolbarEnabled)
        onFocus?.(event)
      }}
      onBlur={(event: NativeSyntheticEvent<TextInputFocusEventData>) => {
        setFocused(false)
        setDrapeKeyboardToolbarEnabledForFocusedInput(true)
        onBlur?.(event)
      }}
    />
  )
})

DrapeTextInput.displayName = 'DrapeTextInput'
