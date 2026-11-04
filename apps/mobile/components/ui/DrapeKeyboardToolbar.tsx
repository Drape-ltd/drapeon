import { useSyncExternalStore } from 'react'
import { KeyboardToolbar } from 'react-native-keyboard-controller'
import { getDrapeColors } from '@/constants/theme'

export const DRAPE_KEYBOARD_TOOLBAR_HEIGHT = 42

let toolbarEnabledForFocusedInput = true
const toolbarListeners = new Set<() => void>()

export function setDrapeKeyboardToolbarEnabledForFocusedInput(enabled: boolean) {
  if (toolbarEnabledForFocusedInput === enabled) return
  toolbarEnabledForFocusedInput = enabled
  toolbarListeners.forEach((listener) => listener())
}

function subscribeToToolbarState(listener: () => void) {
  toolbarListeners.add(listener)
  return () => toolbarListeners.delete(listener)
}

function readToolbarState() {
  return toolbarEnabledForFocusedInput
}

const light = getDrapeColors('light')
const dark = getDrapeColors('dark')

const toolbarTheme = {
  light: {
    primary: light.needleGreenDark,
    disabled: light.midGrey,
    background: light.surface,
    ripple: light.lightGrey,
  },
  dark: {
    primary: dark.needleGreenLight,
    disabled: dark.midGrey,
    background: dark.surface,
    ripple: dark.lightGrey,
  },
} as const

export function DrapeKeyboardToolbar({ enabled = true }: { enabled?: boolean }) {
  const enabledForFocusedInput = useSyncExternalStore(
    subscribeToToolbarState,
    readToolbarState,
    readToolbarState,
  )

  return (
    <KeyboardToolbar
      enabled={enabled && enabledForFocusedInput}
      theme={toolbarTheme}
      doneText="Done"
      showArrows
      accessibilityLabel="Form navigation toolbar"
    />
  )
}
