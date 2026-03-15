# PR Workspace Isolation And Agent Delegation Design

**Date:** 2026-03-15
**Status:** Approved

## Goal

Move PR remediation work out of the user's repository checkout and into an app-owned workspace under `~/.codefactory`, while keeping the app itself as a thin orchestrator. The app should monitor PRs, prepare isolated git state, launch the coding agent, and verify outcomes. The coding agent should own the remediation loop: code changes, verification, commit/push, GitHub replies, and thread resolution.

## Requirements

- Resolve the automation root from `CODEFACTORY_HOME` first, then fall back to `path.join(os.homedir(), ".codefactory")`.
- Keep the user's normal repository checkout untouched by babysitter runs.
- Maintain one persistent base clone per watched repository under `~/.codefactory`.
- Use the watched repository as the authoritative cached clone, even for forked PRs.
- For forked PRs, add and fetch a fork remote only when needed for that PR head branch.
- Create a fresh ephemeral worktree for every babysitter run.
- Auto-heal repository cache problems by deleting and recloning when the cached clone is dirty, corrupted, or misconfigured.
- Delegate remediation work to the coding agent, including commit/push and GitHub follow-up.
- Leave an audit trail on GitHub for every addressed feedback item.
- Resolve threaded review comments after replying to them.
- Verify that expected audit-trail actions actually happened before marking a run successful.

## Architecture

The app remains an orchestrator, not a fix engine. Its responsibilities are:

- discover PRs and actionable feedback,
- manage persistent repo caches and ephemeral worktrees in `~/.codefactory`,
- auto-heal broken repo caches,
- launch the coding agent inside the prepared worktree,
- stream logs and persist run state,
- re-sync GitHub state after the agent run,
- verify branch movement and GitHub audit-trail completion,
- clean up the ephemeral worktree.

The coding agent owns remediation behavior inside the worktree:

- inspect the current branch state and review feedback,
- install dependencies or repair local repo setup when needed,
- make targeted code changes,
- run relevant verification,
- create the commit and push it to the PR head branch,
- post a short GitHub summary for every addressed feedback item,
- resolve threaded review comments after replying.

This boundary keeps operational logic deterministic while delegating the expensive and judgment-heavy work to the coding agent.

## Filesystem Layout

- `~/.codefactory/state.sqlite`
  Durable app state.
- `~/.codefactory/log/YYYY-MM-DD/<repo>__<pr>.log`
  Human-readable mirrored logs.
- `~/.codefactory/repos/<owner>__<repo>/`
  Persistent base clone for each watched repository.
- `~/.codefactory/worktrees/<owner>__<repo>/pr-<number>-<runId>/`
  Ephemeral per-run worktrees for agent execution.

The persistent clone is reusable across runs. The worktree is disposable and must be removed at the end of each run.

## Repository Workspace Model

Each watched repo gets a cached base clone under `~/.codefactory/repos`. That clone must always point at the watched repository as `origin`. For a normal PR branch in the watched repo, the app fetches the head ref from `origin` and creates a worktree from the fetched commit.

For a forked PR:

- keep the watched repo clone as the cache anchor,
- add or refresh a fork remote on demand,
- fetch the contributor branch from that fork remote,
- create the worktree from the fetched fork head commit,
- let the coding agent push back to the PR head branch from the worktree.

Health checks on the cached clone should include at least:

- the path is a git worktree/repository,
- `origin` points to the watched repo clone URL,
- there are no stray local modifications in the cache clone,
- the repo can fetch expected refs.

If a health check fails, the app should auto-heal by deleting the cached clone and recloning the watched repo. If worktree creation still fails after a heal-and-retry cycle, the run should stop with an error and preserve logs for diagnosis.

## GitHub Feedback Contract

Every actionable feedback item needs a visible GitHub audit trail.

- Threaded review comments: reply in-thread with a short summary, then resolve the thread.
- Review bodies and general PR comments: post a short summary comment describing what changed.
- Non-actionable or unsafe-to-fix items: post a short explanatory reply/comment instead of staying silent.

The app should enrich stored feedback items with the GitHub metadata needed to support that contract:

- REST/database IDs or node IDs for the source comment/review,
- source URLs,
- thread IDs and resolved state for threaded review comments,
- enough metadata to tell the agent where to reply,
- a stable per-feedback audit token the agent can include in follow-up comments.

The audit token gives the app a deterministic way to verify the agent left the expected GitHub trail after the run. A simple pattern such as `codefactory-feedback: <feedback-id>` is sufficient as long as it is stable and included in every follow-up comment.

## Failure Handling And Verification

The app owns deterministic recovery for automation infrastructure:

- missing or unhealthy cached clone -> delete and reclone,
- missing or stale fork remote -> recreate and refetch,
- partial worktree creation -> remove partial worktree and retry once after healing,
- agent crash or timeout -> keep logs, mark the PR run as failed, and wait for the next poll cycle.

The coding agent owns recovery for repository-level work:

- dependency installs,
- fixing broken tests or lint within scope,
- merge-conflict handling inside the isolated worktree,
- deciding when a comment cannot be addressed safely and leaving an explanatory GitHub reply.

After the agent exits, the app should verify outcomes before marking the run successful:

- confirm the run happened in `~/.codefactory/worktrees/...`,
- re-fetch the PR head and confirm the branch moved when a fix was claimed,
- re-sync GitHub feedback/comments,
- verify every addressed feedback item now has the expected audit token in a new follow-up comment,
- verify threaded review comments are resolved after the reply,
- mark the run incomplete/error if code changed but required GitHub follow-up is missing.

The app should not take over the missing remediation itself. Its job is to detect incomplete runs and surface them.

## Testing Strategy

Add focused tests for:

- path resolution for repo/worktree roots under `CODEFACTORY_HOME`,
- cached clone reuse for healthy repos,
- auto-heal and reclone when the cache is dirty or misconfigured,
- forked PR fetch flow using the watched repo cache plus on-demand fork remote,
- ephemeral worktree creation and cleanup,
- feedback normalization with reply/resolve metadata,
- agent prompt construction for commit/push and GitHub audit-trail requirements,
- post-run verification of branch updates and GitHub audit markers,
- failure paths for clone heal, agent timeout, push failure, and missing GitHub follow-up.

## Risks And Constraints

- The app now depends more heavily on local git and GitHub auth being available to the agent process.
- Forked PR handling is more complex than same-repo PR handling and needs careful remote hygiene.
- Audit-trail verification depends on a stable machine-readable marker in agent follow-up comments.
- Auto-heal must be limited to app-owned cache directories only; it must never delete or rewrite the user's normal checkout.
- This workspace does not currently contain git metadata, so the design doc can be saved locally but cannot be committed from this environment.
