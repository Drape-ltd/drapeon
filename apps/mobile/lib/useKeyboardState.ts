import { useKeyboardState as useControllerKeyboardState } from 'react-native-keyboard-controller'

type KeyboardState = {
  visible: boolean
  height: number
}

export function useKeyboardState(): KeyboardState {
  const state = useControllerKeyboardState()
  return { visible: state.isVisible, height: state.height }
}
