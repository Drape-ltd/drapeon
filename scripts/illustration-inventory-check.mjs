#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8')
const errors = []

let inventory
try {
  inventory = JSON.parse(read('config/illustration-inventory.json'))
} catch (error) {
  console.error(`Could not read config/illustration-inventory.json: ${error.message}`)
  process.exit(1)
}

if (inventory.version !== 1) errors.push('config/illustration-inventory.json must use version 1.')
if (!Array.isArray(inventory.surfaces) || inventory.surfaces.length === 0) {
  errors.push('Illustration inventory must list at least one surface.')
}

const seenPaths = new Set()
for (const surface of inventory.surfaces ?? []) {
  if (!surface || typeof surface.path !== 'string' || !surface.path.trim()) {
    errors.push('Every illustration inventory entry must include a path.')
    continue
  }
  if (seenPaths.has(surface.path)) errors.push(`Duplicate illustration inventory path: ${surface.path}`)
  seenPaths.add(surface.path)

  let contents
  try {
    contents = read(surface.path)
  } catch {
    errors.push(`Illustration inventory path does not exist: ${surface.path}`)
    continue
  }

  if (!surface.role?.trim()) errors.push(`${surface.path} must describe its illustration role.`)
  if (!Array.isArray(surface.bindings) || surface.bindings.length === 0) {
    errors.push(`${surface.path} must list at least one semantic binding.`)
  }
  for (const binding of surface.bindings ?? []) {
    if (typeof binding !== 'string' || !binding.trim()) {
      errors.push(`${surface.path} contains an empty semantic binding.`)
    } else if (!contents.includes(binding)) {
      errors.push(`${surface.path} must contain its inventory binding ${binding}.`)
    }
  }

  const actualHex = [...new Set(contents.match(/#[0-9A-Fa-f]{3,8}/gu) ?? [])]
    .map((value) => value.toUpperCase())
    .sort()
  const allowedHex = [...new Set((surface.allowedHex ?? []).map((value) => value.toUpperCase()))].sort()
  if (JSON.stringify(actualHex) !== JSON.stringify(allowedHex)) {
    errors.push(
      `${surface.path} literal palette drifted. Expected [${allowedHex.join(', ')}], found [${actualHex.join(', ')}].`
    )
  }
}

if (errors.length) {
  console.error('Illustration inventory check failed:')
  for (const error of errors) console.error(`- ${error}`)
  process.exit(1)
}

console.log('Illustration inventory check passed.')
console.log(`- ${inventory.surfaces.length} web/native illustration surfaces are catalogued with explicit literal exceptions.`)
console.log('- External provider marks and fixed camera chrome are documented exceptions; Drapeon-owned surfaces use semantic anchors.')
