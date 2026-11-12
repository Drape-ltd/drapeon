// Cloudflare Workers keep the whole bundled script source in the isolate's V8
// heap for its lifetime. V8 stores that source as a one-byte (Latin-1) string
// only when every character is <= U+00FF; a single character above that makes
// it a two-byte (UTF-16) string, doubling the cost. For the ~24M-character
// OpenNext bundle that is ~47 MB instead of ~24 MB of a 128 MB isolate, which
// pushed concurrent SSR renders over the limit (Cloudflare error 1102).
//
// esbuild (used by Wrangler) escapes non-ASCII characters in strings, template
// literals, identifiers and comments, but leaves regular-expression literals
// untouched. So the class of bug is: a raw non-Latin-1 character inside a regex
// literal, in our source or in a dependency. Write such characters as \uXXXX.
import { createRequire } from 'node:module'

export const LATIN1_MAX = 0xff

export function findNonLatin1(text, { limit = 20, context = 60 } = {}) {
  const hits = []
  let count = 0
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)
    if (code <= LATIN1_MAX) continue
    count++
    if (hits.length < limit) {
      hits.push({
        index: i,
        char: text[i],
        codePoint: `U+${code.toString(16).toUpperCase().padStart(4, '0')}`,
        context: text.slice(Math.max(0, i - context), i + context).replace(/\s+/g, ' '),
      })
    }
  }
  return { count, hits }
}

let ts
function typescript() {
  if (!ts) ts = createRequire(import.meta.url)('typescript')
  return ts
}

// Returns regex literals in a JS/TS source file that contain a raw character
// above U+00FF, with 1-based line numbers.
export function findNonLatin1RegexLiterals(sourceText, fileName = 'file.ts') {
  const tsc = typescript()
  const kind = /\.(tsx|jsx)$/.test(fileName) ? tsc.ScriptKind.TSX : tsc.ScriptKind.TS
  const sourceFile = tsc.createSourceFile(fileName, sourceText, tsc.ScriptTarget.Latest, true, kind)
  const found = []
  const visit = (node) => {
    if (node.kind === tsc.SyntaxKind.RegularExpressionLiteral) {
      const text = node.getText(sourceFile)
      const { count } = findNonLatin1(text, { limit: 0 })
      if (count > 0) {
        const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
        found.push({ line: line + 1, literal: text })
      }
    }
    tsc.forEachChild(node, visit)
  }
  visit(sourceFile)
  return found
}
