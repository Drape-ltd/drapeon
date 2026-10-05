#!/usr/bin/env node
/**
 * Package an existing transparent PNG; this never generates or redraws artwork.
 *
 * node packages/drape-studio/scripts/prepare-everyday-assets.mjs input.png output/stem
 *
 * Writes stem.png and stem.json. Place the PNG at `cropBounds` in the original
 * canvas. `hit.path` contains alpha-derived polygons in original-image pixels;
 * use its evenodd fill rule so holes remain untappable. It is hit-test metadata,
 * not replacement vector artwork. `alphaBounds` uses alpha > 16; the lossless
 * crop uses any alpha > 0 so faint antialiased pixels and shadows survive.
 */
import {createRequire} from 'node:module'
import {mkdir, realpath, writeFile} from 'node:fs/promises'
import {dirname, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'

// Reuse the web workspace's installed dependency; no separate install needed.
const require = createRequire(new URL('../../../apps/web/package.json', import.meta.url))
const sharp = require('sharp')
const MAX_DIMENSION = 800
const BOUNDS_THRESHOLD = 16
const HIT_THRESHOLD = 80

function boundsForAlpha(data, width, height, threshold) {
  let minX = width, minY = height, maxX = -1, maxY = -1
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] <= threshold) continue
      minX = Math.min(minX, x)
      minY = Math.min(minY, y)
      maxX = Math.max(maxX, x)
      maxY = Math.max(maxY, y)
    }
  }
  return maxX < 0 ? null : {x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1}
}

function distanceSquaredToSegment(point, start, end) {
  const dx = end[0] - start[0], dy = end[1] - start[1]
  const t = dx || dy ? Math.max(0, Math.min(1,
    ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / (dx * dx + dy * dy))) : 0
  return (point[0] - start[0] - t * dx) ** 2 + (point[1] - start[1] - t * dy) ** 2
}

function simplifyLine(points, tolerance) {
  if (points.length <= 2) return points
  const keep = new Uint8Array(points.length)
  keep[0] = keep[points.length - 1] = 1
  const pending = [[0, points.length - 1]]
  while (pending.length) {
    const [first, last] = pending.pop()
    let farthest = -1, maxDistance = tolerance * tolerance
    for (let i = first + 1; i < last; i++) {
      const distance = distanceSquaredToSegment(points[i], points[first], points[last])
      if (distance > maxDistance) { maxDistance = distance; farthest = i }
    }
    if (farthest < 0) continue
    keep[farthest] = 1
    pending.push([first, farthest], [farthest, last])
  }
  return points.filter((_, i) => keep[i])
}

function simplifyLoop(points, tolerance) {
  // Remove exact collinear grid vertices before applying bounded simplification.
  const corners = points.filter((point, i) => {
    const previous = points[(i + points.length - 1) % points.length]
    const next = points[(i + 1) % points.length]
    return (point[0] - previous[0]) * (next[1] - point[1]) !==
      (point[1] - previous[1]) * (next[0] - point[0])
  })
  if (corners.length <= 4) return corners
  // Split a closed loop into two open polylines at the most distant vertex.
  let split = 1, farthest = 0
  for (let i = 1; i < corners.length; i++) {
    const distance = (corners[i][0] - corners[0][0]) ** 2 + (corners[i][1] - corners[0][1]) ** 2
    if (distance > farthest) { farthest = distance; split = i }
  }
  const simplified = [
    ...simplifyLine(corners.slice(0, split + 1), tolerance).slice(0, -1),
    ...simplifyLine([...corners.slice(split), corners[0]], tolerance).slice(0, -1),
  ]
  // Very small loops still matter (including holes); do not collapse them.
  return simplified.length >= 3 ? simplified : corners
}

function alphaHitPath(data, width, height, requestedStep) {
  // Four source pixels normally; bounded grid memory for unusually large art.
  const sampleStep = requestedStep ?? Math.max(4, Math.ceil(Math.max(width, height) / 512))
  const columns = Math.ceil(width / sampleStep), rows = Math.ceil(height / sampleStep)
  const mask = new Uint8Array(columns * rows)
  // Any covered pixel keeps narrow straps and accessories. This expands hit
  // coverage by at most one grid cell, without filling larger transparent holes.
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] > HIT_THRESHOLD)
        mask[Math.floor(y / sampleStep) * columns + Math.floor(x / sampleStep)] = 1
    }
  }
  const occupied = (x, y) => x >= 0 && y >= 0 && x < columns && y < rows && mask[y * columns + x]
  const vertexKey = (x, y) => y * (columns + 1) + x
  const edges = new Map()
  const outgoing = new Map()
  function addEdge(x, y, endX, endY, direction) {
    const start = vertexKey(x, y), end = vertexKey(endX, endY)
    const id = start * 4 + direction
    edges.set(id, {start, end, direction, x, y})
    const candidates = outgoing.get(start) || []
    candidates.push(id)
    outgoing.set(start, candidates)
  }
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < columns; x++) {
      if (!occupied(x, y)) continue
      // Clockwise outside boundaries; holes naturally have the reverse winding.
      if (!occupied(x, y - 1)) addEdge(x, y, x + 1, y, 0)
      if (!occupied(x + 1, y)) addEdge(x + 1, y, x + 1, y + 1, 1)
      if (!occupied(x, y + 1)) addEdge(x + 1, y + 1, x, y + 1, 2)
      if (!occupied(x - 1, y)) addEdge(x, y + 1, x, y, 3)
    }
  }
  const loops = []
  // At diagonally touching cells, follow the right turn to keep separate loops.
  const turnRank = [1, 0, 3, 2]
  while (edges.size) {
    let edge = edges.values().next().value
    const start = edge.start, points = []
    while (true) {
      points.push([Math.min(width, edge.x * sampleStep), Math.min(height, edge.y * sampleStep)])
      edges.delete(edge.start * 4 + edge.direction)
      if (edge.end === start) break
      const candidates = (outgoing.get(edge.end) || []).map(id => edges.get(id)).filter(Boolean)
      if (!candidates.length) throw new Error('Alpha contour has an unclosed boundary')
      candidates.sort((a, b) => turnRank[(a.direction - edge.direction + 4) % 4] -
        turnRank[(b.direction - edge.direction + 4) % 4])
      edge = candidates[0]
    }
    loops.push(simplifyLoop(points, sampleStep * 0.6))
  }
  if (!loops.length) throw new Error('PNG has no alpha silhouette above the hit threshold')
  return {
    path: loops.map(points => `M${points.map(point => point.join(' ')).join('L')}Z`).join(''),
    fillRule: 'evenodd',
    coordinateSpace: 'original-image-pixels',
    alphaThreshold: HIT_THRESHOLD,
    sampleStep,
    sampling: 'any-covered-pixel',
    simplifyTolerance: sampleStep * 0.6,
    contours: loops.length,
  }
}

export async function prepareEverydayAsset(inputPath, outputStem, {hitSampleStep} = {}) {
  const input = await realpath(resolve(inputPath))
  const stem = resolve(outputStem.replace(/\.(?:png|json)$/i, ''))
  const pngPath = `${stem}.png`, jsonPath = `${stem}.json`
  // Resolve an existing output as well so a symlink cannot overwrite the source.
  const existingOutput = await realpath(pngPath).catch(error => {
    if (error.code === 'ENOENT') return pngPath
    throw error
  })
  if (input === existingOutput) throw new Error('Output must not overwrite the source PNG')
  const source = sharp(input)
  const metadata = await source.metadata()
  if (metadata.format !== 'png' || !metadata.hasAlpha)
    throw new Error('Input must be a PNG with a real alpha channel')
  if ((metadata.pages || 1) !== 1) throw new Error('Input must be a single-frame PNG')
  const {data, info} = await source.toColourspace('srgb').ensureAlpha().raw().toBuffer({resolveWithObject: true})
  const {width, height} = info
  if (info.channels !== 4) throw new Error('Could not decode the PNG to RGBA')
  let transparentPixels = 0, opaquePixels = 0
  for (let i = 3; i < data.length; i += 4) {
    // Image generators can leave alpha 1 in the background and cap opaque
    // pixels below 255. Validate those endpoints without rewriting any pixels.
    if (data[i] <= 1) transparentPixels++
    if (data[i] >= 250) opaquePixels++
  }
  if (!transparentPixels || !opaquePixels)
    throw new Error('Input needs near-transparent (alpha <= 1) and near-opaque (alpha >= 250) pixels; a painted checkerboard is not transparency')
  const alphaBounds = boundsForAlpha(data, width, height, BOUNDS_THRESHOLD)
  const cropBounds = boundsForAlpha(data, width, height, 0)
  const hit = alphaHitPath(data, width, height, hitSampleStep)
  await mkdir(dirname(stem), {recursive: true})
  const fileInfo = await sharp(input)
    .extract({left: cropBounds.x, top: cropBounds.y, width: cropBounds.width, height: cropBounds.height})
    .resize({width: MAX_DIMENSION, height: MAX_DIMENSION, fit: 'inside', withoutEnlargement: true})
    .png()
    .toFile(pngPath)
  const result = {
    schemaVersion: 1,
    original: {width, height},
    alphaBounds,
    alphaBoundsThreshold: BOUNDS_THRESHOLD,
    cropBounds,
    file: {width: fileInfo.width, height: fileInfo.height},
    hit,
  }
  await writeFile(jsonPath, `${JSON.stringify(result, null, 2)}\n`)
  return result
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [, , inputPath, outputStem, ...extra] = process.argv
  if (!inputPath || !outputStem || extra.length) {
    console.error('Usage: node packages/drape-studio/scripts/prepare-everyday-assets.mjs <input.png> <output-stem>')
    process.exitCode = 1
  } else {
    prepareEverydayAsset(inputPath, outputStem).then(result => {
      console.log(JSON.stringify({outputStem: resolve(outputStem), ...result, hit: {...result.hit, path: `[${result.hit.path.length} characters]`}}, null, 2))
    }).catch(error => { console.error(error.message); process.exitCode = 1 })
  }
}
