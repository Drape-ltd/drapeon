export async function findBlockedMediaUrlsInBatches(
  urls: string[],
  lookup: (batch: string[]) => Promise<Set<string>>,
  batchSize = 24,
  maxConcurrency = 4,
): Promise<Set<string>> {
  const unique = [...new Set(urls.map((url) => url.trim()).filter(Boolean))]
  const blocked = new Set<string>()
  const size = Math.max(1, Math.floor(batchSize))
  const concurrency = Math.max(1, Math.floor(maxConcurrency))

  for (let offset = 0; offset < unique.length; offset += size * concurrency) {
    const wave = unique.slice(offset, offset + size * concurrency)
    const batches: string[][] = []
    for (let index = 0; index < wave.length; index += size) {
      batches.push(wave.slice(index, index + size))
    }
    const results = await Promise.all(batches.map(lookup))
    for (const result of results) {
      for (const url of result) blocked.add(url)
    }
  }

  return blocked
}
