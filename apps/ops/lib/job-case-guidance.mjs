export function isJobRecoveryCase(record) {
  return record.queueKey === 'reliability' && record.relatedEntityType === 'job_queue'
}

export function jobCaseGuidance(record) {
  if (!isJobRecoveryCase(record)) return record.recommendedAction
  if (['RESOLVED', 'CLOSED', 'CANCELLED'].includes(record.status.toUpperCase())) {
    return 'Review the recorded outcome. Closing this case does not mean the job ran successfully.'
  }
  return 'Review the failed attempts and the related workflow. If recovery is still needed, escalate to engineering for a job-specific recovery. Close without retry only when no further execution is needed; this does not retry the job or complete the underlying workflow.'
}

export function jobCaseSummary(record) {
  return isJobRecoveryCase(record)
    ? 'A background task needs review. Check its failure details and workflow outcome before deciding whether recovery is needed.'
    : record.summary
}
