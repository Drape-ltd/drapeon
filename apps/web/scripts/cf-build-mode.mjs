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

/**
 * `cf:build` prepares the production Wrangler bundle, so a Workers Build may
 * run it only for the configured production branch. Workers Builds can still
 * deploy independently of this repository's deploy wrapper; failing the build
 * here prevents its following deploy command from publishing a PR artifact.
 */
export function assertCloudflareProductionBuildBranch({
  workersCi,
  workersCiBuildUuid,
  workersCiBranch,
}) {
  const isWorkersBuild = workersCi === '1' || Boolean(workersCiBuildUuid) || Boolean(workersCiBranch)
  if (!isWorkersBuild) return

  const branch = workersCiBranch?.trim() || null
  if (branch !== 'main') {
    throw new Error(
      `Refusing production Worker build from Workers Build branch ${branch ?? 'unknown'}; only main may build a production artifact.`
    )
  }
}
