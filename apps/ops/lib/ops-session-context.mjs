export async function readOpsRequestContext(mode, runtime) {
  if (mode === 'cloudflare-access') {
    return { headers: await runtime.headers() }
  }
  return { cookies: await runtime.cookies() }
}

// Route handlers already receive the request. Read it directly so their
// session check does not depend on Next's ambient request store.
export function readOpsRouteRequestContext(mode, request) {
  if (mode === 'cloudflare-access') return { headers: request.headers }

  const nextCookies = request.cookies
  if (nextCookies && typeof nextCookies.get === 'function' && typeof nextCookies.getAll === 'function') {
    return { cookies: nextCookies }
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
  return {
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
}
