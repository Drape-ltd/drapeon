export function resolveCloudflareBuildMode({ forcedMode, workersCiBranch }) {
  if (forcedMode === 'deploy') {
    if (workersCiBranch !== null && workersCiBranch !== 'main') {
      throw new Error(`Refusing production deploy from non-production Workers Build branch ${workersCiBranch}.`)
    }
    return 'deploy'
  }
  if (forcedMode === 'preview') {
    if (workersCiBranch) {
      throw new Error('Refusing Worker preview from a Workers Build until isolated preview resources are configured.')
    }
    return 'preview'
  }

  // The connected non-production trigger currently has no isolated Worker Preview
  // configuration. Complete its build, but never publish that branch to production.
  if (workersCiBranch) return 'skip'
  return 'preview'
}
