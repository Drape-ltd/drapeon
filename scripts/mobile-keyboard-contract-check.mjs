#!/usr/bin/env node

import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
const repositoryRoot = path.resolve(scriptDirectory, '..')
const mobileRootArgument = process.argv.find((argument) => argument.startsWith('--mobile-root='))
const mobileRoot = path.resolve(
  repositoryRoot,
  mobileRootArgument ? mobileRootArgument.slice('--mobile-root='.length) : 'apps/mobile',
)

const keyboardPrimitiveFiles = new Set([
  'components/ui/BottomSheetScaffold.tsx',
  'components/ui/DrapeKeyboardToolbar.tsx',
  'components/ui/DrapePrimitives.tsx',
  'components/ui/DrapeTextInput.tsx',
  'components/ui/KeyboardPrimitives.tsx',
  'components/ui/KeyboardAwareModalBody.tsx',
  'components/ui/KeyboardAwareScrollView.tsx',
  'components/ui/KeyboardToolbar.tsx',
  'components/ui/Screen.tsx',
])

const ignoredDirectories = new Set([
  '.expo',
  'android',
  'build',
  'coverage',
  'dist',
  'ios',
  'node_modules',
  'web-build',
])

export function findKeyboardViolations(source, relativePath) {
  const normalizedPath = relativePath.split(path.sep).join('/')
  if (keyboardPrimitiveFiles.has(normalizedPath)) return []

  const violations = []
  const lines = source.split(/\r?\n/u)
  const lineAt = (offset) => source.slice(0, offset).split(/\r?\n/u).length

  const reactNativeImports = /\bimport\s*(?:type\s*)?\{([^}]*)\}\s*from\s*(['"])react-native\2/gs
  for (const match of source.matchAll(reactNativeImports)) {
    const specifiers = match[1]
      .replace(/\/\*[\s\S]*?\*\//gu, '')
      .replace(/\/\/[^\r\n]*/gu, '')
      .split(',')
    if (specifiers.some((specifier) => /^\s*KeyboardAvoidingView(?:\s+as\s+[A-Za-z_$][\w$]*)?\s*$/u.test(specifier))) {
      violations.push({
        line: lineAt(match.index),
        rule: 'Do not import KeyboardAvoidingView from react-native; use the Drape keyboard primitive.',
      })
    }
  }

  const conditionalBehavior = /\bbehavior\s*=\s*\{[^}]*:\s*undefined[^}]*\}/gsu
  for (const match of source.matchAll(conditionalBehavior)) {
    violations.push({
      line: lineAt(match.index),
      rule: 'Keyboard behavior must be explicitly supported on both platforms; do not use an undefined platform branch.',
    })
  }

  const doubleAdjustment = /\bautomaticallyAdjustKeyboardInsets\b/gu
  for (const match of source.matchAll(doubleAdjustment)) {
    violations.push({
      line: lineAt(match.index),
      rule: 'Keyboard insets are owned by the Drape keyboard primitive; remove screen-level automaticallyAdjustKeyboardInsets.',
    })
  }

  return violations.map((violation) => ({ ...violation, relativePath: normalizedPath, sourceLine: lines[violation.line - 1] ?? '' }))
}

function walk(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isDirectory()) {
      if (ignoredDirectories.has(entry.name)) return []
      return walk(path.join(directory, entry.name))
    }
    return /\.[jt]sx?$/u.test(entry.name) && !entry.name.endsWith('.d.ts')
      ? [path.join(directory, entry.name)]
      : []
  })
}

export function collectKeyboardViolations(root = mobileRoot) {
  return walk(root).flatMap((file) => {
    const relativePath = path.relative(root, file)
    return findKeyboardViolations(readFileSync(file, 'utf8'), relativePath)
  })
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : null
if (invokedPath === fileURLToPath(import.meta.url)) {
  let violations
  try {
    violations = collectKeyboardViolations(mobileRoot)
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  }

  if (violations.length > 0) {
    console.error(`Mobile keyboard contract failed with ${violations.length} violation(s):`)
    for (const violation of violations) {
      console.error(`${violation.relativePath}:${violation.line} ${violation.rule}`)
    }
    process.exit(1)
  }

  console.log('Mobile keyboard contract passed.')
}
