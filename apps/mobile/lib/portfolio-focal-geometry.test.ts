import assert from 'node:assert/strict'
import { test } from 'node:test'
import { containedImageRect, focalPointInRect } from './portfolio-focal-geometry.ts'

test('portrait image is centered inside a wide preview and side taps clamp to its edges', () => {
  const rect = containedImageRect({ width: 320, height: 360 }, { width: 800, height: 1600 })
  assert.deepEqual(rect, { left: 70, top: 0, width: 180, height: 360 })
  assert.deepEqual(focalPointInRect(0, 180, rect!), { focalX: 0, focalY: 0.5 })
  assert.deepEqual(focalPointInRect(160, 360, rect!), { focalX: 0.5, focalY: 1 })
})

test('landscape image maps taps inside its top and bottom letterbox', () => {
  const rect = containedImageRect({ width: 320, height: 360 }, { width: 1600, height: 800 })
  assert.deepEqual(rect, { left: 0, top: 100, width: 320, height: 160 })
  assert.deepEqual(focalPointInRect(160, 0, rect!), { focalX: 0.5, focalY: 0 })
})
