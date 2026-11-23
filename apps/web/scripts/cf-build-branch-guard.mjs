import { assertCloudflareProductionBuildBranch } from './cf-build-mode.mjs'

try {
  assertCloudflareProductionBuildBranch({
    workersCi: process.env.WORKERS_CI,
    workersCiBuildUuid: process.env.WORKERS_CI_BUILD_UUID,
    workersCiBranch: process.env.WORKERS_CI_BRANCH,
  })
} catch (error) {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
}
