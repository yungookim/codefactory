# Recent Log Failure Report - 2026-04-28

## Scope

Reviewed recent oh-my-pr runtime state and mirrored logs from:

- `/Users/dgyk/.oh-my-pr/state.sqlite`
- `/Users/dgyk/.oh-my-pr/log/2026-04-25` through `/Users/dgyk/.oh-my-pr/log/2026-04-28`
- Older compatibility logs under `/Users/dgyk/.codefactory/log` only where they explained repeated failure patterns.

Assumption: "recent logs" means the last four dated log folders available as of April 28, 2026. Log timestamps are UTC.

## Executive Summary

I did not find a primary failure in the direct GitHub follow-up path itself. When runs reached `[github.followup]`, the app generally posted follow-up replies, resolved review conversations, and then logged `[verify.github] GitHub audit trail verified`.

The failures that left comments unresolved happened earlier:

1. Invalid Claude credentials caused a late April 28 failure wave after the app was configured to use `claude`.
2. Merge-conflict resolution frequently failed because the agent could not write Git metadata (`index.lock`) or left conflict-resolution changes uncommitted.
3. GitHub network/DNS failures (`Could not resolve host: github.com`, `ECONNRESET`) prevented pushes, metadata sync, review loading, or status loading.
4. oh-my-pr status comments were re-ingested as review feedback and repeatedly evaluated, creating noisy self-feedback loops.
5. Older April 25-26 failures were dominated by missing local agent CLIs (`Neither codex nor claude CLI is installed`).
6. Several agent runs timed out with exit code 124 after 900 seconds.
7. Two healing runs hit an illegal state transition: `awaiting_repair_slot -> verifying`.
8. Some runs could not verify changes because repository dependencies were missing and network was unavailable.
9. CI polling and cancelled external checks were repeatedly recorded as unresolved work even when they were not branch-fixable.

## Current State Snapshot

From `state.sqlite` as of the latest log entries around `2026-04-28T01:39Z`:

- Active error PRs:
  - `alex-morgan-o/redseal.pro.app#219`
  - `alex-morgan-o/redseal.pro.app#191`
  - `alex-morgan-o/redseal.pro.app#220`
  - `alex-morgan-o/redseal.pro.app#221`
- Still processing:
  - `alex-morgan-o/redseal.pro.app#217`
- One background job was still leased:
  - `babysit_pr` for PR #217, created `2026-04-28T01:38:49Z`; the lease expired at `2026-04-28T01:39:39Z`.
- Current config selects:
  - `coding_agent=claude`
  - `model=codex-mini-latest`
  - `auto_resolve_merge_conflicts=1`
  - `auto_update_docs=1`
- PR state totals:
  - `archived`: 301
  - `error`: 6
  - `processing`: 1
  - `watching`: 1
- Feedback item state totals:
  - `rejected`: 5390
  - `resolved`: 842
  - `pending`: 627
  - `failed`: 306
  - `warning`: 152
  - `in_progress`: 137

Current PRs still affected:

| PR | State | Non-terminal feedback | Unresolved review threads | Failed runs |
| --- | --- | ---: | ---: | ---: |
| `alex-morgan-o/redseal.pro.app#191` | error | 17 | 2 | 107 |
| `alex-morgan-o/redseal.pro.app#217` | processing | 2 | 1 | 3 |
| `alex-morgan-o/redseal.pro.app#219` | error | 11 | 0 | 3 |
| `alex-morgan-o/redseal.pro.app#220` | error | 6 | 3 | 8 |
| `alex-morgan-o/redseal.pro.app#221` | error | 4 | 2 | 6 |
| `alex-morgan-o/redseal.pro.app#140` | watching, watch disabled | 54 | 3 | not re-run in this window |
| `alex-morgan-o/lolodex#106` | error, watch disabled | many old unresolved threads | not recent | not recent |
| `alex-morgan-o/lolodex#107` | error, watch disabled | many old unresolved threads | not recent | not recent |

## Failure Counts

Agent run failures by day and bucket:

| Day | Bucket | Count |
| --- | --- | ---: |
| 2026-04-25 | CLI missing | 1075 |
| 2026-04-25 | missing replay context | 11 |
| 2026-04-25 | agent timeout 124 | 10 |
| 2026-04-26 | CLI missing | 677 |
| 2026-04-26 | conflict/uncommitted | 19 |
| 2026-04-27 | conflict/uncommitted | 20 |
| 2026-04-27 | GitHub ECONNRESET | 6 |
| 2026-04-27 | agent timeout 124 | 3 |
| 2026-04-27 | worktree uncommitted | 2 |
| 2026-04-27 | missing replay context | 2 |
| 2026-04-27 | illegal healing transition | 2 |
| 2026-04-28 | Claude auth 401 | 18 |
| 2026-04-28 | conflict/uncommitted | 9 |
| 2026-04-28 | commit not pushed | 1 |

Agent run totals from `agent_runs`:

| Day | Agent | Completed | Failed | Running |
| --- | --- | ---: | ---: | ---: |
| 2026-04-25 | codex | 1766 | 1106 | 0 |
| 2026-04-26 | codex | 1584 | 706 | 0 |
| 2026-04-27 | codex | 257 | 35 | 0 |
| 2026-04-28 | codex | 95 | 10 | 0 |
| 2026-04-28 | claude | 12 | 18 | 1 |

Persisted runtime log volume for the same date range:

| Level | Count |
| --- | ---: |
| error | 1859 |
| warn | 1256642 |
| info | 410880 |

The warning count is inflated by full agent stdout/stderr capture, not by distinct failure causes.

## Unresolved Active Review Threads

Recent PRs with active review-thread items where `thread_resolved=0` and status is `failed`, `warning`, `in_progress`, `queued`, or `pending`:

| PR | Count |
| --- | ---: |
| `alex-morgan-o/redseal.pro.app#193` | 6 |
| `alex-morgan-o/redseal.pro.app#140` | 3 |
| `alex-morgan-o/redseal.pro.app#188` | 3 |
| `alex-morgan-o/redseal.pro.app#216` | 3 |
| `alex-morgan-o/redseal.pro.app#220` | 3 |
| `alex-morgan-o/redseal.pro.app#191` | 2 |
| `alex-morgan-o/redseal.pro.app#201` | 2 |
| `alex-morgan-o/redseal.pro.app#209` | 2 |
| `alex-morgan-o/redseal.pro.app#221` | 2 |
| `yungookim/oh-my-pr#105` | 2 |
| `yungookim/oh-my-pr#109` | 2 |
| `alex-morgan-o/redseal.pro.app#207` | 1 |
| `alex-morgan-o/redseal.pro.app#217` | 1 |
| `alex-morgan-o/redseal.pro.app#218` | 1 |
| `yungookim/oh-my-pr#108` | 1 |

## Detailed Findings

### 1. Direct GitHub Follow-Up Usually Worked When Reached

Examples:

- `redseal.pro.app#219`: posted and resolved multiple review-thread follow-ups, then verified audit trail.
  - `/Users/dgyk/.oh-my-pr/log/2026-04-28/alex-morgan-o__redseal.pro.app__219.log`
  - Evidence from SQLite log rows around `2026-04-28T01:28:19Z` through `01:28:26Z`.
- `redseal.pro.app#218`: posted and resolved review-thread follow-ups, then verified audit trail.
  - Evidence from SQLite log rows around `2026-04-28T01:21:15Z` through `01:21:20Z`.
- `oh-my-pr#116`: posted and resolved review-thread follow-ups, then verified audit trail.
  - `/Users/dgyk/.oh-my-pr/log/2026-04-27/yungookim__oh-my-pr__116.log`
  - Evidence around `2026-04-27T23:09:07Z` through `23:09:12Z`.

Conclusion: the main comment-resolution gap is not the final follow-up/resolution helper. The app often fails before it reaches that phase.

### 2. Claude Auth Failure Blocked Evaluation and Conflict Resolution

On April 28, the app resolved runs to `claude`, but Claude returned 401 authentication errors.

Representative evidence:

- `redseal.pro.app#191`: `/Users/dgyk/.oh-my-pr/log/2026-04-28/alex-morgan-o__redseal.pro.app__191.log:513`
  - `Agent failed to resolve merge conflicts (1): Failed to authenticate. API Error: 401`
- `redseal.pro.app#220`: `/Users/dgyk/.oh-my-pr/log/2026-04-28/alex-morgan-o__redseal.pro.app__220.log:3335`, `3345`, `3355`, `3365`, `3375`, `3385`
  - repeated `claude evaluation failed (1): Failed to authenticate. API Error: 401`
- `redseal.pro.app#221`: `/Users/dgyk/.oh-my-pr/log/2026-04-28/alex-morgan-o__redseal.pro.app__221.log:2820`, `2832`, `2844`, `2856`, `2868`
  - repeated `claude evaluation failed (1): Failed to authenticate. API Error: 401`

Impact:

- Pending comments could not be classified.
- Merge conflicts could not be resolved.
- PRs stayed in `error`.

Recommendation:

- Add a startup and pre-run health check for the selected agent.
- If `coding_agent=claude` but Claude auth fails, stop scheduling babysitter runs and surface one operator-facing config error instead of retrying every poll.
- Either repair Claude auth or switch the runtime config back to a healthy agent before re-enabling watcher runs.

### 3. Merge Conflict Resolution Fails in the Agent Sandbox

Multiple runs resolved file content but failed to stage/commit because Git metadata was outside the writable sandbox, so `git add` could not create `index.lock`.

Representative evidence:

- `redseal.pro.app#220`: `/Users/dgyk/.oh-my-pr/log/2026-04-28/alex-morgan-o__redseal.pro.app__220.log:1529`
  - `fatal: Unable to create ... index.lock: Operation not permitted`
- `redseal.pro.app#220`: same file `:1562`, `:3312`
  - `Agent left uncommitted changes after conflict resolution`
- `redseal.pro.app#221`: `/Users/dgyk/.oh-my-pr/log/2026-04-28/alex-morgan-o__redseal.pro.app__221.log:946`
  - agent explicitly diagnosed `.git` metadata outside writable worktree root.
- `redseal.pro.app#221`: same file `:2795`
  - `Agent left uncommitted changes after conflict resolution: M CHANGELOG.md`

Impact:

- The agent may resolve conflict markers in files, but the app rejects the run because the merge remains uncommitted or unresolved.
- The same PR can loop through repeated conflict-resolution attempts.

Recommendation:

- Keep Git staging, merge commits, and pushes in the app runtime, not inside the sandboxed coding agent.
- Agent should only edit files to resolve conflict content.
- App should inspect `git status`, stage, commit, push, and verify after agent output.
- Alternatively, create worktrees with Git metadata fully writable by the agent sandbox.

Related dirty-worktree evidence:

- `redseal.pro.app#191`: `/Users/dgyk/.oh-my-pr/log/2026-04-25/alex-morgan-o__redseal.pro.app__191.log:8649`
  - `Agent left uncommitted changes after conflict resolution: M .env.example`
- `redseal.pro.app#191`: `/Users/dgyk/.oh-my-pr/log/2026-04-26/alex-morgan-o__redseal.pro.app__191.log:29242`
  - `Agent left uncommitted changes after conflict resolution: A .worktrees/pr-145`
- `oh-my-pr#108`: `/Users/dgyk/.oh-my-pr/log/2026-04-25/yungookim__oh-my-pr__108.log:12171`
  - `Agent left uncommitted changes in the worktree: M server/github.test.ts`
- `oh-my-pr#109`: `/Users/dgyk/.oh-my-pr/log/2026-04-26/yungookim__oh-my-pr__109.log:3633`
  - `Agent left uncommitted changes in the worktree: M docs/index.html`
- `oh-my-pr#116`: `/Users/dgyk/.oh-my-pr/log/2026-04-27/yungookim__oh-my-pr__116.log:22780`
  - `Agent left uncommitted changes in the worktree: M .github/workflows/codex-code-review.yml`

### 4. GitHub Network Failures Prevented Pushes and Sync

Two network failure modes showed up:

- DNS failure from sandboxed agents:
  - `Could not resolve host: github.com`
- GitHub API connection reset from app runtime:
  - `read ECONNRESET`

Representative evidence:

- `redseal.pro.app#220`: `/Users/dgyk/.oh-my-pr/log/2026-04-28/alex-morgan-o__redseal.pro.app__220.log:1428`, `1449`, `1530`, `2746`, `3258`
  - push attempts failed with `Could not resolve host: github.com`.
- `redseal.pro.app#221`: `/Users/dgyk/.oh-my-pr/log/2026-04-28/alex-morgan-o__redseal.pro.app__221.log:1150`, `1407`
  - push attempts failed with `Could not resolve host: github.com`.
- `redseal.pro.app#191`: `/Users/dgyk/.oh-my-pr/log/2026-04-27/alex-morgan-o__redseal.pro.app__191.log:64577`, `64604`, `65030`, `131159`, `131419`, `131482`
  - metadata, reviews, and status loading failed with `read ECONNRESET`.

Impact:

- Even successful local fixes could not land.
- Review loading and status loading failed before the agent could work.

Recommendation:

- Retry GitHub API reads with bounded exponential backoff before failing a run.
- Treat DNS/push failures as infrastructure failures, not code failures.
- If pushes must happen from the app, avoid delegating network-dependent `git push` to sandboxed agents.

### 5. oh-my-pr Status Comments Are Re-Ingested as Feedback

The app sometimes syncs its own status comments back as review feedback.

Representative evidence:

- `redseal.pro.app#220`: `/Users/dgyk/.oh-my-pr/log/2026-04-28/alex-morgan-o__redseal.pro.app__220.log:3334`, `3344`, `3354`, `3364`, `3374`, `3384`
  - repeated evaluation of a comment body beginning `Accepted ... Queuing fix... Posted by [oh-my-pr]`.
- `redseal.pro.app#191`: `/Users/dgyk/.oh-my-pr/log/2026-04-25/alex-morgan-o__redseal.pro.app__191.log:377341` through `377345`
  - the evaluator saw oh-my-pr's own "Agent failed" status update and rejected it as a bot/status update.

Impact:

- Wastes agent calls.
- Can keep PRs noisy after failed runs.
- In the April 28 wave, these self-comments triggered repeated Claude 401 failures during evaluation.

Recommendation:

- Filter comments containing oh-my-pr audit/status markers before queuing evaluation.
- Store and ignore app-authored status comment IDs explicitly.
- Preserve the current fallback evaluator rejection, but make it a safety net rather than the main filter.

### 6. Missing Local Agent CLIs Caused Large Older Failure Waves

April 25-26 had many repeated failures where no agent CLI was available.

Representative database buckets:

- 2026-04-25: 1075 `cli_missing` failures.
- 2026-04-26: 677 `cli_missing` failures.

Representative app error:

- `Babysitter error: Neither codex nor claude CLI is installed`

Impact:

- Watcher continued to schedule runs that could not possibly succeed.
- Large noisy log volume obscured actionable failures.

Recommendation:

- Health-check agent availability before scheduling.
- If neither CLI exists, pause automation globally and show one durable setup error.
- Do not mark individual PRs as failed repeatedly for a machine-level prerequisite failure.

### 7. Agent Timeouts and Replay Gaps

Several Codex runs timed out after 900 seconds or failed with code 124.

Representative evidence:

- `redseal.pro.app#191`: `/Users/dgyk/.oh-my-pr/log/2026-04-27/alex-morgan-o__redseal.pro.app__191.log:94555`
  - `Agent apply failed (124)`
- Same file `:100900`
  - `Command timed out after 900000ms`
- Same file `:127296` and `:130859`
  - second timeout wave.

Related replay errors:

- `Interrupted run missing replay context`
- Seen in `agent_runs` on April 25-27.

Impact:

- Long-running work holds PR/run locks and causes skipped babysitter attempts.
- Replay cannot safely continue if prompt/resolved-agent/head-sha context is missing.

Recommendation:

- Persist replay context before launching the agent, not after.
- Add a heartbeat cutoff that distinguishes no-output hangs from long but active runs.
- Summarize timeout failures with the last meaningful stderr/stdout lines, not massive full agent output.

### 8. Illegal Healing State Transition

Two April 27 runs failed with:

- `Illegal healing session transition: awaiting_repair_slot -> verifying`

Evidence:

- `/Users/dgyk/.oh-my-pr/log/2026-04-27/alex-morgan-o__redseal.pro.app__191.log:100906`
- `/Users/dgyk/.oh-my-pr/log/2026-04-27/alex-morgan-o__redseal.pro.app__191.log:100912`

Impact:

- CI healing state machine entered an invalid transition path.
- The babysitter recorded the issue as a run failure rather than completing or cleanly escalating.

Recommendation:

- Audit the healing transition graph and callers.
- Add regression coverage for `awaiting_repair_slot` when a repair slot becomes available.
- Ensure the manager transitions through the expected intermediate state before `verifying`.

### 9. Missing Dependencies Blocked Verification

Some agents reached verification but could not prove correctness because dependencies were not installed or not cached, and the sandbox could not fetch them.

Representative evidence:

- `redseal.pro.app#191`: `/Users/dgyk/.oh-my-pr/log/2026-04-26/alex-morgan-o__redseal.pro.app__191.log:325129`
  - `Cannot find module 'vitest' or its corresponding type declarations`
- `redseal.pro.app#191`: same file around `:325292`
  - `npm error command sh -c npm run build --workspace ... && vitest ...`
- `redseal.pro.app#209`: `/Users/dgyk/.oh-my-pr/log/2026-04-27/alex-morgan-o__redseal.pro.app__209.log:15079`
  - verification was blocked by missing project dependencies with no network path to install them.

Impact:

- Agents could modify code but could not provide a reliable pass/fail signal.
- Some failures were recorded as agent failure even though the immediate blocker was environment preparation.

Recommendation:

- Preflight dependency availability before assigning work.
- Maintain a repo-specific dependency cache for watched repositories.
- Classify missing dependency/network install failures as environment failures, not remediation failures.

### 10. CI Polling and Cancelled Checks Stayed Noisy

The watcher repeatedly encountered checks that did not finish within the polling window or checks that were cancelled by CI orchestration.

Representative evidence:

- `redseal.pro.app#216`: `/Users/dgyk/.oh-my-pr/log/2026-04-28/alex-morgan-o__redseal.pro.app__216.log:2283`
  - `CI/CD checks did not complete within polling window; will re-check on next cycle`
- `redseal.pro.app#216`: same file `:15543`, `:15558`, `:15573`, `:15603`, `:15618`, `:15633`
  - repeated `Rejected failing status Playwright E2E` because the check run was cancelled.
- `redseal.pro.app#210`: `/Users/dgyk/.oh-my-pr/log/2026-04-27/alex-morgan-o__redseal.pro.app__210.log:3114`
  - CI did not complete within the polling window.
- `redseal.pro.app#219`: `/Users/dgyk/.oh-my-pr/log/2026-04-28/alex-morgan-o__redseal.pro.app__219.log:16184`
  - CI did not complete within the polling window.

Impact:

- Cancelled or still-pending CI runs created repeated watcher work.
- The evaluator mostly rejected cancelled checks correctly, but the surrounding PR remained noisy because polling continued to rediscover the same condition.

Recommendation:

- Store a durable "not branch-fixable" classification for cancelled external checks at the check-run ID or workflow-run ID level.
- Back off CI polling when all remaining statuses are pending infrastructure or cancelled non-actionable checks.
- Continue to re-check the final PR status, but avoid re-launching agent work for the same cancelled check.

### 11. Repo Cache and Stale Worktree Cleanup Failed

The app sometimes could not reset repository caches because existing registered worktrees were still present.

Representative evidence:

- `redseal.pro.app#191`: `/Users/dgyk/.oh-my-pr/log/2026-04-25/alex-morgan-o__redseal.pro.app__191.log:130861`
  - the repo cache refused to reclone while six registered worktrees still existed.

Impact:

- Stale worktrees can preserve dirty state across retries.
- Cache cleanup failures amplify merge-conflict and uncommitted-change loops.

Recommendation:

- Add a periodic orphaned-worktree collector that is aware of active leases.
- Reclaim expired leases before deciding a worktree is still owned.
- On reclone refusal, report the exact worktree paths and owning run IDs.

### 12. Agent Tooling Noise Obscured Root Causes

Several logs include failures from the tool layer or the agent UI that are secondary to the real remediation outcome.

Representative evidence:

- `redseal.pro.app#221`: `/Users/dgyk/.oh-my-pr/log/2026-04-28/alex-morgan-o__redseal.pro.app__221.log:1381`, `2735`, `2761`
  - `user cancelled MCP tool call` and cancelled GitHub connector fallback.
- `redseal.pro.app#209`: `/Users/dgyk/.oh-my-pr/log/2026-04-27/alex-morgan-o__redseal.pro.app__209.log:4310`
  - `write_stdin failed: stdin is closed`
- `redseal.pro.app#209`: same file `:3529`
  - `apply_patch verification failed`
- `redseal.pro.app#217`: `/Users/dgyk/.oh-my-pr/log/2026-04-28/alex-morgan-o__redseal.pro.app__217.log:913`, `3630`
  - destructive or compound shell commands were blocked by policy.

Impact:

- These errors make it harder to distinguish a product bug from an agent/tooling failure.
- Some retries were spent responding to tool-layer constraints instead of advancing the PR.

Recommendation:

- Normalize common tool-layer failures into a compact run summary.
- Train prompts away from known-disallowed command shapes.
- Preserve raw logs, but make the PR-facing failure reason the earliest actionable root cause.

## Priority Fix List

1. Add agent health gating.
   - Validate selected agent exists and is authenticated before scheduling or leasing babysitter jobs.
   - Pause automation on machine-level failures.

2. Move Git commit/push responsibilities out of the agent.
   - Agents resolve file content only.
   - App stages, commits, pushes, and verifies.

3. Filter self-authored oh-my-pr status comments at ingest.
   - Prevent status/audit comments from being evaluated as new feedback.

4. Add robust GitHub retry and infrastructure classification.
   - Retry `ECONNRESET`.
   - Classify DNS/push failures separately from code remediation failures.

5. Fix stale leased job recovery.
   - One April 28 `babysit_pr` job remained leased.
   - Reclaim expired leases and log the target PR before requeueing.

6. Fix healing transition coverage.
   - Specifically cover `awaiting_repair_slot -> verifying`.

7. Add dependency preflight and cache validation.
   - Do not start remediation when required test/build tooling is unavailable.

8. Persist CI non-actionable classifications.
   - Avoid repeatedly reprocessing cancelled external checks.

9. Add stale worktree and lease recovery.
   - Reclaim expired leases, then clean orphaned worktrees before recloning.

10. Compact tool-layer failure summaries.
   - Keep raw logs available, but promote one root-cause reason per failed run.

## Post-Fix Run Marker - 2026-04-28

Use this section as the baseline for the next log-analysis pass. It records the run that implemented and verified the priority fixes above.

- Branch: `report-unresolved-log-issues`
- PR: `https://github.com/yungookim/oh-my-pr/pull/120`
- Fix commit: `94debc13a8ba1875dfd11bdd28f5ac20e43cd155`
- Local QA report: `.gstack/qa-reports/qa-report-127-0-0-1-2026-04-28.md`
- Project-scoped QA copy: `~/.gstack/projects/yungookim-oh-my-pr/dgyk-report-unresolved-log-issues-test-outcome-20260428T075900.md`
- Verification run: `npm run test:all` passed with 408 tests, `npm run check` passed, `npm run build` passed, `npm run lint` passed, and browser smoke found no changed-scope defects.

Important evaluation boundary: do not judge these fixes against log entries produced before a runtime includes commit `94debc13a8ba1875dfd11bdd28f5ac20e43cd155`. The original failure window ended around `2026-04-28T01:39Z`; the QA verification was a local app run on April 28, 2026 and did not itself process live watched PRs.

Next log-analysis pass should compare post-deploy/post-merge runtime logs against these expected outcomes:

| Fix area | Evidence to look for in new logs |
| --- | --- |
| Agent health gating | Unauthenticated or missing selected agents pause automation before new babysitter jobs are scheduled or leased. Repeated Claude 401 loops should stop. |
| App-owned Git commit/push | Agent logs should no longer show instructions or attempts to `git commit` / `git push`; app runtime should stage, commit, push, and verify after file edits. |
| Self-authored comment filtering | oh-my-pr status/audit comments should be ingested as non-actionable and should not trigger repeated evaluator runs. |
| GitHub retry/infrastructure classification | `ECONNRESET`, DNS, and push failures should be retried or classified as infrastructure, not code-remediation failures. |
| Lease recovery | Expired `babysit_pr` leases should be reclaimed with the target PR logged before requeueing. No stale April 28-style leased job should remain indefinitely. |
| Healing transitions | `awaiting_repair_slot -> verifying` should transition cleanly through supported paths without illegal transition errors. |
| Dependency preflight | Remediation should not start when required test/build tooling is unavailable; logs should show preflight/environment classification instead. |
| CI non-actionable persistence | Cancelled external checks should not be repeatedly reprocessed as fresh branch-fixable work. |
| Stale worktree recovery | Expired leases should be reclaimed before orphaned worktrees are cleaned or repo caches are recloned. |
| Tool-layer summaries | Failed runs should preserve raw logs but promote one compact actionable root-cause reason. |

## Source Queries Used

```sql
SELECT date(created_at), preferred_agent, resolved_agent, status, COUNT(*)
FROM agent_runs
WHERE created_at >= '2026-04-25'
GROUP BY date(created_at), preferred_agent, resolved_agent, status;

SELECT date(created_at), bucket, COUNT(*)
FROM agent_runs
WHERE created_at >= '2026-04-25' AND status='failed'
GROUP BY date(created_at), bucket;

SELECT p.repo, p.number, f.status, f.type, f.reply_kind, f.thread_resolved, COUNT(*)
FROM feedback_items f
JOIN prs p ON p.id=f.pr_id
WHERE p.last_checked >= '2026-04-25'
GROUP BY p.repo, p.number, f.status, f.type, f.reply_kind, f.thread_resolved;

SELECT p.repo, p.number, COUNT(*)
FROM feedback_items f
JOIN prs p ON p.id=f.pr_id
WHERE p.last_checked >= '2026-04-25'
  AND f.reply_kind='review_thread'
  AND COALESCE(f.thread_resolved,0)=0
  AND f.status IN ('failed','warning','in_progress','queued','pending')
GROUP BY p.repo, p.number;

SELECT status, COUNT(*)
FROM prs
GROUP BY status;

SELECT status, COUNT(*)
FROM feedback_items
GROUP BY status;

SELECT type, status, leased_until, payload
FROM background_jobs
WHERE status IN ('queued','leased','failed');
```
