#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const footerPath = path.join(root, 'apps/web/components/site-footer.tsx')
const footer = fs.readFileSync(footerPath, 'utf8')
const errors = []

// Keep public footer links honest: a branded relationship surface is only
// useful when its recovery/help destination resolves in the same web build.
const hrefs = [
  ...footer.matchAll(/href:\s*'([^']+)'/gu),
  ...footer.matchAll(/href="(\/[^"\n]+)"/gu),
].map((match) => match[1].split('?')[0])

const routes = [...new Set(hrefs.filter((href) => href.startsWith('/')))]
for (const route of routes) {
  const relativePage = route === '/' ? 'apps/web/app/page.tsx' : `apps/web/app${route}/page.tsx`
  if (!fs.existsSync(path.join(root, relativePage))) {
    errors.push(`${route} is linked from SiteFooter but has no ${relativePage}.`)
  }
}

for (const requiredRoute of ['/help', '/faq', '/whats-new']) {
  if (!routes.includes(requiredRoute)) {
    errors.push(`${requiredRoute} must remain discoverable from SiteFooter.`)
  }
}

if (errors.length) {
  console.error('Public route contract failed:')
  for (const error of errors) console.error(`- ${error}`)
  process.exit(1)
}

console.log('Public route contract passed.')
console.log(`- ${routes.length} footer destinations resolve in the web app.`)
