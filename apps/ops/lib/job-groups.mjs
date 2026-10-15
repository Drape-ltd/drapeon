// Group only by recorded job type, never by private payloads or inferred causes.
export function groupJobsByType(jobs) {
  const groups = new Map()
  for (const job of jobs) {
    const group = groups.get(job.type) ?? { type: job.type, count: 0, missingCases: 0 }
    group.count += 1
    if (job.status === 'DEAD' && !job.linkedCaseNumber) group.missingCases += 1
    groups.set(job.type, group)
  }
  return [...groups.values()].sort((a, b) => b.count - a.count || a.type.localeCompare(b.type))
}
