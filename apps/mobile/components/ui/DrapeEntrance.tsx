import { useEffect, useState, type ReactNode } from 'react'
import { AccessibilityInfo, Pressable, StyleSheet, Text, View, type PressableProps, type StyleProp, type TextStyle, type ViewStyle } from 'react-native'
import Animated, { Easing, useAnimatedStyle, useSharedValue, withDelay, withSpring, withTiming } from 'react-native-reanimated'

/**
 * First-frame entrance motion, matched to the web brand entrance in
 * apps/web/app/globals.css: the same cubic-bezier(0.22, 1, 0.36, 1) curve and the same
 * rise distance, so opening Drapeon reads the same on both platforms instead of each one
 * inventing its own arrival.
 *
 * Motion here is decorative only. Every element settles at its final layout position,
 * so a reduce-motion viewer loses nothing but the travel.
 */
const CURVE = Easing.bezier(0.22, 1, 0.36, 1)
const RISE_DURATION = 620

export function useReduceMotion(): boolean {
  const [reduceMotion, setReduceMotion] = useState(false)

  useEffect(() => {
    let mounted = true
    AccessibilityInfo.isReduceMotionEnabled()
      .then((enabled) => { if (mounted) setReduceMotion(enabled) })
      .catch(() => { if (mounted) setReduceMotion(false) })
    const subscription = AccessibilityInfo.addEventListener?.('reduceMotionChanged', setReduceMotion)
    return () => {
      mounted = false
      subscription?.remove?.()
    }
  }, [])

  return reduceMotion
}

/** Fades and lifts its children into place. Mirrors `brand-entrance-rise` on web. */
export function DrapeRise({
  delay = 0,
  distance = 18,
  reduceMotion = false,
  style,
  children,
}: {
  delay?: number
  distance?: number
  reduceMotion?: boolean
  style?: StyleProp<ViewStyle>
  children: ReactNode
}) {
  const progress = useSharedValue(reduceMotion ? 1 : 0)

  useEffect(() => {
    if (reduceMotion) {
      progress.value = 1
      return
    }
    progress.value = withDelay(delay, withTiming(1, { duration: RISE_DURATION, easing: CURVE }))
  }, [delay, progress, reduceMotion])

  const motionStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ translateY: (1 - progress.value) * distance }],
  }))

  return <Animated.View style={[style, motionStyle]}>{children}</Animated.View>
}

/** Reveals a headline one word at a time. */
export function DrapeWordReveal({
  lines,
  delay = 0,
  step = 70,
  gap = 10,
  reduceMotion = false,
  textStyle,
}: {
  lines: string[]
  delay?: number
  step?: number
  gap?: number
  reduceMotion?: boolean
  textStyle?: StyleProp<TextStyle>
}) {
  // Each line starts after every word above it has begun, so the stagger reads as one
  // continuous sweep down the headline rather than restarting per line.
  const lineOffsets = lines.reduce<number[]>((offsets, line, index) => {
    offsets.push(index === 0 ? 0 : offsets[index - 1] + lines[index - 1].split(' ').length)
    return offsets
  }, [])

  return (
    <View accessible accessibilityRole="header" accessibilityLabel={lines.join(' ')}>
      {lines.map((line, lineIndex) => {
        const baseDelay = delay + lineOffsets[lineIndex] * step
        const words = line.split(' ')
        return (
          <RevealLine
            key={`${lineIndex}-${line}`}
            words={words}
            baseDelay={baseDelay}
            step={step}
            gap={gap}
            reduceMotion={reduceMotion}
            textStyle={textStyle}
          />
        )
      })}
    </View>
  )
}

function RevealLine({
  words,
  baseDelay,
  step,
  gap,
  reduceMotion,
  textStyle,
}: {
  words: string[]
  baseDelay: number
  step: number
  gap: number
  reduceMotion: boolean
  textStyle?: StyleProp<TextStyle>
}) {
  return (
    <View style={[styles.line, { columnGap: gap }]}>
      {words.map((word, index) => (
        <DrapeRise key={`${word}-${index}`} delay={baseDelay + index * step} distance={14} reduceMotion={reduceMotion}>
          <Text style={textStyle} accessibilityElementsHidden>{word}</Text>
        </DrapeRise>
      ))}
    </View>
  )
}

const PRESS_SPRING = { damping: 18, stiffness: 320, mass: 0.6 } as const

/**
 * A button that takes the press. Opacity alone tells you a tap registered; a scale makes
 * the control feel like it has depth under the finger, which is most of the difference
 * between a prototype and a product.
 */
export function DrapePressScale({
  children,
  style,
  disabled,
  reduceMotion = false,
  ...props
}: PressableProps & {
  children: ReactNode
  style?: StyleProp<ViewStyle>
  reduceMotion?: boolean
}) {
  const pressed = useSharedValue(0)
  const motionStyle = useAnimatedStyle(() => ({ transform: [{ scale: 1 - pressed.value * 0.03 }] }))

  return (
    <Pressable
      disabled={disabled}
      accessibilityRole={props.accessibilityRole ?? 'button'}
      onPressIn={(event) => {
        if (!reduceMotion && !disabled) pressed.value = withSpring(1, PRESS_SPRING)
        props.onPressIn?.(event)
      }}
      onPressOut={(event) => {
        pressed.value = withSpring(0, PRESS_SPRING)
        props.onPressOut?.(event)
      }}
      {...props}
    >
      <Animated.View style={[style, motionStyle]}>{children}</Animated.View>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  line: { flexDirection: 'row', flexWrap: 'wrap', alignSelf: 'flex-start' },
})
