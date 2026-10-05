import { useEffect, useState } from 'react'
import { PixelRatio, StyleSheet, Text, useColorScheme, useWindowDimensions } from 'react-native'
import Animated, { Easing, runOnJS, useAnimatedStyle, useSharedValue, withDelay, withTiming } from 'react-native-reanimated'
import Svg, { Line } from 'react-native-svg'
import { colors, darkColors } from '@drape/shared/design-system'
import { Fonts, FontWeight } from '@/constants/theme'

/**
 * The exit flourish for the native splash. The native splash itself is a static image and
 * cannot animate, so this overlay renders the identical frame, finishes the thought with a
 * stitched thread, and lifts away to reveal the app.
 *
 * Because the wordmark here has to line up with the one baked into assets/splash.png, its
 * size is derived from how `resizeMode: contain` scales that canvas on this device rather
 * than hardcoded. A mismatch would read as a jump at the handoff.
 */
const SPLASH_CANVAS = { width: 1284, height: 2778, fontSize: 140 }

const CURVE = Easing.bezier(0.22, 1, 0.36, 1)
/** Lets the native splash's own 450ms fade get out of the way before the thread starts. */
const START_DELAY = 180
const THREAD_DURATION = 320
const EXIT_DELAY = 380
const EXIT_DURATION = 280
/** Nothing should be able to leave this overlay on screen. */
export const SPLASH_SEQUENCE_FAILSAFE_MS = 2600

function useSplashWordmarkSize() {
  const { width, height } = useWindowDimensions()
  const density = PixelRatio.get()
  const scale = Math.min((width * density) / SPLASH_CANVAS.width, (height * density) / SPLASH_CANVAS.height)
  return (SPLASH_CANVAS.fontSize * scale) / density
}

export function DrapeSplashSequence({ start, onDone }: { start: boolean; onDone: () => void }) {
  const isDark = useColorScheme() === 'dark'
  const fontSize = useSplashWordmarkSize()
  const [threadWidth, setThreadWidth] = useState(0)
  const background = isDark ? darkColors.background : colors.background
  const ink = isDark ? darkColors.statusSuccess : colors.primary

  const thread = useSharedValue(0)
  const exit = useSharedValue(0)

  useEffect(() => {
    // Mounted from app start so it is already painted beneath the native splash. Nothing
    // moves until the native splash has actually begun to go, or the first frames of the
    // sequence would play behind an opaque image nobody can see through.
    if (!start) return

    thread.value = withDelay(START_DELAY, withTiming(1, { duration: THREAD_DURATION, easing: CURVE }))
    exit.value = withDelay(
      START_DELAY + EXIT_DELAY,
      withTiming(1, { duration: EXIT_DURATION, easing: CURVE }, (finished) => {
        if (finished) runOnJS(onDone)()
      }),
    )
    // Belt and braces: if the animation is interrupted (backgrounded mid-launch, a dropped
    // frame callback), the overlay still leaves rather than stranding the app behind it.
    const failsafe = setTimeout(onDone, SPLASH_SEQUENCE_FAILSAFE_MS)
    return () => clearTimeout(failsafe)
  }, [exit, onDone, start, thread])

  const shellStyle = useAnimatedStyle(() => ({ opacity: 1 - exit.value }))
  const markStyle = useAnimatedStyle(() => ({ transform: [{ translateY: -exit.value * 10 }] }))
  const threadStyle = useAnimatedStyle(() => ({ width: threadWidth * thread.value }))

  return (
    <Animated.View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[StyleSheet.absoluteFill, styles.shell, { backgroundColor: background }, shellStyle]}
    >
      <Animated.View style={markStyle}>
        <Text
          style={[styles.wordmark, { fontSize, lineHeight: fontSize * 1.16, color: ink }]}
          onLayout={(event) => setThreadWidth(event.nativeEvent.layout.width)}
        >
          Drapeon
        </Text>
        {threadWidth > 0 ? (
          <Animated.View style={[styles.threadClip, threadStyle]}>
            <Svg width={threadWidth} height={4}>
              <Line x1={1} y1={2} x2={threadWidth - 1} y2={2} stroke={ink} strokeWidth={1.8} strokeLinecap="round" strokeDasharray="5 5" />
            </Svg>
          </Animated.View>
        ) : null}
      </Animated.View>
    </Animated.View>
  )
}

const styles = StyleSheet.create({
  shell: { alignItems: 'center', justifyContent: 'center', zIndex: 9999, elevation: 9999 },
  wordmark: { fontFamily: Fonts.display, fontWeight: FontWeight.semibold, letterSpacing: -1 },
  threadClip: { height: 4, overflow: 'hidden', alignSelf: 'center', marginTop: 6 },
})
