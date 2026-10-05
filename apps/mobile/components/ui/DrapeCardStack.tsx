import { useEffect, useMemo, useRef, useState } from 'react'
import { StyleSheet, View } from 'react-native'
import Animated, { Easing, cancelAnimation, useAnimatedProps, useAnimatedStyle, useSharedValue, withDelay, withRepeat, withSequence, withTiming, type SharedValue } from 'react-native-reanimated'
import Svg, { Path } from 'react-native-svg'
import { SKETCH_FIGURE, type SketchLook, type SketchStroke } from '@/assets/welcome/sketches'
import { Colors, Radius } from '@/constants/theme'

/**
 * A fanned stack of cards that never sits still: every card drifts on its own slow
 * cycle, and every few seconds the front card swings out to the left and tucks behind
 * while the next one rises into its place.
 *
 * Each card builds a garment the way a fashion plate is built: the croquis first, in
 * light construction lines scaled from the Studio pad's own figure guide, then the
 * garment over it, then the wash. Every look carries its own viewBox, so the stack
 * mixes a full figure, a floor-length hem running off the edge and a close bodice
 * study rather than showing the same composition four times.
 */
export type DrapeStackCard = SketchLook

const CARD_WIDTH = 182
const CARD_HEIGHT = 268
const SHUFFLE_INTERVAL = 3400

/** Long enough to read as a hand, short enough to finish before the shuffle. */
const DRAW_DURATION = 1700
const DRAW_DELAY = 240

type StackSlot = { x: number; y: number; rotate: number; scale: number; opacity: number }

/**
 * Front, back-right, back-left, then tucked away. Index is the card's current slot.
 * A card travels front → tucked → back-left → back-right → front, so the one leaving the
 * front goes to the deepest slot and works its way back round.
 */
const SLOTS: readonly StackSlot[] = [
  { x: 0, y: 0, rotate: 0, scale: 1, opacity: 1 },
  { x: 32, y: -14, rotate: 9, scale: 0.94, opacity: 0.97 },
  { x: -32, y: -7, rotate: -9, scale: 0.9, opacity: 0.94 },
  { x: 6, y: -22, rotate: 2, scale: 0.85, opacity: 0.88 },
]

const SETTLE = { duration: 620, easing: Easing.bezier(0.22, 1, 0.36, 1) } as const

export function DrapeCardStack({ cards, reduceMotion = false }: { cards: DrapeStackCard[]; reduceMotion?: boolean }) {
  const [lead, setLead] = useState(0)

  useEffect(() => {
    if (reduceMotion || cards.length < 2) return
    const timer = setInterval(() => setLead((current) => (current + 1) % cards.length), SHUFFLE_INTERVAL)
    return () => clearInterval(timer)
  }, [cards.length, reduceMotion])

  return (
    <View style={styles.stage} accessibilityRole="image" accessibilityLabel={`Outfit sketches: ${cards.map((card) => card.label).join(', ')}`}>
      {cards.map((card, index) => (
        <StackCard
          key={card.id}
          card={card}
          slot={(index - lead + cards.length) % cards.length}
          slotCount={cards.length}
          phase={index * 900}
          period={5200 + index * 700}
          reduceMotion={reduceMotion}
        />
      ))}
    </View>
  )
}

type TimedStroke = SketchStroke & { ink: string; width: number; start: number; span: number }

/**
 * Lays the strokes end to end along one 0→1 timeline, each taking a share of it
 * proportional to its own length. That keeps the pen moving at a constant speed
 * instead of racing through long strokes and crawling through short ones.
 */
function useTimedStrokes(card: DrapeStackCard): TimedStroke[] {
  return useMemo(() => {
    // The croquis goes down first and light, the way a fashion plate is built:
    // construction lines, then the garment on top of them.
    const all = [
      ...SKETCH_FIGURE.map((stroke) => ({ ...stroke, ink: Colors.lightGrey, width: 1 })),
      ...card.strokes.map((stroke) => ({ ...stroke, ink: card.ink, width: stroke.weight === 1 ? 0.95 : 1.9 })),
    ]
    const total = all.reduce((sum, stroke) => sum + stroke.len, 0)
    let travelled = 0
    return all.map((stroke) => {
      const start = travelled / total
      travelled += stroke.len
      return { ...stroke, start, span: stroke.len / total }
    })
  }, [card])
}

const AnimatedPath = Animated.createAnimatedComponent(Path)

const WASH_START = 0.55
const WASH_SPAN = 0.3

function GarmentWash({ d, colour, draw }: { d: string; colour: string; draw: SharedValue<number> }) {
  const animatedProps = useAnimatedProps(() => ({
    fillOpacity: Math.min(1, Math.max(0, (draw.value - WASH_START) / WASH_SPAN)),
  }))
  return <AnimatedPath d={d} fill={colour} fillRule="evenodd" stroke="none" animatedProps={animatedProps} />
}

function SketchPath({ stroke, draw }: { stroke: TimedStroke; draw: SharedValue<number> }) {
  const animatedProps = useAnimatedProps(() => {
    const local = Math.min(1, Math.max(0, (draw.value - stroke.start) / stroke.span))
    return { strokeDashoffset: stroke.len * (1 - local) }
  })
  return (
    <AnimatedPath
      d={stroke.d}
      fill="none"
      stroke={stroke.ink}
      strokeWidth={stroke.width}
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeDasharray={stroke.len}
      animatedProps={animatedProps}
    />
  )
}

function StackCard({ card, slot, slotCount, phase, period, reduceMotion }: { card: DrapeStackCard; slot: number; slotCount: number; phase: number; period: number; reduceMotion: boolean }) {
  const target = SLOTS[Math.min(slot, SLOTS.length - 1)]
  const previousSlot = useRef(slot)
  const x = useSharedValue(target.x)
  const y = useSharedValue(target.y)
  const rotate = useSharedValue(target.rotate)
  const scale = useSharedValue(target.scale)
  const opacity = useSharedValue(target.opacity)
  const drift = useSharedValue(0.5)
  // 0 is blank paper, 1 is the finished sketch.
  const draw = useSharedValue(slot === 0 ? 0 : 1)
  const strokes = useTimedStrokes(card)

  useEffect(() => {
    if (reduceMotion) {
      drift.value = 0.5
      return
    }
    drift.value = withDelay(phase, withRepeat(withTiming(1, { duration: period, easing: Easing.inOut(Easing.sin) }), -1, true))
    return () => cancelAnimation(drift)
  }, [drift, period, phase, reduceMotion])

  // Only the front card draws. Four cards scribbling at once is noise, and a card
  // in the back of the stack needs to be legible, not mid-stroke.
  useEffect(() => {
    if (reduceMotion) {
      draw.value = 1
      return
    }
    if (slot !== 0) {
      draw.value = 1
      return
    }
    draw.value = 0
    draw.value = withDelay(DRAW_DELAY, withTiming(1, { duration: DRAW_DURATION, easing: Easing.inOut(Easing.quad) }))
    return () => cancelAnimation(draw)
  }, [draw, reduceMotion, slot])

  useEffect(() => {
    // Keyed off the caller's card count, not the slot table, so a three-card stack still
    // detects its own wrap-around.
    const leaving = previousSlot.current === 0 && slot === slotCount - 1
    previousSlot.current = slot

    if (reduceMotion) {
      x.value = target.x
      y.value = target.y
      rotate.value = target.rotate
      scale.value = target.scale
      opacity.value = target.opacity
      return
    }

    // The card losing the front slot swings wide before tucking in, so the exit reads as
    // a hand dealing a card rather than a crossfade.
    x.value = leaving
      ? withSequence(withTiming(target.x - 54, { duration: 260, easing: Easing.out(Easing.quad) }), withTiming(target.x, SETTLE))
      : withTiming(target.x, SETTLE)
    rotate.value = leaving
      ? withSequence(withTiming(target.rotate - 9, { duration: 260, easing: Easing.out(Easing.quad) }), withTiming(target.rotate, SETTLE))
      : withTiming(target.rotate, SETTLE)
    y.value = withTiming(target.y, SETTLE)
    scale.value = withTiming(target.scale, SETTLE)
    opacity.value = withTiming(target.opacity, SETTLE)
  }, [opacity, reduceMotion, rotate, scale, slot, slotCount, target, x, y])

  const motionStyle = useAnimatedStyle(() => {
    const sway = drift.value - 0.5
    return {
      opacity: opacity.value,
      transform: [
        { translateX: x.value + sway * 5 },
        { translateY: y.value + sway * 7 },
        { rotate: `${rotate.value + sway * 2.4}deg` },
        { scale: scale.value },
      ],
    }
  })

  return (
    <Animated.View style={[styles.cardShell, { zIndex: slotCount - slot }, motionStyle]}>
      {/* Keep the shadow outside the clipped sketch card. This uses the native
          renderer already present in the DEV client, so the welcome screen can
          be previewed without introducing a new native module. */}
      <View style={styles.cardShadow} pointerEvents="none" />
      <View style={styles.cardBody}>
        <Svg width="100%" height="100%" viewBox={card.view}>
          {strokes.slice(0, SKETCH_FIGURE.length).map((stroke, index) => (
            <SketchPath key={`${card.id}-figure-${index}`} stroke={stroke} draw={draw} />
          ))}
          <GarmentWash d={card.fill} colour={card.wash} draw={draw} />
          {strokes.slice(SKETCH_FIGURE.length).map((stroke, index) => (
            <SketchPath key={`${card.id}-${index}`} stroke={stroke} draw={draw} />
          ))}
        </Svg>
      </View>
    </Animated.View>
  )
}

const styles = StyleSheet.create({
  stage: { height: CARD_HEIGHT + 30, alignItems: 'center', justifyContent: 'center' },
  // The shell carries position and transform but never clips its shadow.
  cardShell: { position: 'absolute', width: CARD_WIDTH, height: CARD_HEIGHT },
  cardShadow: {
    position: 'absolute',
    left: 0,
    top: 0,
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
    borderRadius: Radius.xl,
    backgroundColor: Colors.white,
    shadowColor: Colors.ink,
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.22,
    shadowRadius: 11,
    elevation: 10,
  },
  cardBody: {
    width: '100%',
    height: '100%',
    borderRadius: Radius.xl,
    overflow: 'hidden',
    backgroundColor: Colors.white,
  },
})
