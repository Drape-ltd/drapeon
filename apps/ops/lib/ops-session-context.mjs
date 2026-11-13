export async function readOpsRequestContext(mode, runtime) {
  if (mode === 'cloudflare-access') {
    return { headers: await runtime.headers(), cookies: await runtime.cookies() }
  }
  return { cookies: await runtime.cookies() }
}

// Route handlers already receive the request. Read it directly so their
// session check does not depend on Next's ambient request store.
export function readOpsRouteRequestContext(mode, request) {
  const nextCookies = request.cookies
  if (nextCookies && typeof nextCookies.get === 'function' && typeof nextCookies.getAll === 'function') {
    return mode === 'cloudflare-access'
      ? { headers: request.headers, cookies: nextCookies }
      : { cookies: nextCookies }
  }

  const parsed = new Map()
  for (const part of (request.headers.get('cookie') ?? '').split(';')) {
    const separator = part.indexOf('=')
    if (separator < 1) continue
    const name = part.slice(0, separator).trim()
    const raw = part.slice(separator + 1).trim().replace(/^"|"$/g, '')
    if (!name || !raw) continue
    try {
      const values = parsed.get(name) ?? []
      values.push({ value: decodeURIComponent(raw) })
      parsed.set(name, values)
    } catch {
      // A malformed cookie cannot authenticate a session.
    }
  }
  const context = {
    cookies: {
      get(name) {
        const values = parsed.get(name) ?? []
        return values.length === 1 ? values[0] : undefined
      },
      getAll(name) {
        return parsed.get(name) ?? []
      },
    },
  }
  return mode === 'cloudflare-access' ? { ...context, headers: request.headers } : context
}
