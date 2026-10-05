#!/usr/bin/env node

import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

export function validateReleaseSource({ branch, status, head, remoteHead }) {
  const errors = []
  if (branch !== 'main') errors.push(`Release app builds require main; current branch is ${branch || '(detached)'}.`)
  if (status.trim()) errors.push('The checkout has uncommitted or untracked files.')
  if (!/^[0-9a-f]{40}$/u.test(head)) errors.push('Could not resolve the local HEAD commit.')
  if (!/^[0-9a-f]{40}$/u.test(remoteHead)) errors.push('Could not resolve the live origin/main commit.')
  if (head && remoteHead && head !== remoteHead) errors.push('Local HEAD does not match the live origin/main commit.')
  return errors
}

function git(root, ...args) {
  return execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    timeout: 15_000,
    maxBuffer: 10 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()
}

export function runReleaseSourceGuard(root = resolve(dirname(fileURLToPath(import.meta.url)), '..')) {
  try {
    const branch = git(root, 'branch', '--show-current')
    const status = git(root, 'status', '--porcelain=v1', '--untracked-files=all')
    const head = git(root, 'rev-parse', 'HEAD')
    const remoteLine = git(root, 'ls-remote', 'origin', 'refs/heads/main')
    const remoteHead = remoteLine.split(/\s/u)[0] ?? ''
    const errors = validateReleaseSource({ branch, status, head, remoteHead })
    if (errors.length) {
      for (const error of errors) console.error(`[release source] ${error}`)
      return false
    }
    console.log(`[release source] Clean main matches live origin/main: ${head}`)
    return true
  } catch (error) {
    console.error(`[release source] Could not verify the live production source: ${error.message}`)
    return false
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!runReleaseSourceGuard()) process.exitCode = 1
}
