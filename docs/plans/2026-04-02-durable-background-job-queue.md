# Durable Background Job Queue Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a SQLite-backed durable background job queue with lease/heartbeat semantics, startup stale-lease recovery, and queue-based execution for all background work on current `main`.

**Architecture:** Introduce a generic `background_jobs` table plus a small in-process dispatcher. The watcher remains a timer that only enqueues `sync_watched_repos`, while handlers for babysitter runs, release processing, PR questions, and social changelogs execute through the shared queue and preserve existing domain tables as source-of-truth.

**Tech Stack:** TypeScript, Express, `node:sqlite`, Zod, Node test runner, `tsx`

---

### Task 1: Add Queue Schema And Types

**Files:**
- Modify: `shared/schema.ts`
- Modify: `shared/models.ts`
- Modify: `server/storage.ts`
- Modify: `server/sqliteStorage.ts`
- Modify: `server/memoryStorage.ts`
- Test: `server/storage.test.ts`
- Test: `server/memoryStorage.test.ts`

**Step 1: Write the failing storage tests**

Add tests that expect storage support for:

- creating a `background_job`,
- listing jobs by status/kind/dedupe key,
- returning existing active jobs for the same dedupe key,
- reclaiming expired leased jobs.

Use explicit fixture values for `kind`, `status`, `dedupeKey`, `leaseOwner`, and `leaseExpiresAt`.

**Step 2: Run the targeted storage tests to verify they fail**

Run: `node --test --import tsx server/storage.test.ts server/memoryStorage.test.ts`

Expected: FAIL because queue schema and storage methods do not exist yet.

**Step 3: Add shared enums and models**

Add:

- `backgroundJobKindEnum`
- `backgroundJobStatusEnum`
- `backgroundJobSchema`
- `BackgroundJob` type

Use concrete values:

```ts
const backgroundJobKindEnum = z.enum([
  "sync_watched_repos",
  "babysit_pr",
  "process_release_run",
  "answer_pr_question",
  "generate_social_changelog",
]);

const backgroundJobStatusEnum = z.enum([
  "queued",
  "leased",
  "completed",
  "failed",
  "canceled",
]);
```

Also add `createBackgroundJob()` and `applyBackgroundJobUpdate()` helpers in `shared/models.ts`.

**Step 4: Add storage interface methods**

Add queue operations to `IStorage`, including:

- `getBackgroundJob(id)`
- `listBackgroundJobs(filters?)`
- `enqueueBackgroundJob(data)`
- `claimNextBackgroundJob(params)`
- `heartbeatBackgroundJob(id, leaseToken, leaseExpiresAt, heartbeatAt)`
- `completeBackgroundJob(id, leaseToken)`
- `failBackgroundJob(id, leaseToken, error)`
- `cancelBackgroundJob(id, leaseToken, error)`
- `requeueExpiredBackgroundJobs(now)`

Keep the API minimal and specific to current needs.

**Step 5: Implement SQLite and memory storage support**

In `server/sqliteStorage.ts`, add:

- `background_jobs` table DDL,
- indexes,
- parse helpers,
- transaction-safe enqueue/dedupe logic,
- claim/heartbeat/finalize/requeue operations.

In `server/memoryStorage.ts`, add equivalent behavior for tests.

**Step 6: Re-run the targeted storage tests**

Run: `node --test --import tsx server/storage.test.ts server/memoryStorage.test.ts`

Expected: PASS for the new queue storage cases.

### Task 2: Build The Dispatcher Runtime

**Files:**
- Create: `server/backgroundJobQueue.ts`
- Create: `server/backgroundJobDispatcher.ts`
- Test: `server/backgroundJobQueue.test.ts`
- Test: `server/backgroundJobDispatcher.test.ts`

**Step 1: Write the failing queue and dispatcher tests**

Add tests covering:

- claim order by priority and `availableAt`,
- heartbeat extending only the matching lease token,
- expired lease reclamation,
- drain mode preventing new claims,
- dispatcher `waitForIdle()` reflecting active queue handlers.

**Step 2: Run the new targeted tests**

Run: `node --test --import tsx server/backgroundJobQueue.test.ts server/backgroundJobDispatcher.test.ts`

Expected: FAIL because the new modules do not exist yet.

**Step 3: Implement queue primitives**

In `server/backgroundJobQueue.ts`, add a thin service over storage with methods like:

```ts
enqueue(kind, targetId, dedupeKey, payload, options?)
claimNext(workerId, leaseMs, now)
heartbeat(jobId, leaseToken, leaseMs, now)
complete(jobId, leaseToken, now)
fail(jobId, leaseToken, error, now)
cancel(jobId, leaseToken, error, now)
requeueExpired(now)
```

Keep it deterministic and storage-centric.

**Step 4: Implement the dispatcher loop**

In `server/backgroundJobDispatcher.ts`, add:

- process `workerId`,
- handler registry,
- start/stop lifecycle,
- polling loop,
- per-job heartbeat timer,
- `waitForIdle()`,
- drain-aware claim gating.

Use defaults:

- poll interval `1000`
- lease duration `30000`
- heartbeat interval `10000`

**Step 5: Re-run the dispatcher tests**

Run: `node --test --import tsx server/backgroundJobQueue.test.ts server/backgroundJobDispatcher.test.ts`

Expected: PASS

### Task 3: Queue PR Question And Social Changelog Work

**Files:**
- Modify: `server/prQuestionAgent.ts`
- Modify: `server/socialChangelogAgent.ts`
- Create: `server/backgroundJobHandlers.ts`
- Modify: `server/routes.ts`
- Modify: `server/babysitter.ts`
- Test: `server/prQuestionAgent.test.ts`
- Test: `server/routes.test.ts`

**Step 1: Write the failing tests for queued execution**

Add tests that prove:

- posting a PR question enqueues `answer_pr_question` instead of running the agent inline,
- social changelog creation enqueues `generate_social_changelog`,
- the handlers no-op cleanly when the target row is already terminal.

**Step 2: Run the targeted tests**

Run: `node --test --import tsx server/prQuestionAgent.test.ts server/routes.test.ts`

Expected: FAIL because the routes still invoke the work directly.

**Step 3: Extract handler functions for queue execution**

Register queue handlers in `server/backgroundJobHandlers.ts` for:

- `answer_pr_question`
- `generate_social_changelog`

Each handler should:

- load the target row,
- no-op complete if already terminal,
- call the existing agent function otherwise.

**Step 4: Change enqueue call sites**

Update:

- `POST /api/prs/:id/questions` in `server/routes.ts`
- social changelog scheduling in `server/babysitter.ts`

to enqueue queue jobs instead of calling the worker function directly.

**Step 5: Re-run the targeted tests**

Run: `node --test --import tsx server/prQuestionAgent.test.ts server/routes.test.ts`

Expected: PASS

### Task 4: Replace Release In-Memory Scheduling With Queue Jobs

**Files:**
- Modify: `server/releaseManager.ts`
- Modify: `server/routes.ts`
- Modify: `server/backgroundJobHandlers.ts`
- Test: `server/releaseManager.test.ts`
- Test: `server/routes.test.ts`

**Step 1: Write the failing release queue tests**

Add tests that prove:

- `enqueueMergedPullReleaseEvaluation()` creates or reuses the `release_run` row and enqueues `process_release_run`,
- retry also enqueues `process_release_run`,
- startup recovery can reclaim a stale leased release job and process it after restart.

**Step 2: Run the targeted tests**

Run: `node --test --import tsx server/releaseManager.test.ts server/routes.test.ts`

Expected: FAIL because `ReleaseManager` still uses in-memory `backgroundJobs`.

**Step 3: Remove release in-memory scheduling**

Refactor `server/releaseManager.ts` so that:

- `enqueueMergedPullReleaseEvaluation()` only creates/reuses the domain row and enqueues a queue job,
- `retryReleaseRun()` resets the row and enqueues a queue job,
- `processReleaseRun()` remains the execution method used by the queue handler,
- `waitForIdle()` no longer depends on the old `backgroundJobs` set.

Keep repo-level serialization with the existing `repoLocks`.

**Step 4: Register the queue handler**

Add `process_release_run` handling in `server/backgroundJobHandlers.ts` by calling `releaseManager.processReleaseRun(id)`.

**Step 5: Re-run the release tests**

Run: `node --test --import tsx server/releaseManager.test.ts server/routes.test.ts`

Expected: PASS

### Task 5: Queue The Watcher Sync Job

**Files:**
- Modify: `server/babysitter.ts`
- Modify: `server/routes.ts`
- Modify: `server/backgroundJobHandlers.ts`
- Test: `server/babysitter.test.ts`
- Test: `server/watcherScheduler.test.ts`

**Step 1: Write the failing watcher-queue tests**

Add tests that prove:

- startup and periodic watcher ticks enqueue `sync_watched_repos` instead of doing the sync work inline,
- duplicate ticks coalesce into one active `sync_watched_repos` job,
- the `sync_watched_repos` handler enqueues `babysit_pr` jobs for discovered PRs.

**Step 2: Run the targeted tests**

Run: `node --test --import tsx server/babysitter.test.ts server/watcherScheduler.test.ts`

Expected: FAIL because the watcher still calls `syncAndBabysitTrackedRepos()` directly.

**Step 3: Split discovery from dispatch trigger**

Refactor `server/babysitter.ts` so the current watcher logic becomes a handler-friendly method such as:

```ts
syncTrackedReposAndEnqueueBabysits(): Promise<void>
```

Inside that method:

- archive/refresh PR state,
- auto-register discovered PRs,
- enqueue `babysit_pr:<pr_id>` jobs instead of calling `babysitPR()` directly,
- keep release and social-changelog creation behavior intact, but use queue enqueue where needed.

**Step 4: Update route startup and timer behavior**

In `server/routes.ts`, the timer and startup path should enqueue `sync_watched_repos` and return immediately.

**Step 5: Re-run the watcher tests**

Run: `node --test --import tsx server/babysitter.test.ts server/watcherScheduler.test.ts`

Expected: PASS

### Task 6: Queue Babysitter Execution While Preserving `agent_runs`

**Files:**
- Modify: `server/babysitter.ts`
- Modify: `server/routes.ts`
- Modify: `server/backgroundJobHandlers.ts`
- Test: `server/babysitter.test.ts`
- Test: `server/routes.test.ts`

**Step 1: Write the failing babysitter queue tests**

Add tests that prove:

- routes that previously launched `babysitPR()` now enqueue `babysit_pr`,
- duplicate queued babysit work for the same PR is coalesced,
- stale leased `babysit_pr` jobs are reclaimed on restart,
- existing `resumeInterruptedRuns()` agent-run recovery still works once the babysitter handler starts.

**Step 2: Run the targeted tests**

Run: `node --test --import tsx server/babysitter.test.ts server/routes.test.ts`

Expected: FAIL because the routes still run the babysitter directly.

**Step 3: Change babysitter trigger paths**

Update:

- add PR,
- retry feedback,
- manual babysit/apply,
- watcher discovery path

so each one enqueues `babysit_pr:<pr_id>` instead of calling `babysitPR()` directly.

Keep the existing `PRBabysitter.babysitPR()` implementation as the handler body so `agent_runs` remains the internal replay journal.

**Step 4: Register the queue handler**

Add `babysit_pr` handling in `server/backgroundJobHandlers.ts` by calling `babysitter.babysitPR(prId, preferredAgent)`.

Use payload values only for optional overrides that already exist in the babysitter API.

**Step 5: Re-run the babysitter tests**

Run: `node --test --import tsx server/babysitter.test.ts server/routes.test.ts`

Expected: PASS

### Task 7: Make Drain And Runtime Queue-Aware

**Files:**
- Modify: `server/routes.ts`
- Modify: `server/babysitter.ts`
- Modify: `server/releaseManager.ts`
- Modify: `server/backgroundJobDispatcher.ts`
- Test: `server/routes.test.ts`
- Test: `server/babysitter.test.ts`

**Step 1: Write the failing drain/runtime tests**

Add tests that prove:

- `/api/runtime` reports queue-backed active work,
- `POST /api/runtime/drain` waits for dispatcher idle, not only babysitter memory state,
- stale leased jobs are requeued on startup but not claimed while drain mode is enabled.

**Step 2: Run the targeted tests**

Run: `node --test --import tsx server/routes.test.ts server/babysitter.test.ts`

Expected: FAIL because drain idle still only looks at `babysitter.waitForIdle()`.

**Step 3: Wire runtime to the dispatcher**

Update `server/routes.ts` so:

- runtime snapshot uses dispatcher active job count,
- drain wait uses dispatcher `waitForIdle()`,
- startup order is:
  1. refresh watcher schedule
  2. reclaim stale jobs
  3. start dispatcher
  4. enqueue initial `sync_watched_repos`

Keep drain gating for manual endpoints.

**Step 4: Re-run the targeted drain/runtime tests**

Run: `node --test --import tsx server/routes.test.ts server/babysitter.test.ts`

Expected: PASS

### Task 8: Full Verification

**Files:**
- Modify: `docs/plans/2026-04-02-durable-background-job-queue-design.md`
- Modify: `docs/plans/2026-04-02-durable-background-job-queue.md`

**Step 1: Run the focused server suite**

Run:

```bash
node --test --import tsx \
  server/storage.test.ts \
  server/memoryStorage.test.ts \
  server/backgroundJobQueue.test.ts \
  server/backgroundJobDispatcher.test.ts \
  server/prQuestionAgent.test.ts \
  server/releaseManager.test.ts \
  server/babysitter.test.ts \
  server/watcherScheduler.test.ts \
  server/routes.test.ts
```

Expected: PASS

**Step 2: Run static verification**

Run: `npm run check`

Expected: PASS

**Step 3: Review the final diff for scope**

Run:

```bash
git status --short
git diff --stat
```

Expected:

- only queue-related server/shared changes,
- no unrelated branch churn,
- new tests and plan docs included.

**Step 4: Commit**

```bash
git add shared/schema.ts shared/models.ts server/storage.ts server/sqliteStorage.ts server/memoryStorage.ts server/backgroundJobQueue.ts server/backgroundJobDispatcher.ts server/backgroundJobHandlers.ts server/routes.ts server/babysitter.ts server/releaseManager.ts server/prQuestionAgent.ts server/socialChangelogAgent.ts server/*.test.ts docs/plans/2026-04-02-durable-background-job-queue-design.md docs/plans/2026-04-02-durable-background-job-queue.md
git commit -m "feat: add durable background job queue"
```
