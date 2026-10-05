/**
 * Welcome-screen sketches, authored in the sketch pad's own 182 × 268 card space.
 *
 * Every look opens with the same thread — identical entry and exit points on the
 * card edge — so as the stack shuffles the line appears to run straight through
 * from one card into the next. One thread, every look.
 *
 * `len` is each stroke's measured length, used as the dash length so the draw
 * finishes exactly when the stroke does. Regenerate with
 * scripts/measure-sketches.mjs if the artwork changes.
 */
export type SketchStroke = { d: string; len: number; weight?: number }
export type SketchLook = { id: string; view: string; label: string; ink: string; fill: string; wash: string; strokes: SketchStroke[] }

export const SKETCH_FIGURE: SketchStroke[] = [{d:'M67 56Q91 51 115 56',len:49},{d:'M91 18Q101 18 101 31Q101 45 91 45Q81 45 81 31Q81 18 91 18',len:77},{d:'M87 45Q86 50 86 56',len:12},{d:'M95 45Q96 50 96 56',len:12},{d:'M67 56Q73 76 76 95Q70 112 68 122Q71 145 73 161Q79 192 84 250',len:198},{d:'M115 56Q109 76 106 95Q112 112 114 122Q111 145 109 161Q103 192 98 250',len:198},{d:'M67 57Q59 77 61 97Q63 112 64 126',len:71},{d:'M115 57Q123 77 121 97Q119 112 118 126',len:71},{d:'M89 136Q86 180 86 248',len:113},{d:'M93 136Q96 180 96 248',len:113}]

export const SKETCH_LOOKS: SketchLook[] = [
  {
    id: 'celebration',
    view: '22 14 138 203',
    label: 'Agbada, fila and beads',
    ink: '#ad684f',
    fill: 'M62 54Q38 72 32 118Q43 124 56 121Q57 150 58 182Q91 196 124 182Q125 150 126 121Q139 124 150 118Q144 72 120 54Q91 48 62 54Z',
    wash: '#e6d0c5',
    strokes: [
      {
        d: 'M62 54Q91 48 120 54',
        len: 59,
        weight: 2
      },
      {
        d: 'M62 54Q38 72 32 118',
        len: 73,
        weight: 2
      },
      {
        d: 'M32 118Q43 124 56 121',
        len: 25,
        weight: 2
      },
      {
        d: 'M120 54Q144 72 150 118',
        len: 73,
        weight: 2
      },
      {
        d: 'M150 118Q139 124 126 121',
        len: 25,
        weight: 2
      },
      {
        d: 'M56 121Q57 150 58 182',
        len: 62,
        weight: 2
      },
      {
        d: 'M126 121Q125 150 124 182',
        len: 62,
        weight: 2
      },
      {
        d: 'M58 182Q91 196 124 182',
        len: 68,
        weight: 2
      },
      {
        d: 'M83 54Q91 64 99 53',
        len: 20,
        weight: 2
      },
      {
        d: 'M91 66Q93 108 91 150',
        len: 85,
        weight: 1
      },
      {
        d: 'M74 76Q70 124 72 178',
        len: 103,
        weight: 1
      },
      {
        d: 'M108 77Q112 125 110 179',
        len: 103,
        weight: 1
      },
      {
        d: 'M66 88Q62 104 60 118',
        len: 31,
        weight: 1
      },
      {
        d: 'M84 58Q91 66 98 57',
        len: 17,
        weight: 1
      },
      {
        d: 'M80 72Q91 78 102 72',
        len: 24,
        weight: 1
      },
      {
        d: 'M34 112Q44 118 55 115',
        len: 22,
        weight: 1
      },
      {
        d: 'M148 112Q138 118 127 115',
        len: 22,
        weight: 1
      },
      {
        d: 'M60 126Q61 152 62 178',
        len: 53,
        weight: 1
      },
      {
        d: 'M122 126Q121 152 120 178',
        len: 53,
        weight: 1
      },
      {
        d: 'M62 177Q91 189 120 177',
        len: 60,
        weight: 1
      }
    ]
  },
  {
    id: 'pattern-presence',
    view: '26 -6 134 197',
    label: 'Mermaid dress and gele',
    ink: '#264c40',
    fill: 'M74 56Q71 76 72 96Q66 118 67 140Q66 162 65 180Q57 212 44 248Q91 260 138 248Q125 212 117 180Q116 162 115 140Q116 118 110 96Q111 76 108 56Q91 50 74 56Z',
    wash: '#bec8c1',
    strokes: [
      {
        d: 'M74 56Q91 50 108 56',
        len: 35,
        weight: 2
      },
      {
        d: 'M74 56Q71 76 72 96',
        len: 41,
        weight: 2
      },
      {
        d: 'M108 56Q111 76 110 96',
        len: 41,
        weight: 2
      },
      {
        d: 'M72 96Q66 118 67 140Q66 162 65 180',
        len: 85,
        weight: 2
      },
      {
        d: 'M110 96Q116 118 115 140Q116 162 117 180',
        len: 85,
        weight: 2
      },
      {
        d: 'M65 180Q57 212 44 248',
        len: 72,
        weight: 2
      },
      {
        d: 'M117 180Q125 212 138 248',
        len: 72,
        weight: 2
      },
      {
        d: 'M44 248Q91 260 138 248',
        len: 96,
        weight: 2
      },
      {
        d: 'M72 96Q91 101 110 96',
        len: 39,
        weight: 1
      },
      {
        d: 'M80 186Q72 214 62 242',
        len: 59,
        weight: 1
      },
      {
        d: 'M102 186Q110 214 120 242',
        len: 59,
        weight: 1
      },
      {
        d: 'M91 190Q89 216 87 244',
        len: 55,
        weight: 1
      },
      {
        d: 'M80 60Q78 80 79 96',
        len: 37,
        weight: 1
      },
      {
        d: 'M102 60Q104 80 103 96',
        len: 37,
        weight: 1
      },
      {
        d: 'M76 94Q80 99 84 94',
        len: 10,
        weight: 1
      },
      {
        d: 'M98 94Q102 99 106 94',
        len: 10,
        weight: 1
      },
      {
        d: 'M91 58Q91 78 91 96',
        len: 38,
        weight: 1
      },
      {
        d: 'M47 244Q91 256 135 244',
        len: 90,
        weight: 1
      },
      {
        d: 'M67 178Q91 185 115 178',
        len: 49,
        weight: 1
      }
    ]
  },
  {
    id: 'after-hours',
    view: '56 22 70 103',
    label: 'Flared dress and heels',
    ink: '#6c5675',
    fill: 'M80 58Q76 78 75 96Q60 150 46 206Q91 222 136 206Q122 150 107 96Q106 78 102 58Q91 64 80 58Z',
    wash: '#d3cbd1',
    strokes: [
      {
        d: 'M78 48Q79 53 80 58',
        len: 11,
        weight: 2
      },
      {
        d: 'M104 48Q103 53 102 58',
        len: 11,
        weight: 2
      },
      {
        d: 'M80 58Q91 64 102 58',
        len: 24,
        weight: 2
      },
      {
        d: 'M80 58Q76 78 75 96',
        len: 39,
        weight: 2
      },
      {
        d: 'M102 58Q106 78 107 96',
        len: 39,
        weight: 2
      },
      {
        d: 'M75 96Q60 150 46 206',
        len: 114,
        weight: 2
      },
      {
        d: 'M107 96Q122 150 136 206',
        len: 114,
        weight: 2
      },
      {
        d: 'M46 206Q91 222 136 206',
        len: 92,
        weight: 2
      },
      {
        d: 'M75 96Q91 102 107 96',
        len: 33,
        weight: 1
      },
      {
        d: 'M84 106Q77 152 70 200',
        len: 96,
        weight: 1
      },
      {
        d: 'M98 106Q105 152 112 200',
        len: 96,
        weight: 1
      },
      {
        d: 'M91 108Q90 156 90 204',
        len: 97,
        weight: 1
      },
      {
        d: 'M83 64Q82 80 82 94',
        len: 31,
        weight: 1
      },
      {
        d: 'M99 64Q100 80 100 94',
        len: 31,
        weight: 1
      },
      {
        d: 'M49 202Q91 217 133 202',
        len: 86,
        weight: 1
      },
      {
        d: 'M78 50Q79 54 79 57',
        len: 8,
        weight: 1
      },
      {
        d: 'M104 50Q103 54 103 57',
        len: 8,
        weight: 1
      }
    ]
  },
  {
    id: 'soft-tailoring',
    view: '-6 2 194 286',
    label: 'Jacket and trousers',
    ink: '#365875',
    fill: 'M62 54Q57 92 59 128Q70 132 82 129L100 129Q112 132 123 128Q125 92 120 54Q91 48 62 54ZM72 129Q67 180 65 244Q76 248 86 245Q88 190 90 136Q92 190 94 245Q106 248 117 244Q115 180 110 129Z',
    wash: '#c3ccd1',
    strokes: [
      {
        d: 'M62 54Q91 48 120 54',
        len: 59,
        weight: 2
      },
      {
        d: 'M62 54Q57 92 59 128',
        len: 75,
        weight: 2
      },
      {
        d: 'M120 54Q125 92 123 128',
        len: 75,
        weight: 2
      },
      {
        d: 'M59 128Q70 132 82 129',
        len: 24,
        weight: 2
      },
      {
        d: 'M123 128Q112 132 100 129',
        len: 24,
        weight: 2
      },
      {
        d: 'M82 55Q86 70 91 82Q96 70 100 55',
        len: 57,
        weight: 2
      },
      {
        d: 'M72 129Q67 180 65 244Q76 248 86 245Q88 190 90 136',
        len: 246,
        weight: 2
      },
      {
        d: 'M110 129Q115 180 117 244Q106 248 96 245Q94 190 92 136',
        len: 246,
        weight: 2
      },
      {
        d: 'M82 55Q81 92 82 129',
        len: 75,
        weight: 1
      },
      {
        d: 'M100 55Q101 92 100 129',
        len: 75,
        weight: 1
      },
      {
        d: 'M66 70Q63 96 62 120',
        len: 51,
        weight: 1
      },
      {
        d: 'M82 62L87 67',
        len: 8,
        weight: 1
      },
      {
        d: 'M100 62L95 67',
        len: 8,
        weight: 1
      },
      {
        d: 'M64 104H76',
        len: 0,
        weight: 1
      },
      {
        d: 'M106 104H118',
        len: 0,
        weight: 1
      },
      {
        d: 'M60 120H70',
        len: 0,
        weight: 1
      },
      {
        d: 'M112 120H122',
        len: 0,
        weight: 1
      },
      {
        d: 'M76 142Q75 192 74 240',
        len: 99,
        weight: 1
      },
      {
        d: 'M106 142Q107 192 108 240',
        len: 99,
        weight: 1
      },
      {
        d: 'M72 132Q91 136 110 132',
        len: 39,
        weight: 1
      },
      {
        d: 'M88 96Q90 96 90 98Q90 100 88 100Q86 100 86 98Q86 96 88 96',
        len: 13,
        weight: 1
      },
      {
        d: 'M88 110Q90 110 90 112Q90 114 88 114Q86 114 86 112Q86 110 88 110',
        len: 13,
        weight: 1
      }
    ]
  }
]
