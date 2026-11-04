import { KeyboardToolbar } from 'react-native-keyboard-controller'
import { getDrapeColors } from '@/constants/theme'

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

export function DrapeKeyboardToolbar() {
  return (
    <KeyboardToolbar
      theme={toolbarTheme}
      doneText="Done"
      showArrows
      accessibilityLabel="Form navigation toolbar"
    />
  )
}
