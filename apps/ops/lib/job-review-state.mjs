export function isReviewedDeadJob(job) {
  return job.status === 'DEAD'
    && ['RESOLVED', 'CLOSED'].includes(job.linkedCaseStatus ?? '')
    && ['ACKNOWLEDGED_NO_REPLAY', 'RECOVERED', 'SUPERSEDED'].includes(job.linkedCaseDisposition ?? '')
}
