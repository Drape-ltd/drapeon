import assert from 'node:assert/strict'
import test from 'node:test'
import { findNonLatin1, findNonLatin1RegexLiterals } from './worker-source-encoding.mjs'

test('Latin-1 text (including £ and accented letters) passes', () => {
  assert.equal(findNonLatin1('price £20, café, ¿qué? ÿ').count, 0)
})

test('characters above U+00FF are reported with code points', () => {
  const { count, hits } = findNonLatin1('a ₦ b € c')
  assert.equal(count, 2)
  assert.deepEqual(hits.map((hit) => hit.codePoint), ['U+20A6', 'U+20AC'])
})

test('raw non-Latin-1 regex literals are flagged with their line', () => {
  const source = "const x = 1\nconst strip = (v: string) => v.replace(/[₦$£€₵]/g, '')\n"
  assert.deepEqual(findNonLatin1RegexLiterals(source, 'x.ts'), [{ line: 2, literal: '/[₦$£€₵]/g' }])
})

test('escaped regex literals, strings, templates and comments are not flagged', () => {
  const source = [
    "const a = /[\\u20A6$\\u00A3\\u20AC\\u20B5]/g",
    "const b = '₦50,000'",
    'const c = `€${a}`',
    '// ₵ comment',
    'const d = /£/',
    'const e = <span title="₦">₦</span>',
  ].join('\n')
  assert.deepEqual(findNonLatin1RegexLiterals(source, 'x.tsx'), [])
})
