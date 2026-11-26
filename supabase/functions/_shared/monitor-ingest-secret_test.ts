import { matchesMonitorSecret } from './monitor-ingest-secret.ts'

Deno.test('monitor ingest accepts legacy and rotating secrets and rejects blanks and mismatches', async () => {
  for (const [provided, legacy, list, expected] of [
    ['old', 'old', '', true],
    ['old', 'old', 'first,second', true],
    ['first', '', ' first , , second ', true],
    ['second', '', ' first , , second ', true],
    ['firstx', '', 'first,second', false],
    ['', '', ', ,', false],
    ['any', '', ', ,', false],
  ] as const) {
    if (await matchesMonitorSecret(provided, legacy, list) !== expected) throw new Error('Unexpected authentication decision')
  }
})
