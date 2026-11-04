import { createContext, forwardRef, useContext, type ReactNode } from 'react'
import { KeyboardController } from 'react-native-keyboard-controller'
import {
  TextInput,
  type TextInputProps,
  type TextInputSubmitEditingEventData,
  type NativeSyntheticEvent,
} from 'react-native'
import { bottomSheetRuntime } from '@/lib/native-sheet-runtime'

const BottomSheetInputContext = createContext(false)

export function DrapeBottomSheetInputScope({ children }: { children: ReactNode }) {
  return <BottomSheetInputContext.Provider value>{children}</BottomSheetInputContext.Provider>
}

/**
 * Drapeon's shared input keeps standard submit behavior intact and provides a
 * keyboard Next action when a single-line field has no screen-specific submit
 * handler. Inside Gorhom sheets it delegates focus tracking to BottomSheetTextInput.
 */
export const DrapeTextInput = forwardRef<TextInput, TextInputProps>(function DrapeTextInput(
  { multiline, returnKeyType, onSubmitEditing, ...props },
  ref,
) {
  const insideBottomSheet = useContext(BottomSheetInputContext)
  const BottomSheetTextInput = insideBottomSheet
    ? bottomSheetRuntime?.BottomSheetTextInput
    : null
  const InputComponent = BottomSheetTextInput ?? TextInput
  const resolvedReturnKeyType = returnKeyType ?? (multiline ? undefined : onSubmitEditing ? 'done' : 'next')
  const handleSubmit = (event: NativeSyntheticEvent<TextInputSubmitEditingEventData>) => {
    onSubmitEditing?.(event)
    if (resolvedReturnKeyType === 'next') {
      KeyboardController.setFocusTo('next')
    }
  }

  return (
    <InputComponent
      {...props}
      ref={ref}
      multiline={multiline}
      returnKeyType={resolvedReturnKeyType}
      onSubmitEditing={handleSubmit}
    />
  )
})

DrapeTextInput.displayName = 'DrapeTextInput'
