export function isJobRecoveryCase(record) {
  return record.queueKey === 'reliability' && ['job_queue', 'job_failure_group'].includes(record.relatedEntityType)
}

export function jobCaseGuidance(record) {
  if (!isJobRecoveryCase(record)) return record.recommendedAction
  if (['RESOLVED', 'CLOSED', 'CANCELLED'].includes(record.status.toUpperCase())) {
    return 'Review the recorded outcome. Closing this case does not mean the job ran successfully.'
  }
  return 'Review the failed attempts and the related workflow. If recovery is still needed, escalate to engineering for a job-specific recovery. Close without retry only when no further execution is needed; this does not retry the job or complete the underlying workflow.'
}

export function jobCaseSummary(record) {
  if (isJobRecoveryCase(record) && record.relatedEntityType === 'job_failure_group') {
    const count = record.metadata?.affectedJobCount
    return Number.isSafeInteger(count) && count > 0
      ? `${count} failed background task${count === 1 ? '' : 's'} share this investigation. Review every linked job before recovery; case closure does not complete the jobs.`
      : 'Related background tasks need review. Check each job before recovery.'
  }
  return isJobRecoveryCase(record)
    ? 'A background task needs review. Check its failure details and workflow outcome before deciding whether recovery is needed.'
    : record.summary
}
