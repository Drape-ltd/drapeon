export async function readOpsRequestContext(mode, runtime) {
  if (mode === 'cloudflare-access') {
    return { headers: await runtime.headers() }
  }
  return { cookies: await runtime.cookies() }
}
