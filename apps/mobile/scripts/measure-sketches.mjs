/* Measures each stroke so the draw animation can run on real path lengths.
   Only M, L and Q are used in the artwork, so a small sampler is exact enough
   and avoids shipping a path library to the app. */
import { writeFileSync } from 'node:fs'

/* The croquis, scaled from the Studio pad's own figure guide so the welcome
   cards and the sketch pad share one set of proportions. Drawn light, like the
   construction lines on a fashion plate — the garment goes on top of it.
   The shoulder line stops at the shoulders: run edge to edge it read as a
   horizon slicing the card rather than a construction line. */
const FIGURE = [
  'M67 56Q91 51 115 56',
  'M91 18Q101 18 101 31Q101 45 91 45Q81 45 81 31Q81 18 91 18',
  'M87 45Q86 50 86 56',
  'M95 45Q96 50 96 56',
  'M67 56Q73 76 76 95Q70 112 68 122Q71 145 73 161Q79 192 84 250',
  'M115 56Q109 76 106 95Q112 112 114 122Q111 145 109 161Q103 192 98 250',
  'M67 57Q59 77 61 97Q63 112 64 126',
  'M115 57Q123 77 121 97Q119 112 118 126',
  'M89 136Q86 180 86 248',
  'M93 136Q96 180 96 248',
]

const LOOKS = [
  {
    id: 'celebration', view: '22 14 138 203', label: 'Agbada, fila and beads', ink: '#ad684f',
    fill: 'M62 54Q38 72 32 118Q43 124 56 121Q57 150 58 182Q91 196 124 182Q125 150 126 121Q139 124 150 118Q144 72 120 54Q91 48 62 54Z',
    outline: [
      'M62 54Q91 48 120 54',
      'M62 54Q38 72 32 118',
      'M32 118Q43 124 56 121',
      'M120 54Q144 72 150 118',
      'M150 118Q139 124 126 121',
      'M56 121Q57 150 58 182',
      'M126 121Q125 150 124 182',
      'M58 182Q91 196 124 182',
      'M83 54Q91 64 99 53',
    ],
    detail: [
      'M91 66Q93 108 91 150',
      'M74 76Q70 124 72 178',
      'M108 77Q112 125 110 179',
      'M66 88Q62 104 60 118',
          'M84 58Q91 66 98 57',
      'M80 72Q91 78 102 72',
      'M34 112Q44 118 55 115',
      'M148 112Q138 118 127 115',
      'M60 126Q61 152 62 178',
      'M122 126Q121 152 120 178',
      'M62 177Q91 189 120 177',
],
  },
  {
    id: 'pattern-presence', view: '26 -6 134 197', label: 'Mermaid dress and gele', ink: '#264c40',
    fill: 'M74 56Q71 76 72 96Q66 118 67 140Q66 162 65 180Q57 212 44 248Q91 260 138 248Q125 212 117 180Q116 162 115 140Q116 118 110 96Q111 76 108 56Q91 50 74 56Z',
    outline: [
      'M74 56Q91 50 108 56',
      'M74 56Q71 76 72 96',
      'M108 56Q111 76 110 96',
      'M72 96Q66 118 67 140Q66 162 65 180',
      'M110 96Q116 118 115 140Q116 162 117 180',
      'M65 180Q57 212 44 248',
      'M117 180Q125 212 138 248',
      'M44 248Q91 260 138 248',
    ],
    detail: [
      'M72 96Q91 101 110 96',
      'M80 186Q72 214 62 242',
      'M102 186Q110 214 120 242',
      'M91 190Q89 216 87 244',
          'M80 60Q78 80 79 96',
      'M102 60Q104 80 103 96',
      'M76 94Q80 99 84 94',
      'M98 94Q102 99 106 94',
      'M91 58Q91 78 91 96',
      'M47 244Q91 256 135 244',
      'M67 178Q91 185 115 178',
],
  },
  {
    id: 'after-hours', view: '56 22 70 103', label: 'Flared dress and heels', ink: '#6c5675',
    fill: 'M80 58Q76 78 75 96Q60 150 46 206Q91 222 136 206Q122 150 107 96Q106 78 102 58Q91 64 80 58Z',
    outline: [
      'M78 48Q79 53 80 58',
      'M104 48Q103 53 102 58',
      'M80 58Q91 64 102 58',
      'M80 58Q76 78 75 96',
      'M102 58Q106 78 107 96',
      'M75 96Q60 150 46 206',
      'M107 96Q122 150 136 206',
      'M46 206Q91 222 136 206',
    ],
    detail: [
      'M75 96Q91 102 107 96',
      'M84 106Q77 152 70 200',
      'M98 106Q105 152 112 200',
      'M91 108Q90 156 90 204',
          'M83 64Q82 80 82 94',
      'M99 64Q100 80 100 94',
      'M49 202Q91 217 133 202',
      'M78 50Q79 54 79 57',
      'M104 50Q103 54 103 57',
],
  },
  {
    id: 'soft-tailoring', view: '-6 2 194 286', label: 'Jacket and trousers', ink: '#365875',
    fill: 'M62 54Q57 92 59 128Q70 132 82 129L100 129Q112 132 123 128Q125 92 120 54Q91 48 62 54ZM72 129Q67 180 65 244Q76 248 86 245Q88 190 90 136Q92 190 94 245Q106 248 117 244Q115 180 110 129Z',
    outline: [
      'M62 54Q91 48 120 54',
      'M62 54Q57 92 59 128',
      'M120 54Q125 92 123 128',
      'M59 128Q70 132 82 129',
      'M123 128Q112 132 100 129',
      'M82 55Q86 70 91 82Q96 70 100 55',
      'M72 129Q67 180 65 244Q76 248 86 245Q88 190 90 136',
      'M110 129Q115 180 117 244Q106 248 96 245Q94 190 92 136',
    ],
    detail: [
      'M82 55Q81 92 82 129',
      'M100 55Q101 92 100 129',
      'M66 70Q63 96 62 120',
          'M82 62L87 67',
      'M100 62L95 67',
      'M64 104H76',
      'M106 104H118',
      'M60 120H70',
      'M112 120H122',
      'M76 142Q75 192 74 240',
      'M106 142Q107 192 108 240',
      'M72 132Q91 136 110 132',
      'M88 96Q90 96 90 98Q90 100 88 100Q86 100 86 98Q86 96 88 96',
      'M88 110Q90 110 90 112Q90 114 88 114Q86 114 86 112Q86 110 88 110',
],
  },
]

/* The wash is the ink mixed into paper at 11% and emitted solid, not a
   translucent overlay. Translucent, the croquis read straight through the
   cloth; opaque, the figure is hidden where fabric covers it and still shows
   where skin does — which is how a finished plate reads. At 11% it was so pale
   the four cards were indistinguishable; 30% gives each one a fabric. */
const PAPER = [255, 253, 248]
const mix = (hex, amount) => '#' + [1, 3, 5]
  .map(i => Math.round(PAPER[(i - 1) / 2] - amount * (PAPER[(i - 1) / 2] - parseInt(hex.slice(i, i + 2), 16))))
  .map(v => v.toString(16).padStart(2, '0')).join('')

const dist = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1])
function length(d) {
  const tokens = d.match(/[MLQ][^MLQ]*/g) ?? []
  let total = 0, at = [0, 0]
  for (const token of tokens) {
    const kind = token[0]
    const n = token.slice(1).trim().split(/[\s,]+/).filter(Boolean).map(Number)
    if (kind === 'M') { at = [n[0], n[1]] }
    else if (kind === 'L') { for (let i = 0; i < n.length; i += 2) { const to = [n[i], n[i + 1]]; total += dist(at, to); at = to } }
    else {
      // Sample the quadratic; 24 steps is well inside a pixel at this scale.
      for (let i = 0; i < n.length; i += 4) {
        const c = [n[i], n[i + 1]], to = [n[i + 2], n[i + 3]]
        let prev = at
        for (let s = 1; s <= 24; s++) {
          const t = s / 24, u = 1 - t
          const p = [u * u * at[0] + 2 * u * t * c[0] + t * t * to[0], u * u * at[1] + 2 * u * t * c[1] + t * t * to[1]]
          total += dist(prev, p); prev = p
        }
        at = to
      }
    }
  }
  return Math.ceil(total)
}

// Outline carries the silhouette and takes the weight; detail is drape and
// seams, drawn lighter. One pen width for everything is what made the first
// passes read as plotted rather than drawn.
const out = LOOKS.map(look => ({
  id: look.id, view: look.view, label: look.label, ink: look.ink, fill: look.fill, wash: mix(look.ink, 0.3),
  strokes: [
    ...look.outline.map(d => ({ d, len: length(d), weight: 2 })),
    ...look.detail.map(d => ({ d, len: length(d), weight: 1 })),
  ],
}))
const figure = FIGURE.map(d => ({ d, len: length(d) }))

const file = `/**
 * Welcome-screen sketches, authored in the sketch pad's own 182 × 268 card space.
 *
 * Every look opens with the same thread — identical entry and exit points on the
 * card edge — so as the stack shuffles the line appears to run straight through
 * from one card into the next. One thread, every look.
 *
 * \`len\` is each stroke's measured length, used as the dash length so the draw
 * finishes exactly when the stroke does. Regenerate with
 * scripts/measure-sketches.mjs if the artwork changes.
 */
export type SketchStroke = { d: string; len: number; weight?: number }
export type SketchLook = { id: string; view: string; label: string; ink: string; fill: string; wash: string; strokes: SketchStroke[] }

export const SKETCH_FIGURE: SketchStroke[] = ${JSON.stringify(figure).replace(/"([a-z]+)":/g, '$1:').replace(/"/g, "'")}

export const SKETCH_LOOKS: SketchLook[] = ${JSON.stringify(out, null, 2)
  .replace(/"([a-z]+)":/g, '$1:')
  .replace(/"/g, "'")}
`
writeFileSync(process.argv[2], file)
console.log('figure', figure.length, 'strokes')
for (const look of out) console.log(look.id.padEnd(18), look.strokes.length, 'strokes,', look.strokes.reduce((s, x) => s + x.len, 0), 'units')
