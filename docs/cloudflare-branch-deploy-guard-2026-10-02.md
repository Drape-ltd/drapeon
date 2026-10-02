# Cloudflare branch deploy guard — 2026-10-02

During PR #22 verification, Cloudflare Workers Builds started a non-production branch build for `codex/ops-waiver-20261002`. The branch trigger's deploy command invoked `pnpm run cf:preview`, but `apps/web/scripts/cf-preview.mjs` treated the presence of Cloudflare CI credentials as a signal to run `opennextjs-cloudflare deploy`. That made a non-production PR build capable of publishing the production Worker configured by `apps/web/wrangler.jsonc`.

The run was cancelled before deployment. Cloudflare's build record reached `cancelled`; the active Worker deployment remained the earlier version `c0060f5f` created at 21:44:04 UTC. No production application data or verification decisions were changed.

The mode resolver now makes deploy explicit. A `WORKERS_CI_BRANCH` run defaults to a successful build-only skip after compilation until an isolated Worker Preview is configured. Explicit `deploy` is rejected for any Workers Build branch other than `main`; local `preview` remains available. Unit tests cover the local preview, main deploy, non-main rejection, build-only branch behavior, and explicit preview cases. The shared launch-contract gate runs these tests.

This is a safety stopgap, not a Worker Preview deployment. At the time of the incident, the app used Wrangler 4.126.0, below Cloudflare's documented 4.135.0 requirement for Workers Builds Preview, and no isolated Preview environment/resources were configured. Branch previews must remain disabled until the Wrangler version and preview bindings are upgraded/configured and verified against non-production resources.
