# Autonomous Persistent PR Babysitter Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace in-memory/manual PR babysitting with a persistent autonomous local service that stores full state in `~/.codefactory`, mirrors verbose logs to daily files, renders GitHub markdown feedback as safe HTML, and simplifies the dashboard to a monitoring UI.

**Architecture:** Introduce a filesystem-backed SQLite storage layer as the source of truth for config, watched repos, PRs, feedback items, and structured logs. Keep the babysitter as the orchestration layer, but upgrade it to emit run-scoped verbose progress and commit/push automatically after successful agent runs. Render GitHub markdown to sanitized HTML on ingest and display it directly in the dashboard.

**Tech Stack:** Node.js, TypeScript, Express, React, local SQLite (`better-sqlite3` recommended), filesystem log mirroring, sanitized markdown rendering (`marked` plus `sanitize-html` recommended), Node test runner via `node --test --import tsx`

---

### Task 1: Add Local Persistence Dependencies And Path Helpers

**Files:**
- Create: `server/paths.ts`
- Modify: `package.json`
- Modify: `package-lock.json`
- Test: `server/paths.test.ts`

**Step 1: Write the failing test**

```ts
import test from "node:test";
import assert from "node:assert/strict";
import path from "path";
import os from "os";
import { getCodeFactoryPaths } from "./paths";

test("getCodeFactoryPaths prefers CODEFACTORY_HOME and falls back to ~/.codefactory", () => {
  process.env.CODEFACTORY_HOME = "/tmp/codefactory-test";
  const override = getCodeFactoryPaths();
  assert.equal(override.rootDir, "/tmp/codefactory-test");
  delete process.env.CODEFACTORY_HOME;

  const fallback = getCodeFactoryPaths();
  assert.equal(fallback.rootDir, path.join(os.homedir(), ".codefactory"));
});
```

**Step 2: Run test to verify it fails**

Run: `node --test --import tsx server/paths.test.ts`
Expected: FAIL with `Cannot find module './paths'`

**Step 3: Write minimal implementation**

```ts
import os from "os";
import path from "path";

export function getCodeFactoryPaths() {
  const rootDir = process.env.CODEFACTORY_HOME || path.join(os.homedir(), ".codefactory");
  return {
    rootDir,
    stateDbPath: path.join(rootDir, "state.sqlite"),
    logRootDir: path.join(rootDir, "log"),
  };
}
```

Also add persistence/rendering dependencies to `package.json`:

- `better-sqlite3`
- `marked`
- `sanitize-html`

**Step 4: Run test to verify it passes**

Run: `node --test --import tsx server/paths.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add package.json package-lock.json server/paths.ts server/paths.test.ts
git commit -m "feat: add codefactory path helpers"
```

### Task 2: Replace MemStorage With SQLite-Backed Durable Storage

**Files:**
- Create: `server/sqliteStorage.ts`
- Modify: `server/storage.ts`
- Test: `server/storage.test.ts`

**Step 1: Write the failing test**

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "fs/promises";
import os from "os";
import path from "path";
import { SqliteStorage } from "./sqliteStorage";

test("SqliteStorage reloads config and PR state from the same CODEFACTORY_HOME", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "codefactory-storage-"));
  const first = new SqliteStorage(root);
  await first.updateConfig({ pollIntervalMs: 45000 });
  const pr = await first.addPR({
    number: 106,
    title: "Example",
    repo: "alex-morgan-o/lolodex",
    branch: "feature/test",
    author: "octocat",
    url: "https://github.com/alex-morgan-o/lolodex/pull/106",
    status: "watching",
    feedbackItems: [],
    accepted: 0,
    rejected: 0,
    flagged: 0,
    testsPassed: null,
    lintPassed: null,
    lastChecked: null,
  });

  const second = new SqliteStorage(root);
  assert.equal((await second.getConfig()).pollIntervalMs, 45000);
  assert.equal((await second.getPR(pr.id))?.repo, "alex-morgan-o/lolodex");
});
```

**Step 2: Run test to verify it fails**

Run: `node --test --import tsx server/storage.test.ts`
Expected: FAIL because `SqliteStorage` does not exist

**Step 3: Write minimal implementation**

Implement:

- SQLite schema bootstrap for `config`, `watched_repos`, `prs`, `feedback_items`, and `logs`
- async wrapper methods matching `IStorage`
- hydration of `feedbackItems` from the `feedback_items` table
- singleton config row bootstrap with current defaults

Keep `server/storage.ts` as the interface/export surface and replace `MemStorage` as the production `storage` export.

**Step 4: Run test to verify it passes**

Run: `node --test --import tsx server/storage.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add server/storage.ts server/sqliteStorage.ts server/storage.test.ts
git commit -m "feat: persist app state in sqlite"
```

### Task 3: Mirror Structured Logs To Daily Files

**Files:**
- Create: `server/logFiles.ts`
- Modify: `server/sqliteStorage.ts`
- Modify: `server/storage.ts`
- Test: `server/log-files.test.ts`

**Step 1: Write the failing test**

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "fs/promises";
import { mkdtemp } from "fs/promises";
import os from "os";
import path from "path";
import { SqliteStorage } from "./sqliteStorage";

test("addLog writes both sqlite state and ~/.codefactory/log/YYYY-MM-DD file output", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "codefactory-logs-"));
  const storage = new SqliteStorage(root);
  const pr = await storage.addPR({
    number: 106,
    title: "Example",
    repo: "alex-morgan-o/lolodex",
    branch: "feature/test",
    author: "octocat",
    url: "https://github.com/alex-morgan-o/lolodex/pull/106",
    status: "watching",
    feedbackItems: [],
    accepted: 0,
    rejected: 0,
    flagged: 0,
    testsPassed: null,
    lintPassed: null,
    lastChecked: null,
  });

  await storage.addLog(pr.id, "info", "agent started");
  const logs = await storage.getLogs(pr.id);
  assert.equal(logs.at(-1)?.message, "agent started");
});
```

**Step 2: Run test to verify it fails**

Run: `node --test --import tsx server/log-files.test.ts`
Expected: FAIL because file mirroring is not implemented

**Step 3: Write minimal implementation**

Implement a helper that:

- creates `~/.codefactory/log/YYYY-MM-DD/`
- resolves a per-PR filename like `alex-morgan-o__lolodex__106.log`
- appends one formatted line per log event

Wire `SqliteStorage.addLog()` to persist the row and then mirror it to disk.

**Step 4: Run test to verify it passes**

Run: `node --test --import tsx server/log-files.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add server/logFiles.ts server/sqliteStorage.ts server/log-files.test.ts
git commit -m "feat: mirror pr logs to daily files"
```

### Task 4: Persist Feedback HTML And Safe Markdown Rendering

**Files:**
- Create: `server/markdown.ts`
- Modify: `shared/schema.ts`
- Modify: `server/github.ts`
- Test: `server/markdown.test.ts`
- Test: `server/github.test.ts`

**Step 1: Write the failing test**

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { renderGitHubMarkdown } from "./markdown";

test("renderGitHubMarkdown preserves markdown structure and strips unsafe html", () => {
  const html = renderGitHubMarkdown("**bold**\n\n```js\nconsole.log(1)\n```\n<script>alert(1)</script>");
  assert.match(html, /<strong>bold<\/strong>/);
  assert.match(html, /<pre><code class="language-js">/);
  assert.doesNotMatch(html, /<script>/);
});
```

**Step 2: Run test to verify it fails**

Run: `node --test --import tsx server/markdown.test.ts server/github.test.ts`
Expected: FAIL because the markdown renderer and `bodyHtml` field do not exist

**Step 3: Write minimal implementation**

Implement:

- `renderGitHubMarkdown(markdown: string): string`
- `bodyHtml` on `FeedbackItem`
- `fetchFeedbackItemsForPR()` storing raw markdown in `body` and sanitized HTML in `bodyHtml`

Retain the current bot-filter test and extend it to assert the rendered HTML field is populated.

**Step 4: Run test to verify it passes**

Run: `node --test --import tsx server/markdown.test.ts server/github.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add shared/schema.ts server/markdown.ts server/markdown.test.ts server/github.ts server/github.test.ts
git commit -m "feat: render github feedback as safe html"
```

### Task 5: Stream Verbose Agent Progress Into Structured Logs

**Files:**
- Modify: `shared/schema.ts`
- Modify: `server/agentRunner.ts`
- Modify: `server/babysitter.ts`
- Test: `server/babysitter.test.ts`

**Step 1: Write the failing test**

```ts
test("babysitter emits run-scoped verbose logs for agent and git phases", async () => {
  // Arrange storage and github service doubles
  // Trigger a babysitter run with one accepted feedback item
  // Assert log messages include:
  // - run started
  // - agent stdout chunk
  // - git commit
  // - git push
  // - run complete
});
```

**Step 2: Run test to verify it fails**

Run: `node --test --import tsx server/babysitter.test.ts`
Expected: FAIL because agent output is only collected at process end

**Step 3: Write minimal implementation**

Implement:

- `runStreamingCommand()` or callback support in `agentRunner.ts`
- `run_id`, `phase`, and optional metadata support on log entries
- chunked stdout/stderr logging from the coding agent
- explicit phase logs in the babysitter for worktree, evaluation, commit, push, and cleanup

Keep the existing completion-log regression test and extend the same suite with verbose progress assertions.

**Step 4: Run test to verify it passes**

Run: `node --test --import tsx server/babysitter.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add shared/schema.ts server/agentRunner.ts server/babysitter.ts server/babysitter.test.ts
git commit -m "feat: stream verbose babysitter progress logs"
```

### Task 6: Make Autonomous Babysit The Default Flow

**Files:**
- Modify: `server/routes.ts`
- Modify: `server/babysitter.ts`
- Test: `server/routes.test.ts`

**Step 1: Write the failing test**

```ts
test("adding a PR immediately enqueues an autonomous babysitter run", async () => {
  // POST /api/prs
  // assert the PR is stored
  // assert logs contain registration and background babysitter start
});
```

**Step 2: Run test to verify it fails**

Run: `node --test --import tsx server/routes.test.ts`
Expected: FAIL because the route/test harness does not yet assert autonomous run semantics

**Step 3: Write minimal implementation**

Implement:

- explicit route log messages that background babysitting has begun
- status transitions that make automatic work visible in the UI
- no confirmation pause before the commit/push path

Do not add new manual gating controls.

**Step 4: Run test to verify it passes**

Run: `node --test --import tsx server/routes.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add server/routes.ts server/babysitter.ts server/routes.test.ts
git commit -m "feat: make autonomous babysitting the default flow"
```

### Task 7: Simplify The Dashboard And Remove Manual Control Buttons

**Files:**
- Modify: `client/src/pages/dashboard.tsx`
- Delete: `client/src/components/PerplexityAttribution.tsx`
- Test: `client/src/pages/dashboard.test.tsx`

**Step 1: Write the failing test**

```tsx
it("does not render Fetch, Triage, Remove, or the Perplexity footer", () => {
  // render Dashboard with one selected PR
  // expect screen.queryByText("Fetch") toBeNull()
  // expect screen.queryByText("Triage") toBeNull()
  // expect screen.queryByText("Remove") toBeNull()
  // expect screen.queryByText(/Perplexity/i) toBeNull()
});
```

**Step 2: Run test to verify it fails**

Run: `npm run test -- client/src/pages/dashboard.test.tsx`
Expected: FAIL because the buttons/footer still render

**Step 3: Write minimal implementation**

Implement:

- remove manual fetch/triage/remove mutations and buttons
- remove the footer attribution import/render path
- keep the log panel visible and polling

If there is no frontend test harness yet, add the smallest possible one or convert this task to a documented manual verification step before merging.

**Step 4: Run test to verify it passes**

Run: `npm run test -- client/src/pages/dashboard.test.tsx`
Expected: PASS

**Step 5: Commit**

```bash
git add client/src/pages/dashboard.tsx client/src/components/PerplexityAttribution.tsx client/src/pages/dashboard.test.tsx
git commit -m "feat: simplify babysitter dashboard controls"
```

### Task 8: Render Feedback Bodies As HTML In The Dashboard

**Files:**
- Modify: `client/src/pages/dashboard.tsx`
- Test: `client/src/pages/dashboard.test.tsx`

**Step 1: Write the failing test**

```tsx
it("renders sanitized feedback html instead of raw markdown text", () => {
  // render a feedback item with body="**bold**" and bodyHtml="<p><strong>bold</strong></p>"
  // assert the strong element exists
});
```

**Step 2: Run test to verify it fails**

Run: `npm run test -- client/src/pages/dashboard.test.tsx`
Expected: FAIL because the dashboard still renders `item.body` as plain text

**Step 3: Write minimal implementation**

Implement:

- render `item.bodyHtml` with `dangerouslySetInnerHTML`
- fallback to plain text only when `bodyHtml` is absent
- style rendered markdown blocks so code blocks and lists remain readable

**Step 4: Run test to verify it passes**

Run: `npm run test -- client/src/pages/dashboard.test.tsx`
Expected: PASS

**Step 5: Commit**

```bash
git add client/src/pages/dashboard.tsx client/src/pages/dashboard.test.tsx
git commit -m "feat: render github feedback html in dashboard"
```

### Task 9: Verify State Survives Restart And Logs Land In The Right Directory

**Files:**
- Modify: `server/storage.test.ts`
- Modify: `server/log-files.test.ts`
- Optional: `README` or operator notes if needed

**Step 1: Write the failing test**

```ts
test("reopening the same CODEFACTORY_HOME preserves prs, feedback, config, and logs", async () => {
  // seed storage instance A
  // reopen storage instance B
  // assert all persisted state survives
});
```

**Step 2: Run test to verify it fails**

Run: `node --test --import tsx server/storage.test.ts server/log-files.test.ts`
Expected: FAIL until reload coverage includes feedback and log rows

**Step 3: Write minimal implementation**

Complete any missing reload logic, then run a local manual verification:

```bash
CODEFACTORY_HOME=/tmp/codefactory-e2e npm run dev
# add a PR, wait for logs, stop the server, start it again with the same CODEFACTORY_HOME
```

Expected after restart:

- tracked PRs are still present
- watched repos are still present
- previous logs still appear in the dashboard
- matching dated log files exist under `/tmp/codefactory-e2e/log/YYYY-MM-DD/`

**Step 4: Run tests to verify they pass**

Run: `node --test --import tsx server/storage.test.ts server/log-files.test.ts server/github.test.ts server/babysitter.test.ts`
Expected: PASS

Run: `npm run check`
Expected: PASS

**Step 5: Commit**

```bash
git add server/storage.test.ts server/log-files.test.ts
git commit -m "test: verify persistent babysitter restart behavior"
```

### Task 10: Final Integration Sweep

**Files:**
- Modify: any files touched above only as needed

**Step 1: Run the full targeted verification set**

```bash
node --test --import tsx server/paths.test.ts \
  server/storage.test.ts \
  server/log-files.test.ts \
  server/markdown.test.ts \
  server/github.test.ts \
  server/babysitter.test.ts \
  server/routes.test.ts
npm run check
```

**Step 2: Run a manual babysitter smoke test**

```bash
CODEFACTORY_HOME=/tmp/codefactory-smoke npm run dev
```

Manual checklist:

- add a PR URL
- confirm it appears after refresh/restart
- confirm verbose logs stream during a background run
- confirm dated log files appear
- confirm feedback renders as formatted HTML
- confirm there are no `Fetch`, `Triage`, `Remove`, or Perplexity footer UI elements

**Step 3: Commit final cleanup**

```bash
git add .
git commit -m "feat: ship autonomous persistent pr babysitter"
```
