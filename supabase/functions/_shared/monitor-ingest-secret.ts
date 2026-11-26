export async function matchesMonitorSecret(provided: string, legacy = '', list = '') {
  const candidates = [legacy, ...list.split(',')].map((value) => value.trim()).filter(Boolean)
  if (!provided || candidates.length === 0) return false
  const encoder = new TextEncoder()
  const digest = async (value: string) => new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value)))
  const [actual, ...expected] = await Promise.all([provided, ...candidates].map(digest))
  let matched = 0
  for (const candidate of expected) {
    let difference = 0
    for (let index = 0; index < actual.length; index++) difference |= actual[index] ^ candidate[index]
    matched |= Number(difference === 0)
  }
  return matched === 1
}
