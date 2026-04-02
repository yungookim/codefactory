# Durable Background Job Queue Design

**Date:** 2026-04-02
**Status:** Approved

## Goal

Replace the app's remaining fire-and-forget background execution paths on current `main` with a SQLite-backed durable job queue that supports:

- leased execution,
- periodic heartbeats,
- stale-lease recovery on startup,
- drain-aware dispatch,
- idempotent enqueue semantics,
- startup resumption for every non-terminal job type.

The implementation target is current `main` only. The periodic watcher remains an in-process timer and does not become its own leased worker process. Its responsibility is reduced to enqueueing durable queue work.

## Scope

### In Scope

- Add a new generic `background_jobs` SQLite table.
- Add a queue/dispatcher runtime that claims jobs with leases and heartbeats.
- Recover stale leased jobs on startup.
- Route all background work on current `main` through the queue:
  - watched-repo sync/discovery,
  - PR babysitter runs,
  - release-run processing,
  - PR question answering,
  - social changelog generation.
- Keep drain mode semantics intact while making idle detection queue-aware.

### Out Of Scope

- Multi-process or multi-host coordination.
- Replacing SQLite with another queue backend.
- Turning the periodic watcher tick itself into a durable leased job.
- Adding a new dashboard surface for queue internals in v1.
- Pulling in newer branch-only job systems that are not present on current `main`.

## Current Problem

Current `main` mixes durable domain state with non-durable execution triggers:

- babysitter runs have durable `agent_runs` recovery, but most triggers still call worker code directly;
- release runs are persisted, but processing is scheduled through in-memory promises;
- PR questions are persisted, but answering is fire-and-forget;
- social changelogs are persisted, but generation is fire-and-forget;
- the watcher timer directly runs repo sync/discovery instead of enqueueing durable work.

This creates inconsistent crash behavior. Some work survives restart, some is stranded mid-flight, and drain/idle only measure babysitter memory state instead of all background activity.

## Design Principles

- SQLite remains the single local source of truth.
- Domain tables continue to model product state; the queue models runnable work.
- Queue handlers are thin orchestration layers over existing domain-specific services.
- Existing replay-safe babysitter logic is reused, not rewritten.
- Enqueue operations are idempotent by dedupe key.
- Startup recovery prefers reconciliation over blind retry.
- The system remains single-process by design, but stale-lease recovery protects against crash/restart.

## Job Model

Introduce a new `background_jobs` table with one row per durable unit of execution.

### Job Kinds

- `sync_watched_repos`
- `babysit_pr`
- `process_release_run`
- `answer_pr_question`
- `generate_social_changelog`

`sync_watched_repos` is the only infrastructure job kind. The other four correspond to existing domain rows and user-visible workflows.

### Queue States

- `queued`
- `leased`
- `completed`
- `failed`
- `canceled`

`queued` means runnable when `available_at <= now`.
`leased` means currently owned by the active process and expected to heartbeat.
`completed`, `failed`, and `canceled` are terminal.

### Table Shape

`background_jobs`

- `id TEXT PRIMARY KEY`
- `kind TEXT NOT NULL`
- `target_id TEXT NOT NULL`
- `dedupe_key TEXT NOT NULL`
- `status TEXT NOT NULL`
- `priority INTEGER NOT NULL DEFAULT 100`
- `available_at TEXT NOT NULL`
- `lease_owner TEXT`
- `lease_token TEXT`
- `lease_expires_at TEXT`
- `heartbeat_at TEXT`
- `attempt_count INTEGER NOT NULL DEFAULT 0`
- `last_error TEXT`
- `payload_json TEXT NOT NULL`
- `created_at TEXT NOT NULL`
- `updated_at TEXT NOT NULL`
- `completed_at TEXT`

Indexes:

- `idx_background_jobs_status_available_at` on `(status, available_at, priority, created_at)`
- `idx_background_jobs_lease_expires_at` on `(status, lease_expires_at)`
- `idx_background_jobs_kind_status` on `(kind, status)`
- partial unique index on `dedupe_key` where `status IN ('queued', 'leased')`

The partial unique index enforces “at most one active job per dedupe key” and complements application-level dedupe checks.

## Separation Of Concerns

The queue is an execution envelope, not a replacement for domain state.

### Domain Tables Stay Authoritative

- `agent_runs` remain the durable babysitter run journal.
- `release_runs` remain the durable release workflow record.
- `pr_questions` remain the canonical question/answer record.
- `social_changelogs` remain the canonical changelog generation record.

### Queue Rows Answer A Different Question

Queue rows answer:

- what work is runnable now,
- which process currently owns that work,
- when the lease expires,
- how many attempts have been made,
- what the latest execution error was.

This keeps retry, drain, and crash-recovery mechanics out of domain schemas.

## Dispatcher And Lease Lifecycle

Add a new in-process dispatcher module responsible for:

- enqueueing jobs,
- claiming the next runnable job,
- heartbeating active leases,
- completing or failing jobs,
- reclaiming stale leases,
- exposing queue-aware idle state.

### Ownership Model

- Each process gets a stable `workerId` for its lifetime.
- Each claim generates a fresh `leaseToken`.
- Heartbeat, complete, fail, or cancel operations require the matching `jobId + leaseToken`.

This prevents a stale completion call from mutating a job already reclaimed by a newer claim after restart.

### Lease Timing

Initial v1 defaults:

- lease duration: 30 seconds
- heartbeat cadence: 10 seconds
- dispatcher poll interval: 1 second

The dispatcher wrapper starts a heartbeat timer before invoking the handler and clears it when the handler resolves.

### Startup Recovery

On startup:

1. scan for `leased` jobs with `lease_expires_at < now`,
2. move them back to `queued`,
3. clear lease ownership fields,
4. keep `attempt_count` and `last_error`,
5. start the dispatcher loop.

This makes stale recovery generic across all job kinds instead of implementing one-off boot logic in every subsystem.

## Queue Handlers

### `sync_watched_repos`

Purpose:

- replace the watcher's direct execution path with a durable queue job.

Behavior:

- dedupe key: `sync_watched_repos`
- payload: empty JSON object
- target id: fixed runtime sentinel, for example `runtime:1`
- handler performs the current watched-repo sync/discovery flow:
  - load watched repos and tracked PRs,
  - refresh GitHub state,
  - archive closed PRs,
  - auto-register newly discovered PRs,
  - enqueue `babysit_pr` jobs instead of calling `babysitPR()` directly,
  - enqueue release-run jobs via `ReleaseManager` when merged archived PRs are detected,
  - enqueue social changelog jobs through the existing creation flow when thresholds are met.

This keeps the timer cheap. The timer only enqueues `sync_watched_repos`; all heavy GitHub I/O becomes durable queue work.

### `babysit_pr`

Purpose:

- run or resume babysitter work for one PR.

Behavior:

- dedupe key: `babysit_pr:<pr_id>`
- target id: PR id
- handler calls the existing babysitter orchestration entrypoint.

Important detail:

The queue does not replace `agent_runs`. `babysit_pr` only decides when the babysitter starts. Once inside `PRBabysitter`, the existing `agent_runs` journal still records prompt preparation, replay context, reconcile phases, and final result.

### `process_release_run`

Purpose:

- replace `ReleaseManager`'s in-memory scheduling.

Behavior:

- dedupe key: `process_release_run:<release_run_id>`
- target id: release run id
- handler calls `releaseManager.processReleaseRun(id)`

`ReleaseManager` keeps repo-scoped locking for correctness. The queue becomes its durable trigger and recovery mechanism.

### `answer_pr_question`

Purpose:

- replace fire-and-forget question answering.

Behavior:

- dedupe key: `answer_pr_question:<question_id>`
- target id: question id
- handler calls the existing question-answer flow.

If the question row is already terminal (`answered` or `error`), the handler completes as a no-op.

### `generate_social_changelog`

Purpose:

- replace fire-and-forget changelog generation.

Behavior:

- dedupe key: `generate_social_changelog:<changelog_id>`
- target id: changelog id
- handler calls the existing changelog generation flow.

If the changelog row is already `done` or `error`, the handler completes as a no-op.

## Enqueue Semantics

All enqueue paths become idempotent.

### Rules

- If a `queued` or `leased` job already exists for a dedupe key, return that job and do not create a new one.
- If the newest job for that dedupe key is terminal, create a fresh row.
- Manual retry endpoints should create a fresh job only after the underlying domain row is reset into a retryable state.

### Examples

- repeated watcher ticks should not create multiple active `sync_watched_repos` jobs;
- repeated manual “retry feedback” or auto-watch events should not create multiple `babysit_pr` jobs for the same PR;
- repeated release enqueue calls should not create multiple active `process_release_run` jobs for one `release_run`;
- repeated page refreshes after `POST /api/prs/:id/questions` must not answer the same question twice.

## Drain Mode And Runtime Lifecycle

Drain mode remains persisted in `runtime_state`.

### Drain Rules

- while drain mode is enabled, the dispatcher does not claim new queued jobs;
- already leased jobs are allowed to continue;
- the watcher timer does not enqueue `sync_watched_repos`;
- endpoints that already reject in drain mode continue to reject;
- startup recovery requeues stale jobs but does not claim them until drain mode is disabled.

### Idle Semantics

Queue-aware idle means:

- no active leased jobs owned by this process,
- no in-memory handler promises still running.

`/api/runtime` can continue returning `activeRuns`, but that value should now represent active background jobs rather than only babysitter runs so the existing API remains compatible.

## Error Handling And Retry Policy

V1 should be conservative.

### Queue-Level Policy

- no blind automatic retry loop for handler failures;
- stale-lease recovery is the only automatic replay mechanism;
- handler exceptions mark the job `failed` and persist `last_error`;
- missing target rows mark the job `canceled`, not `failed`.

### Domain-Level Policy

Existing domain retry semantics remain in place:

- release retry still uses the release retry endpoint;
- babysitter retry still uses the existing feedback/PR actions;
- question and changelog retries can be added later if needed.

This avoids layered retry storms while still guaranteeing crash recovery.

## Runtime Integration

### New Queue Runtime Modules

- `server/backgroundJobQueue.ts`
  Storage-backed queue primitives: enqueue, claim, heartbeat, complete, fail, cancel, reclaim stale jobs.
- `server/backgroundJobDispatcher.ts`
  In-process worker loop, worker identity, handler registry, idle tracking.
- `server/backgroundJobHandlers.ts`
  Job-kind handlers and their dependency wiring.

### Existing Modules To Adapt

- `server/routes.ts`
  Start the dispatcher, enqueue jobs from endpoints, and make drain/idle queue-aware.
- `server/babysitter.ts`
  Replace direct watcher-triggered execution with `sync_watched_repos` enqueue and `babysit_pr` enqueue.
- `server/releaseManager.ts`
  Remove in-memory `backgroundJobs` scheduling and enqueue queue jobs instead.
- `server/prQuestionAgent.ts`
  Keep handler logic, but move direct route invocation to queue enqueue.
- `server/socialChangelogAgent.ts`
  Keep generation logic, but move direct invocation to queue enqueue.
- `server/storage.ts`, `server/sqliteStorage.ts`, `server/memoryStorage.ts`
  Add queue storage methods and schema.

## Observability

V1 does not require a new dashboard queue page, but it must remain observable enough to debug.

### Minimum Visibility

- `background_jobs` stores `status`, `attempt_count`, `lease_expires_at`, and `last_error`;
- queue handlers keep writing existing domain logs where those already exist;
- startup stale-job reclamation logs to the console and, where possible, to associated PR logs;
- `/api/runtime` reflects queue-aware active work.

If a future UI wants queue visibility, the stored queue state is already durable.

## Testing Strategy

### Storage Tests

- create/list/filter background jobs;
- dedupe behavior for active jobs;
- claim next available job with priority and availability ordering;
- heartbeat extends only the matching lease token;
- complete/fail/cancel require correct lease token;
- stale leased job reclamation.

### Dispatcher Tests

- startup reclaim requeues expired leases;
- drain mode blocks new claims;
- wait-for-idle tracks active queue handlers, not only babysitter state;
- no duplicate handler execution for the same dedupe key.

### Integration Tests

- watcher timer enqueues `sync_watched_repos` instead of doing direct work;
- watched repo sync enqueues `babysit_pr` jobs for discovered PRs;
- release processing resumes from queued jobs after restart;
- PR questions survive restart and finish once the dispatcher restarts;
- social changelog generation survives restart;
- babysitter queue jobs still preserve existing `agent_runs` recovery semantics.

## Rollout Order

Implement in this order:

1. queue schema and storage primitives,
2. dispatcher runtime,
3. `answer_pr_question`,
4. `generate_social_changelog`,
5. `process_release_run`,
6. `sync_watched_repos`,
7. `babysit_pr`,
8. drain/runtime integration and final verification.

This keeps early risk low and leaves the most stateful git-mutating path for last.

## Risks

- The queue introduces more frequent SQLite writes; lease operations must rely on existing WAL and lock-recovery hardening.
- `sync_watched_repos` is an infrastructure job with no natural domain row, so its target/sentinel semantics must be explicit.
- Babysitter execution already has its own durable run journal, so queue integration must not accidentally double-retry the same prompt.
- A single global dispatcher may reduce concurrency if implemented too conservatively; v1 should preserve multi-PR babysitter concurrency where practical.

## Recommendation

Use one shared `background_jobs` table, keep the periodic watcher as a timer that only enqueues `sync_watched_repos`, and preserve existing domain records as the product source of truth.

That is the smallest architecture change that makes every current background path on `main` durable, restart-safe, and drain-aware while staying aligned with the app's single-process SQLite runtime.
