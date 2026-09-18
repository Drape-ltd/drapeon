import { useCallback, useEffect, useRef } from 'react'
import { BackHandler } from 'react-native'
import { useFocusEffect } from 'expo-router'
import { useContextualBackRegistration } from './contextual-back-registry'

export function useContextualBackHandler(onBack: () => void, enabled = true) {
  const onBackRef = useRef(onBack)
  const registerContextualBack = useContextualBackRegistration()

  useEffect(() => {
    onBackRef.current = onBack
  }, [onBack])

  useFocusEffect(
    useCallback(() => {
      if (!enabled) return undefined

      const unregisterContextualBack = registerContextualBack?.(() => onBackRef.current())
      const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
        onBackRef.current()
        return true
      })

      return () => {
        subscription.remove()
        unregisterContextualBack?.()
      }
    }, [enabled, registerContextualBack]),
  )
}
