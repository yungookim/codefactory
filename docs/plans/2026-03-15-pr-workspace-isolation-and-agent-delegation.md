# PR Workspace Isolation And Agent Delegation Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Run PR babysitter work from app-owned clones and worktrees under `~/.codefactory`, and delegate code changes, commit/push, and GitHub audit-trail actions to the coding agent.

**Architecture:** Extend the existing `CODEFACTORY_HOME` path model with repo-cache and worktree roots, introduce a dedicated repo-workspace helper for clone/fetch/heal/worktree lifecycle, enrich stored feedback with the GitHub metadata the agent needs for replies and thread resolution, and refactor the babysitter so the app only orchestrates and verifies outcomes. Verification should re-sync GitHub state and fail runs that do not leave the expected audit trail.

**Tech Stack:** Node.js, TypeScript, existing SQLite storage, git CLI, existing agent CLIs (`codex` and `claude`), GitHub REST/GraphQL via Octokit, Node test runner via `node --test --import tsx`

---

### Task 1: Extend `CODEFACTORY_HOME` Paths For Repo Caches And Worktrees

**Files:**
- Modify: `server/paths.ts`
- Test: `server/paths.test.ts`

**Step 1: Write the failing test**

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { getCodeFactoryPaths } from "./paths";

test("getCodeFactoryPaths exposes repo and worktree roots under CODEFACTORY_HOME", () => {
  const paths = getCodeFactoryPaths("/tmp/codefactory-home");
  assert.equal(paths.repoRootDir, "/tmp/codefactory-home/repos");
  assert.equal(paths.worktreeRootDir, "/tmp/codefactory-home/worktrees");
});
```

**Step 2: Run test to verify it fails**

Run: `node --test --import tsx server/paths.test.ts`
Expected: FAIL because `repoRootDir` and `worktreeRootDir` do not exist on the return type.

**Step 3: Write minimal implementation**

```ts
export type CodeFactoryPaths = {
  rootDir: string;
  stateDbPath: string;
  logRootDir: string;
  repoRootDir: string;
  worktreeRootDir: string;
};

export function getCodeFactoryPaths(rootDirOverride?: string): CodeFactoryPaths {
  const rootDir = rootDirOverride || process.env.CODEFACTORY_HOME || path.join(os.homedir(), ".codefactory");

  return {
    rootDir,
    stateDbPath: path.join(rootDir, "state.sqlite"),
    logRootDir: path.join(rootDir, "log"),
    repoRootDir: path.join(rootDir, "repos"),
    worktreeRootDir: path.join(rootDir, "worktrees"),
  };
}
```

**Step 4: Run test to verify it passes**

Run: `node --test --import tsx server/paths.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add server/paths.ts server/paths.test.ts
git commit -m "feat: add codefactory repo and worktree roots"
```

### Task 2: Add A Dedicated Repo Workspace Helper

**Files:**
- Create: `server/repoWorkspace.ts`
- Test: `server/repoWorkspace.test.ts`
- Modify: `server/paths.ts`

**Step 1: Write the failing tests**

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { preparePrWorktree } from "./repoWorkspace";

test("preparePrWorktree reuses the watched-repo cache and fetches fork heads on demand", async () => {
  const calls: Array<{ command: string; args: string[] }> = [];

  const result = await preparePrWorktree({
    rootDir: "/tmp/codefactory-home",
    repoFullName: "acme/widgets",
    repoCloneUrl: "https://github.com/acme/widgets.git",
    headRepoFullName: "contrib/widgets",
    headRepoCloneUrl: "https://github.com/contrib/widgets.git",
    headRef: "fix-branch",
    prNumber: 42,
    runId: "run-1",
    runCommand: async (command, args) => {
      calls.push({ command, args });
      return { code: 0, stdout: "", stderr: "" };
    },
  });

  assert.match(result.repoCacheDir, /\/repos\/acme__widgets$/);
  assert.match(result.worktreePath, /\/worktrees\/acme__widgets\/pr-42-run-1$/);
  assert.ok(calls.some((call) => call.args.includes("remote") && call.args.includes("fork-contrib")));
});
```

Add a second test for auto-heal:

```ts
test("preparePrWorktree reclones the cache when git health checks fail", async () => {
  // first rev-parse fails, then clone succeeds, then fetch/worktree succeeds
});
```

**Step 2: Run test to verify it fails**

Run: `node --test --import tsx server/repoWorkspace.test.ts`
Expected: FAIL with `Cannot find module './repoWorkspace'`

**Step 3: Write minimal implementation**

Implement `server/repoWorkspace.ts` with these concrete helpers:

- `sanitizeRepoName(repoFullName: string): string`
- `ensureRepoCache(params): Promise<{ repoCacheDir: string; healed: boolean }>`
- `preparePrWorktree(params): Promise<{ repoCacheDir: string; worktreePath: string; healed: boolean }>`
- `removePrWorktree(params): Promise<void>`

Implementation details:

- store caches under `getCodeFactoryPaths(rootDir).repoRootDir`
- store worktrees under `getCodeFactoryPaths(rootDir).worktreeRootDir/<repo>/`
- require `origin` to match the watched repo clone URL
- use dynamic fork remotes like `fork-<owner>` only when `headRepoFullName !== repoFullName`
- delete and reclone the cache if `rev-parse`, remote inspection, status checks, or fetches fail
- retry worktree creation once after a heal

**Step 4: Run test to verify it passes**

Run: `node --test --import tsx server/repoWorkspace.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add server/repoWorkspace.ts server/repoWorkspace.test.ts server/paths.ts
git commit -m "feat: add isolated repo workspace manager"
```

### Task 3: Enrich Feedback Metadata And Persist It

**Files:**
- Modify: `shared/schema.ts`
- Modify: `server/github.ts`
- Modify: `server/sqliteStorage.ts`
- Test: `server/github.test.ts`
- Test: `server/storage.test.ts`

**Step 1: Write the failing tests**

Add a GitHub normalization test:

```ts
test("fetchFeedbackItemsForPR includes reply metadata and audit tokens", async () => {
  const items = await fetchFeedbackItemsForPR(octokit as never, parsed, config);

  const reviewComment = items.find((item) => item.id === "gh-review-comment-1");
  assert.equal(reviewComment?.replyKind, "review_thread");
  assert.equal(reviewComment?.threadId, "THREAD_node_123");
  assert.equal(reviewComment?.threadResolved, false);
  assert.equal(reviewComment?.auditToken, "codefactory-feedback:gh-review-comment-1");
});
```

Add a storage round-trip test:

```ts
test("SqliteStorage persists feedback reply metadata", async () => {
  // add a PR with one feedback item containing replyKind/threadId/auditToken
  // reload storage and assert those fields survive
});
```

**Step 2: Run test to verify it fails**

Run: `node --test --import tsx server/github.test.ts server/storage.test.ts`
Expected: FAIL because `FeedbackItem` does not yet include reply metadata and SQLite does not persist it.

**Step 3: Write minimal implementation**

Extend `FeedbackItem` with these fields:

```ts
replyKind: z.enum(["review_thread", "review", "general_comment"]);
sourceId: z.string();
sourceNodeId: z.string().nullable();
sourceUrl: z.string().nullable();
threadId: z.string().nullable();
threadResolved: z.boolean().nullable();
auditToken: z.string();
```

Then:

- update `server/github.ts` to populate those fields from REST responses and a focused GraphQL thread lookup for review comments,
- generate `auditToken` as `codefactory-feedback:${item.id}`,
- add SQLite columns and row parsing/writing in `server/sqliteStorage.ts`.

**Step 4: Run test to verify it passes**

Run: `node --test --import tsx server/github.test.ts server/storage.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add shared/schema.ts server/github.ts server/github.test.ts server/sqliteStorage.ts server/storage.test.ts
git commit -m "feat: persist github reply metadata for feedback items"
```

### Task 4: Pass GitHub Context To The Agent And Rewrite The Agent Contract

**Files:**
- Modify: `server/agentRunner.ts`
- Modify: `server/github.ts`
- Modify: `server/babysitter.ts`
- Test: `server/babysitter.test.ts`

**Step 1: Write the failing test**

```ts
test("babysitPR instructs the agent to commit, push, reply, and resolve comments", async () => {
  let receivedPrompt = "";
  let receivedEnv: NodeJS.ProcessEnv | undefined;

  const runtime = {
    // other runtime fakes
    applyFixesWithAgent: async ({ prompt, env }) => {
      receivedPrompt = prompt;
      receivedEnv = env;
      return { code: 0, stdout: "done", stderr: "" };
    },
  };

  await babysitter.babysitPR(pr.id, "codex");

  assert.match(receivedPrompt, /Commit and push the changes to the PR head branch/);
  assert.match(receivedPrompt, /Reply with a short summary for every addressed feedback item/);
  assert.match(receivedPrompt, /Resolve threaded review comments after replying/);
  assert.equal(receivedEnv?.GITHUB_TOKEN, "test-token");
});
```

**Step 2: Run test to verify it fails**

Run: `node --test --import tsx server/babysitter.test.ts`
Expected: FAIL because the runtime does not pass env through and the prompt still says the outer babysitter will commit and push.

**Step 3: Write minimal implementation**

Make these concrete changes:

- update `applyFixesWithAgent()` in `server/agentRunner.ts` to accept an optional `env` field and forward it to `runCommand()`,
- export a helper from `server/github.ts` that resolves the GitHub auth token for agent use,
- rewrite the babysitter prompt so the agent is explicitly responsible for:
  - code changes,
  - verification,
  - commit and push,
  - summary replies/comments with the `auditToken`,
  - thread resolution after replying,
- include source URLs, source IDs, thread IDs, and audit tokens in the prompt payload.

**Step 4: Run test to verify it passes**

Run: `node --test --import tsx server/babysitter.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add server/agentRunner.ts server/github.ts server/babysitter.ts server/babysitter.test.ts
git commit -m "feat: delegate pr remediation and github follow-up to agent"
```

### Task 5: Refactor Babysitter Orchestration Around Repo Workspaces And Outcome Verification

**Files:**
- Modify: `server/babysitter.ts`
- Modify: `server/babysitter.test.ts`
- Modify: `server/github.ts`
- Modify: `server/paths.ts`

**Step 1: Write the failing tests**

Add one success-path test:

```ts
test("babysitPR uses a CODEFACTORY_HOME worktree and returns to watching after verified follow-up", async () => {
  process.env.CODEFACTORY_HOME = "/tmp/codefactory-home";
  // fake repoWorkspace and GitHub sync so the PR head advances and audit tokens appear after the run
  await babysitter.babysitPR(pr.id, "codex");
  assert.equal((await storage.getPR(pr.id))?.status, "watching");
});
```

Add one failure-path test:

```ts
test("babysitPR marks the run as error when the agent pushes code but does not leave the required audit trail", async () => {
  await babysitter.babysitPR(pr.id, "codex");
  assert.equal((await storage.getPR(pr.id))?.status, "error");
  assert.ok((await storage.getLogs(pr.id)).some((log) => log.message.includes("audit trail")));
});
```

**Step 2: Run test to verify it fails**

Run: `node --test --import tsx server/babysitter.test.ts`
Expected: FAIL because the babysitter still uses `/tmp/pr-babysitter`, still commits/pushes itself, and does not verify GitHub follow-up.

**Step 3: Write minimal implementation**

Refactor `server/babysitter.ts` to:

- replace the inline `/tmp/pr-babysitter` worktree logic with `preparePrWorktree()` and `removePrWorktree()` from `server/repoWorkspace.ts`,
- use `getCodeFactoryPaths()` so work always runs under `~/.codefactory` by default,
- stop running app-owned `git add`, `git commit`, and `git push`,
- re-sync PR metadata and feedback after the agent exits,
- verify branch movement and required audit tokens,
- verify `threadResolved === true` for addressed threaded review comments,
- keep verbose logs for clone heal, worktree prep, agent run, verification, and cleanup.

**Step 4: Run test to verify it passes**

Run: `node --test --import tsx server/babysitter.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add server/babysitter.ts server/babysitter.test.ts server/github.ts server/paths.ts
git commit -m "feat: orchestrate agent-driven pr runs in isolated worktrees"
```

### Task 6: Run The Focused Test Suite And Smoke-Test The End-To-End Flow

**Files:**
- Modify: `server/repoWorkspace.test.ts`
- Modify: `server/github.test.ts`
- Modify: `server/babysitter.test.ts`

**Step 1: Run the focused automated suite**

Run:

```bash
node --test --import tsx \
  server/paths.test.ts \
  server/repoWorkspace.test.ts \
  server/github.test.ts \
  server/storage.test.ts \
  server/babysitter.test.ts
```

Expected: PASS

**Step 2: Smoke-test a local run**

Run:

```bash
CODEFACTORY_HOME=/tmp/codefactory-smoke npm run dev
```

Then:

- add a PR from the dashboard or API,
- confirm a base clone appears under `/tmp/codefactory-smoke/repos/`,
- confirm a per-run worktree appears under `/tmp/codefactory-smoke/worktrees/` and is removed afterward,
- confirm the run logs mention clone reuse or auto-heal,
- confirm the PR returns to `watching` only after GitHub audit-trail verification succeeds.

**Step 3: Commit**

```bash
git add server/repoWorkspace.test.ts server/github.test.ts server/babysitter.test.ts
git commit -m "test: cover isolated pr workspace orchestration"
```
