#!/usr/bin/env node

import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

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
const keyboardToolbarPath = 'components/ui/DrapeKeyboardToolbar.tsx'

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

const avoidingViewNames = new Set(['DrapeKeyboardAvoidingView', 'KeyboardAvoidingView'])
const keyboardAwareScrollNames = new Set(['KeyboardAwareScrollView', 'KeyboardAwareModalBody'])
const bottomSheetScaffoldPath = 'components/ui/BottomSheetScaffold.tsx'
const nativeSheetKeyboardComponentNames = new Set(['KeyboardStickyView', 'DrapeKeyboardToolbar'])

function jsxTagName(node) {
  if (ts.isJsxElement(node)) return node.openingElement.tagName.getText()
  if (ts.isJsxSelfClosingElement(node)) return node.tagName.getText()
  return ''
}

function avoidingViewContainsKeyboardAwareScroll(node) {
  let found = false

  function visit(candidate, isRoot = false) {
    if (!isRoot && (ts.isJsxElement(candidate) || ts.isJsxSelfClosingElement(candidate))) {
      const name = jsxTagName(candidate)
      // A Modal owns a different native window. Its body is not adjusted by an
      // avoiding view outside that Modal, and nested avoiders are checked alone.
      if (name === 'Modal' || avoidingViewNames.has(name)) return
      if (keyboardAwareScrollNames.has(name)) {
        found = true
        return
      }
    }
    if (!found) ts.forEachChild(candidate, (child) => visit(child, false))
  }

  ts.forEachChild(node, (child) => visit(child, false))
  return found
}

export function findKeyboardViolations(source, relativePath) {
  const normalizedPath = relativePath.split(path.sep).join('/')
  if (normalizedPath === keyboardToolbarPath) {
    return findDrapeKeyboardToolbarVisibilityViolations(source, normalizedPath)
  }
  if (normalizedPath === bottomSheetScaffoldPath) {
    return findNativeSheetBodyKeyboardViolations(source, normalizedPath)
  }
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

  const sourceFile = ts.createSourceFile(normalizedPath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  function visit(node) {
    if (
      ts.isJsxElement(node) &&
      avoidingViewNames.has(jsxTagName(node)) &&
      avoidingViewContainsKeyboardAwareScroll(node)
    ) {
      const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
      violations.push({
        line: position.line + 1,
        rule: 'Do not wrap a keyboard-aware scroll form in a keyboard avoiding view; the scroll primitive owns keyboard movement.',
      })
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)

  return violations.map((violation) => ({ ...violation, relativePath: normalizedPath, sourceLine: lines[violation.line - 1] ?? '' }))
}

/**
 * `KeyboardToolbar.enabled` only controls KeyboardStickyView movement; it does
 * not hide the child controls. The shared toolbar must unmount when disabled.
 */
export function findDrapeKeyboardToolbarVisibilityViolations(source, relativePath = keyboardToolbarPath) {
  const normalizedPath = relativePath.split(path.sep).join('/')
  const sourceFile = ts.createSourceFile(normalizedPath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const violations = []
  let toolbarComponent = null

  function findToolbarComponent(node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === 'DrapeKeyboardToolbar') {
      toolbarComponent = node
    }
    ts.forEachChild(node, findToolbarComponent)
  }
  findToolbarComponent(sourceFile)

  function isNegatedIdentifier(node, identifier) {
    return ts.isPrefixUnaryExpression(node)
      && node.operator === ts.SyntaxKind.ExclamationToken
      && ts.isIdentifier(node.operand)
      && node.operand.text === identifier
  }

  function returnsNull(node) {
    if (ts.isReturnStatement(node)) return node.expression?.kind === ts.SyntaxKind.NullKeyword
    let found = false
    ts.forEachChild(node, (child) => {
      if (!found && returnsNull(child)) found = true
    })
    return found
  }

  let hasDisabledNullGuard = false
  let rendersKeyboardToolbar = false
  if (toolbarComponent) {
    function inspectComponent(node) {
      if (ts.isIfStatement(node) && ts.isBinaryExpression(node.expression)
        && node.expression.operatorToken.kind === ts.SyntaxKind.BarBarToken) {
        const left = node.expression.left
        const right = node.expression.right
        const guardChecksEnabled = (
          (isNegatedIdentifier(left, 'enabled') && isNegatedIdentifier(right, 'enabledForFocusedInput'))
          || (isNegatedIdentifier(right, 'enabled') && isNegatedIdentifier(left, 'enabledForFocusedInput'))
        )
        if (guardChecksEnabled && returnsNull(node.thenStatement)) hasDisabledNullGuard = true
      }

      if (ts.isJsxElement(node) && jsxTagName(node) === 'KeyboardToolbar') rendersKeyboardToolbar = true
      if (ts.isJsxSelfClosingElement(node) && jsxTagName(node) === 'KeyboardToolbar') rendersKeyboardToolbar = true
      ts.forEachChild(node, inspectComponent)
    }
    inspectComponent(toolbarComponent.body)
  }

  if (!toolbarComponent || !rendersKeyboardToolbar || !hasDisabledNullGuard) {
    const lines = source.split(/\r?\n/u)
    violations.push({
      line: toolbarComponent ? sourceFile.getLineAndCharacterOfPosition(toolbarComponent.getStart(sourceFile)).line + 1 : 1,
      rule: 'DrapeKeyboardToolbar must return null when disabled; KeyboardToolbar.enabled only disables keyboard movement.',
      relativePath: normalizedPath,
      sourceLine: lines[0] ?? '',
    })
  }

  return violations
}

/**
 * Gorhom BottomSheetModal owns its keyboard transition. Its native sheet body
 * may render a plain footer, but must never add a sticky view or a second
 * toolbar; the root keyboard toolbar is already in that native window.
 */
export function findNativeSheetBodyKeyboardViolations(source, relativePath = bottomSheetScaffoldPath) {
  const normalizedPath = relativePath.split(path.sep).join('/')
  const sourceFile = ts.createSourceFile(normalizedPath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const violations = []
  let nativeFrame = null
  let nativeSheetUsesNativeFrame = false

  function findNativeFrame(node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === 'NativeSheetFrame') {
      nativeFrame = node
    }
    ts.forEachChild(node, findNativeFrame)
  }
  findNativeFrame(sourceFile)

  if (!nativeFrame) {
    return [{
      line: 1,
      rule: 'Native BottomSheetModal must use NativeSheetFrame so sheet-level keyboard controls cannot be added.',
      relativePath: normalizedPath,
      sourceLine: source.split(/\r?\n/u)[0] ?? '',
    }]
  }

  function inspectNativeFrame(node) {
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
      const name = jsxTagName(node)
      if (nativeSheetKeyboardComponentNames.has(name)) {
        const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
        violations.push({
          line: position.line + 1,
          rule: `Do not render ${name} inside NativeSheetFrame; Gorhom owns native sheet keyboard movement and the root toolbar.`,
        })
      }
    }
    ts.forEachChild(node, inspectNativeFrame)
  }
  inspectNativeFrame(nativeFrame)

  function findNativeSheetFrameUse(node, insideNativeSheet = false) {
    const isNativeSheet =
      insideNativeSheet ||
      ((ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) && jsxTagName(node) === 'RuntimeBottomSheetModal')
    if (isNativeSheet && (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) && jsxTagName(node) === 'NativeSheetFrame') {
      nativeSheetUsesNativeFrame = true
    }
    ts.forEachChild(node, (child) => findNativeSheetFrameUse(child, isNativeSheet))
  }
  findNativeSheetFrameUse(sourceFile)

  if (!nativeSheetUsesNativeFrame) {
    violations.push({
      line: 1,
      rule: 'RuntimeBottomSheetModal must render NativeSheetFrame for its body.',
    })
  }

  const lines = source.split(/\r?\n/u)
  return violations.map((violation) => ({
    ...violation,
    relativePath: normalizedPath,
    sourceLine: lines[violation.line - 1] ?? '',
  }))
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
