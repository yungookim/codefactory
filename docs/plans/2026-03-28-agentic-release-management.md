# Agentic Release Management Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Automatically evaluate merged PRs for release-worthiness, publish GitHub releases with agent-authored notes when warranted, and expose durable release history in a dedicated UI.

**Architecture:** Extend the watcher to confirm merges, persist `ReleaseRun` jobs, process them through a dedicated release manager, and publish releases through GitHub APIs. Mirror the existing social-changelog pattern for storage/API/UI, but keep versioning and publish logic deterministic in the app.

**Tech Stack:** TypeScript, Express, React, TanStack Query, SQLite, Zod, Octokit, Node test runner

---

### Task 1: Add shared release types

**Files:**
- Modify: `shared/schema.ts`
- Modify: `shared/models.ts`

**Step 1: Write the failing test**

Add schema/model assertions for a new `ReleaseRun` type and the new config flag in existing schema-adjacent tests or in a new server storage test path.

**Step 2: Run test to verify it fails**

Run: `./node_modules/.bin/tsx --test server/storage.test.ts`
Expected: FAIL because `ReleaseRun` types and config support do not exist yet.

**Step 3: Write minimal implementation**

- Add `releaseRunStatusEnum`
- Add `releaseRunIncludedPRSchema`
- Add `releaseRunSchema`
- Add `autoCreateReleases` to `configSchema`
- Add `createReleaseRun` and `applyReleaseRunUpdate`

**Step 4: Run test to verify it passes**

Run: `./node_modules/.bin/tsx --test server/storage.test.ts`
Expected: PASS for schema/model coverage.

**Step 5: Commit**

```bash
git add shared/schema.ts shared/models.ts server/storage.test.ts
git commit -m "feat: add release run schemas"
```

### Task 2: Extend storage for release runs

**Files:**
- Modify: `server/storage.ts`
- Modify: `server/memoryStorage.ts`
- Modify: `server/sqliteStorage.ts`
- Modify: `server/storage.test.ts`
- Modify: `server/memoryStorage.test.ts`

**Step 1: Write the failing test**

Add storage tests for:

- create/list/update release run
- lookup by repo + merge SHA
- config round-trip for `autoCreateReleases`

**Step 2: Run test to verify it fails**

Run: `./node_modules/.bin/tsx --test server/storage.test.ts server/memoryStorage.test.ts`
Expected: FAIL because storage methods and SQLite schema do not exist yet.

**Step 3: Write minimal implementation**

- Add `release_runs` table and indexes
- Add parsing helpers and CRUD methods
- Update memory storage maps and config defaults

**Step 4: Run test to verify it passes**

Run: `./node_modules/.bin/tsx --test server/storage.test.ts server/memoryStorage.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add server/storage.ts server/memoryStorage.ts server/sqliteStorage.ts server/storage.test.ts server/memoryStorage.test.ts server/defaultConfig.ts
git commit -m "feat: persist release runs"
```

### Task 3: Add GitHub release primitives

**Files:**
- Modify: `server/github.ts`
- Modify: `server/github.test.ts`

**Step 1: Write the failing test**

Add tests for:

- fetching merged PR detail including merged metadata
- choosing the latest semver tag
- bumping versions from `patch|minor|major`
- creating a GitHub release request

**Step 2: Run test to verify it fails**

Run: `./node_modules/.bin/tsx --test server/github.test.ts`
Expected: FAIL because helper functions do not exist.

**Step 3: Write minimal implementation**

- Add merged PR detail fetch helper
- Add release/tag listing helper
- Add semver parsing/version bump helpers
- Add GitHub release creation helper

**Step 4: Run test to verify it passes**

Run: `./node_modules/.bin/tsx --test server/github.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add server/github.ts server/github.test.ts
git commit -m "feat: add github release helpers"
```

### Task 4: Add agent release evaluation

**Files:**
- Create: `server/releaseAgent.ts`
- Modify: `server/agentRunner.ts`
- Add or Modify: `server/agentRunner.test.ts`

**Step 1: Write the failing test**

Add tests for parsing structured evaluation JSON and rejecting invalid output.

**Step 2: Run test to verify it fails**

Run: `./node_modules/.bin/tsx --test server/agentRunner.test.ts`
Expected: FAIL because release evaluation helpers do not exist.

**Step 3: Write minimal implementation**

- Extract generic JSON-evaluation support if needed
- Add prompt builder/parser for release decisions

**Step 4: Run test to verify it passes**

Run: `./node_modules/.bin/tsx --test server/agentRunner.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add server/releaseAgent.ts server/agentRunner.ts server/agentRunner.test.ts
git commit -m "feat: add release evaluation agent"
```

### Task 5: Add release manager orchestration

**Files:**
- Create: `server/releaseManager.ts`
- Add: `server/releaseManager.test.ts`

**Step 1: Write the failing test**

Add tests for:

- merged PR creates a release run
- unmerged closure does not
- skipped decision persists
- successful publish persists release URL/version
- duplicate trigger does not create duplicate publish

**Step 2: Run test to verify it fails**

Run: `./node_modules/.bin/tsx --test server/releaseManager.test.ts`
Expected: FAIL because the release manager does not exist.

**Step 3: Write minimal implementation**

- Add repo-level run lock
- Add `enqueueMergedPrReleaseEvaluation(...)`
- Add `processReleaseRun(...)`
- Keep publish deterministic and idempotent

**Step 4: Run test to verify it passes**

Run: `./node_modules/.bin/tsx --test server/releaseManager.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add server/releaseManager.ts server/releaseManager.test.ts
git commit -m "feat: add release manager"
```

### Task 6: Hook merge detection into the watcher

**Files:**
- Modify: `server/babysitter.ts`
- Modify: `server/babysitter.test.ts`

**Step 1: Write the failing test**

Add watcher/babysitter tests for:

- merged archived PR enqueues release evaluation
- closed-unmerged PR only archives
- auto-release disable flag skips enqueue

**Step 2: Run test to verify it fails**

Run: `./node_modules/.bin/tsx --test server/babysitter.test.ts`
Expected: FAIL because the watcher does not notify a release manager today.

**Step 3: Write minimal implementation**

- Inject the release manager dependency
- Confirm merge status before enqueue
- Preserve existing archive and social-changelog behavior

**Step 4: Run test to verify it passes**

Run: `./node_modules/.bin/tsx --test server/babysitter.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add server/babysitter.ts server/babysitter.test.ts
git commit -m "feat: enqueue releases from merged prs"
```

### Task 7: Add release APIs

**Files:**
- Modify: `server/routes.ts`
- Add or Modify: route-level tests if present

**Step 1: Write the failing test**

Add API coverage for:

- `GET /api/releases`
- `GET /api/releases/:id`
- `POST /api/releases/:id/retry`
- `PATCH /api/config` round-trip for `autoCreateReleases`

**Step 2: Run test to verify it fails**

Run: `./node_modules/.bin/tsx --test server/*.test.ts`
Expected: FAIL because routes do not exist.

**Step 3: Write minimal implementation**

- Expose release list/detail/retry endpoints
- Reuse existing config mutation path

**Step 4: Run test to verify it passes**

Run: `./node_modules/.bin/tsx --test server/*.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add server/routes.ts
git commit -m "feat: expose release management api"
```

### Task 8: Add releases page and navigation

**Files:**
- Modify: `client/src/App.tsx`
- Modify: `client/src/pages/dashboard.tsx`
- Create: `client/src/pages/releases.tsx`
- Modify: `client/src/pages/settings.tsx`

**Step 1: Write the failing test**

Add focused UI coverage if the repo already has page tests, otherwise validate manually after implementation.

**Step 2: Run test to verify it fails**

Run: `npm run check`
Expected: FAIL once imports/routes reference the new types and page before implementation.

**Step 3: Write minimal implementation**

- Add `/releases` route
- Add dashboard header link
- Build release history page with adaptive polling and expandable cards
- Add `autoCreateReleases` toggle in settings

**Step 4: Run test to verify it passes**

Run: `npm run check`
Expected: PASS

**Step 5: Commit**

```bash
git add client/src/App.tsx client/src/pages/dashboard.tsx client/src/pages/releases.tsx client/src/pages/settings.tsx
git commit -m "feat: add release management ui"
```

### Task 9: End-to-end verification

**Files:**
- Modify: any touched files as needed from verification failures

**Step 1: Run focused test suites**

Run:

```bash
./node_modules/.bin/tsx --test server/github.test.ts server/agentRunner.test.ts server/releaseManager.test.ts server/babysitter.test.ts server/storage.test.ts server/memoryStorage.test.ts
```

Expected: PASS

**Step 2: Run typecheck**

Run:

```bash
npm run check
```

Expected: PASS

**Step 3: Run full server tests**

Run:

```bash
node --test --import tsx server/*.test.ts
```

Expected: PASS

**Step 4: Review diff for simplicity**

Run:

```bash
git diff --stat
```

Expected: release feature touches only the server, shared types, storage, and UI surfaces needed for the feature.

**Step 5: Commit**

```bash
git add .
git commit -m "feat: automate release management for merged prs"
```
