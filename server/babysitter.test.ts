import { mkdtemp, mkdir } from "fs/promises";
import os from "os";
import path from "path";
import test from "node:test";
import assert from "node:assert/strict";
import type { FeedbackItem } from "@shared/schema";
import { PRBabysitter } from "./babysitter";
import { MemStorage } from "./memoryStorage";

function makeFeedbackItem(overrides: Partial<FeedbackItem> = {}): FeedbackItem {
  return {
    id: "gh-review-comment-1",
    author: "reviewer",
    body: "Please rename this variable.",
    bodyHtml: "<p>Please rename this variable.</p>",
    replyKind: "review_thread",
    sourceId: "1",
    sourceNodeId: "PRRC_kwDO_example",
    sourceUrl: "https://github.com/octo/example/pull/42#discussion_r1",
    threadId: "PRRT_kwDO_example",
    threadResolved: false,
    auditToken: "codefactory-feedback:gh-review-comment-1",
    file: "src/example.ts",
    line: 12,
    type: "review_comment",
    createdAt: "2026-03-15T10:00:00.000Z",
    decision: null,
    decisionReason: null,
    action: null,
    status: "pending",
    statusReason: null,
    ...overrides,
  };
}

function makePullSummary(pr: { url: string }) {
  return {
    number: 106,
    title: "Verbose PR",
    branch: "feature/verbose",
    author: "octocat",
    url: pr.url,
    repoFullName: "alex-morgan-o/lolodex",
    repoCloneUrl: "https://github.com/alex-morgan-o/lolodex.git",
    headSha: "abc123",
    headRef: "feature/verbose",
    headRepoFullName: "alex-morgan-o/lolodex",
    headRepoCloneUrl: "https://github.com/alex-morgan-o/lolodex.git",
  };
}

function makeGitRunCommand(params?: {
  localHeadSha?: string;
  remoteHeadSha?: string;
}) {
  const localHeadSha = params?.localHeadSha || "def456";
  const remoteHeadSha = params?.remoteHeadSha || localHeadSha;
  let cloned = false;

  return async (command: string, args: string[]) => {
    if (command !== "git") {
      return { code: 1, stdout: "", stderr: `unexpected command: ${command}` };
    }

    if (args[0] === "-C" && args[2] === "rev-parse" && args[3] === "--is-inside-work-tree") {
      return cloned ? { code: 0, stdout: "true\n", stderr: "" } : { code: 1, stdout: "", stderr: "" };
    }

    if (args[0] === "clone") {
      cloned = true;
      await mkdir(args[2], { recursive: true });
      return { code: 0, stdout: "cloned\n", stderr: "" };
    }

    if (args[0] === "-C" && args[2] === "config" && args[3] === "--get" && args[4] === "remote.origin.url") {
      return { code: 0, stdout: "https://github.com/alex-morgan-o/lolodex.git\n", stderr: "" };
    }

    if (args[0] === "-C" && args[2] === "status") {
      return { code: 0, stdout: "", stderr: "" };
    }

    if (args[0] === "-C" && args[2] === "fetch") {
      return { code: 0, stdout: "fetched\n", stderr: "" };
    }

    if (args[0] === "-C" && args[2] === "worktree" && args[3] === "add") {
      await mkdir(args[5], { recursive: true });
      return { code: 0, stdout: "worktree added\n", stderr: "" };
    }

    if (args[0] === "config" && args[1] === "--get") {
      return { code: 1, stdout: "", stderr: "" };
    }

    if (args[0] === "config") {
      return { code: 0, stdout: "", stderr: "" };
    }

    if (args[0] === "status") {
      return { code: 0, stdout: "", stderr: "" };
    }

    if (args[0] === "rev-parse" && args[1] === "HEAD") {
      return { code: 0, stdout: `${localHeadSha}\n`, stderr: "" };
    }

    if (args[0] === "-C" && args[2] === "rev-parse" && args[3] === "FETCH_HEAD") {
      return { code: 0, stdout: `${remoteHeadSha}\n`, stderr: "" };
    }

    if (args[0] === "-C" && args[2] === "worktree" && args[3] === "remove") {
      return { code: 0, stdout: "worktree removed\n", stderr: "" };
    }

    return { code: 0, stdout: "", stderr: "" };
  };
}

test("syncFeedbackForPR logs completion even when no new feedback items arrive", async () => {
  const storage = new MemStorage();
  const existingItem = makeFeedbackItem();

  const pr = await storage.addPR({
    number: 42,
    title: "Example PR",
    repo: "octo/example",
    branch: "feature/example",
    author: "octocat",
    url: "https://github.com/octo/example/pull/42",
    status: "watching",
    feedbackItems: [existingItem],
    accepted: 0,
    rejected: 0,
    flagged: 0,
    testsPassed: null,
    lintPassed: null,
    lastChecked: null,
  });

  const babysitter = new PRBabysitter(storage, {
    buildOctokit: async () => ({}) as never,
    fetchFeedbackItemsForPR: async () => [existingItem],
    fetchPullSummary: async () => {
      throw new Error("unused in this test");
    },
    listFailingStatuses: async () => {
      throw new Error("unused in this test");
    },
    listOpenPullsForRepo: async () => {
      throw new Error("unused in this test");
    },
    resolveGitHubAuthToken: async () => undefined,
  });

  const updated = await babysitter.syncFeedbackForPR(pr.id);
  const logs = await storage.getLogs(pr.id);

  assert.equal(updated.status, "watching");
  assert.equal(logs.at(-1)?.message, "GitHub sync complete: 1 feedback item (0 new)");
});

test("babysitPR uses a CODEFACTORY_HOME worktree, passes GitHub context, and verifies audit trail", async () => {
  const storage = new MemStorage();
  const existingItem = makeFeedbackItem();
  const pr = await storage.addPR({
    number: 106,
    title: "Verbose PR",
    repo: "alex-morgan-o/lolodex",
    branch: "feature/verbose",
    author: "octocat",
    url: "https://github.com/alex-morgan-o/lolodex/pull/106",
    status: "watching",
    feedbackItems: [existingItem],
    accepted: 0,
    rejected: 0,
    flagged: 0,
    testsPassed: null,
    lintPassed: null,
    lastChecked: null,
  });

  const worktreeRoot = await mkdtemp(path.join(os.tmpdir(), "codefactory-home-"));
  process.env.CODEFACTORY_HOME = worktreeRoot;
  let receivedPrompt = "";
  let receivedEnv: NodeJS.ProcessEnv | undefined;
  let feedbackFetchCount = 0;
  const pullSummary = makePullSummary(pr);
  const followUp = makeFeedbackItem({
    id: "gh-review-comment-2",
    author: "code-factory",
    body: `Implemented the requested rename.\n\n${existingItem.auditToken}`,
    bodyHtml: `<p>Implemented the requested rename.</p><p>${existingItem.auditToken}</p>`,
    sourceId: "2",
    sourceNodeId: "PRRC_kwDO_followup",
    sourceUrl: "https://github.com/alex-morgan-o/lolodex/pull/106#discussion_r2",
    threadId: existingItem.threadId,
    threadResolved: true,
    createdAt: new Date().toISOString(),
    decision: null,
    decisionReason: null,
    action: null,
  });

  const babysitter = new PRBabysitter(
    storage,
    {
      buildOctokit: async () => ({}) as never,
      fetchFeedbackItemsForPR: async () => {
        feedbackFetchCount += 1;
        if (feedbackFetchCount === 1) {
          return [existingItem];
        }

        return [
          { ...existingItem, threadResolved: true },
          followUp,
        ];
      },
      fetchPullSummary: async () => pullSummary,
      listFailingStatuses: async () => [],
      listOpenPullsForRepo: async () => [],
      resolveGitHubAuthToken: async () => "test-token",
    },
    {
      resolveAgent: async () => "codex",
      evaluateFixNecessityWithAgent: async () => ({
        needsFix: true,
        reason: "Comment requires a code change",
      }),
      applyFixesWithAgent: async ({ prompt, env, onStdoutChunk, onStderrChunk }) => {
        receivedPrompt = prompt;
        receivedEnv = env;
        onStdoutChunk?.("agent stdout line\n");
        onStderrChunk?.("agent stderr line\n");
        return {
          code: 0,
          stdout: "agent stdout line\n",
          stderr: "agent stderr line\n",
        };
      },
      runCommand: makeGitRunCommand({
        localHeadSha: "def456",
        remoteHeadSha: "def456",
      }),
    },
  );

  await babysitter.babysitPR(pr.id, "codex");

  const updated = await storage.getPR(pr.id);
  const logs = await storage.getLogs(pr.id);

  assert.equal(updated?.status, "watching");
  assert.equal(updated?.accepted, 1);
  assert.ok(logs.some((log) => log.phase === "worktree" && log.message.includes(`Preparing worktree in ${worktreeRoot}`)));
  assert.ok(logs.some((log) => log.phase === "verify.github" && log.message.includes("GitHub audit trail verified")));
  assert.ok(logs.some((log) => log.phase === "run" && log.message.includes("Babysitter run complete")));
  assert.match(receivedPrompt, /commit it and push it to origin HEAD:feature\/verbose/i);
  assert.match(receivedPrompt, /Reply with a short GitHub summary for every addressed feedback item/i);
  assert.match(receivedPrompt, /Resolve threaded review comments after replying to them/i);
  assert.match(receivedPrompt, /auditToken=codefactory-feedback:gh-review-comment-1/);
  assert.equal(receivedEnv?.GITHUB_TOKEN, "test-token");
  assert.equal(receivedEnv?.GH_TOKEN, "test-token");

  delete process.env.CODEFACTORY_HOME;
});

test("babysitPR marks the run as error when the agent does not leave the required audit trail", async () => {
  const storage = new MemStorage();
  const existingItem = makeFeedbackItem();
  const pr = await storage.addPR({
    number: 106,
    title: "Verbose PR",
    repo: "alex-morgan-o/lolodex",
    branch: "feature/verbose",
    author: "octocat",
    url: "https://github.com/alex-morgan-o/lolodex/pull/106",
    status: "watching",
    feedbackItems: [existingItem],
    accepted: 0,
    rejected: 0,
    flagged: 0,
    testsPassed: null,
    lintPassed: null,
    lastChecked: null,
  });

  const worktreeRoot = await mkdtemp(path.join(os.tmpdir(), "codefactory-home-"));
  process.env.CODEFACTORY_HOME = worktreeRoot;
  let feedbackFetchCount = 0;
  const pullSummary = makePullSummary(pr);

  const babysitter = new PRBabysitter(
    storage,
    {
      buildOctokit: async () => ({}) as never,
      fetchFeedbackItemsForPR: async () => {
        feedbackFetchCount += 1;
        if (feedbackFetchCount === 1) {
          return [existingItem];
        }

        return [existingItem];
      },
      fetchPullSummary: async () => pullSummary,
      listFailingStatuses: async () => [],
      listOpenPullsForRepo: async () => [],
      resolveGitHubAuthToken: async () => "test-token",
    },
    {
      resolveAgent: async () => "codex",
      evaluateFixNecessityWithAgent: async () => ({
        needsFix: true,
        reason: "Comment requires a code change",
      }),
      applyFixesWithAgent: async ({ onStdoutChunk, onStderrChunk }) => {
        onStdoutChunk?.("agent stdout line\n");
        onStderrChunk?.("agent stderr line\n");
        return {
          code: 0,
          stdout: "agent stdout line\n",
          stderr: "agent stderr line\n",
        };
      },
      runCommand: makeGitRunCommand({
        localHeadSha: "def456",
        remoteHeadSha: "def456",
      }),
    },
  );

  await babysitter.babysitPR(pr.id, "codex");

  const updated = await storage.getPR(pr.id);
  const logs = await storage.getLogs(pr.id);

  assert.equal(updated?.status, "error");
  assert.ok(logs.some((log) => log.phase === "run" && log.message.includes("GitHub audit trail verification failed")));
  assert.ok(logs.some((log) => log.phase === "cleanup" && log.message.includes("Worktree cleanup complete")));

  delete process.env.CODEFACTORY_HOME;
});

test("babysitPR marks accepted pending items as resolved after a successful run", async () => {
  const storage = new MemStorage();
  const existingItem = makeFeedbackItem({ status: "pending", decision: null });
  const pr = await storage.addPR({
    number: 106,
    title: "Verbose PR",
    repo: "alex-morgan-o/lolodex",
    branch: "feature/verbose",
    author: "octocat",
    url: "https://github.com/alex-morgan-o/lolodex/pull/106",
    status: "watching",
    feedbackItems: [existingItem],
    accepted: 0,
    rejected: 0,
    flagged: 0,
    testsPassed: null,
    lintPassed: null,
    lastChecked: null,
  });

  const worktreeRoot = await mkdtemp(path.join(os.tmpdir(), "codefactory-home-"));
  process.env.CODEFACTORY_HOME = worktreeRoot;
  let feedbackFetchCount = 0;
  const pullSummary = makePullSummary(pr);
  const followUp = makeFeedbackItem({
    id: "gh-review-comment-2",
    author: "code-factory",
    body: `Implemented the fix.\n\n${existingItem.auditToken}`,
    bodyHtml: `<p>Implemented the fix.</p><p>${existingItem.auditToken}</p>`,
    sourceId: "2",
    sourceNodeId: "PRRC_kwDO_followup",
    sourceUrl: "https://github.com/alex-morgan-o/lolodex/pull/106#discussion_r2",
    threadId: existingItem.threadId,
    threadResolved: true,
    createdAt: new Date().toISOString(),
    decision: null,
    decisionReason: null,
    action: null,
    status: "pending",
    statusReason: null,
  });

  const babysitter = new PRBabysitter(
    storage,
    {
      buildOctokit: async () => ({}) as never,
      fetchFeedbackItemsForPR: async () => {
        feedbackFetchCount += 1;
        if (feedbackFetchCount === 1) return [existingItem];
        return [{ ...existingItem, threadResolved: true }, followUp];
      },
      fetchPullSummary: async () => pullSummary,
      listFailingStatuses: async () => [],
      listOpenPullsForRepo: async () => [],
      resolveGitHubAuthToken: async () => "test-token",
    },
    {
      resolveAgent: async () => "codex",
      evaluateFixNecessityWithAgent: async () => ({ needsFix: true, reason: "Code change needed" }),
      applyFixesWithAgent: async () => ({ code: 0, stdout: "", stderr: "" }),
      runCommand: makeGitRunCommand({ localHeadSha: "def456", remoteHeadSha: "def456" }),
    },
  );

  await babysitter.babysitPR(pr.id, "codex");

  const updated = await storage.getPR(pr.id);
  const resolvedItem = updated?.feedbackItems.find((i) => i.id === existingItem.id);
  assert.equal(resolvedItem?.status, "resolved");

  delete process.env.CODEFACTORY_HOME;
});

test("babysitPR marks claimed items as failed when audit trail verification fails", async () => {
  const storage = new MemStorage();
  const existingItem = makeFeedbackItem({ status: "pending", decision: null });
  const pr = await storage.addPR({
    number: 106,
    title: "Verbose PR",
    repo: "alex-morgan-o/lolodex",
    branch: "feature/verbose",
    author: "octocat",
    url: "https://github.com/alex-morgan-o/lolodex/pull/106",
    status: "watching",
    feedbackItems: [existingItem],
    accepted: 0,
    rejected: 0,
    flagged: 0,
    testsPassed: null,
    lintPassed: null,
    lastChecked: null,
  });

  const worktreeRoot = await mkdtemp(path.join(os.tmpdir(), "codefactory-home-"));
  process.env.CODEFACTORY_HOME = worktreeRoot;
  let feedbackFetchCount = 0;
  const pullSummary = makePullSummary(pr);

  const babysitter = new PRBabysitter(
    storage,
    {
      buildOctokit: async () => ({}) as never,
      fetchFeedbackItemsForPR: async () => {
        feedbackFetchCount += 1;
        // Always return existing item without audit trail follow-up
        return [existingItem];
      },
      fetchPullSummary: async () => pullSummary,
      listFailingStatuses: async () => [],
      listOpenPullsForRepo: async () => [],
      resolveGitHubAuthToken: async () => "test-token",
    },
    {
      resolveAgent: async () => "codex",
      evaluateFixNecessityWithAgent: async () => ({ needsFix: true, reason: "Code change needed" }),
      applyFixesWithAgent: async () => ({ code: 0, stdout: "", stderr: "" }),
      runCommand: makeGitRunCommand({ localHeadSha: "def456", remoteHeadSha: "def456" }),
    },
  );

  await babysitter.babysitPR(pr.id, "codex");

  const updated = await storage.getPR(pr.id);
  const failedItem = updated?.feedbackItems.find((i) => i.id === existingItem.id);
  assert.equal(failedItem?.status, "failed");
  assert.ok(failedItem?.statusReason?.includes("audit trail"));

  delete process.env.CODEFACTORY_HOME;
});

test("babysitPR picks up manually-queued items and resolves them without re-evaluating", async () => {
  const storage = new MemStorage();
  const queuedItem = makeFeedbackItem({
    status: "queued",
    decision: "accept",
    decisionReason: "Manual override",
  });
  const pr = await storage.addPR({
    number: 106,
    title: "Verbose PR",
    repo: "alex-morgan-o/lolodex",
    branch: "feature/verbose",
    author: "octocat",
    url: "https://github.com/alex-morgan-o/lolodex/pull/106",
    status: "watching",
    feedbackItems: [queuedItem],
    accepted: 1,
    rejected: 0,
    flagged: 0,
    testsPassed: null,
    lintPassed: null,
    lastChecked: null,
  });

  const worktreeRoot = await mkdtemp(path.join(os.tmpdir(), "codefactory-home-"));
  process.env.CODEFACTORY_HOME = worktreeRoot;
  let feedbackFetchCount = 0;
  const pullSummary = makePullSummary(pr);
  let evaluateCallCount = 0;
  const followUp = makeFeedbackItem({
    id: "gh-review-comment-2",
    author: "code-factory",
    body: `Fix applied.\n\n${queuedItem.auditToken}`,
    bodyHtml: `<p>Fix applied.</p><p>${queuedItem.auditToken}</p>`,
    sourceId: "2",
    sourceNodeId: "PRRC_kwDO_followup",
    sourceUrl: "https://github.com/alex-morgan-o/lolodex/pull/106#discussion_r2",
    threadId: queuedItem.threadId,
    threadResolved: true,
    createdAt: new Date().toISOString(),
    decision: null,
    decisionReason: null,
    action: null,
    status: "pending",
    statusReason: null,
  });

  const babysitter = new PRBabysitter(
    storage,
    {
      buildOctokit: async () => ({}) as never,
      fetchFeedbackItemsForPR: async () => {
        feedbackFetchCount += 1;
        if (feedbackFetchCount === 1) return [queuedItem];
        return [{ ...queuedItem, threadResolved: true }, followUp];
      },
      fetchPullSummary: async () => pullSummary,
      listFailingStatuses: async () => [],
      listOpenPullsForRepo: async () => [],
      resolveGitHubAuthToken: async () => "test-token",
    },
    {
      resolveAgent: async () => "codex",
      evaluateFixNecessityWithAgent: async () => {
        evaluateCallCount += 1;
        return { needsFix: true, reason: "Should not be called" };
      },
      applyFixesWithAgent: async () => ({ code: 0, stdout: "", stderr: "" }),
      runCommand: makeGitRunCommand({ localHeadSha: "def456", remoteHeadSha: "def456" }),
    },
  );

  await babysitter.babysitPR(pr.id, "codex");

  const updated = await storage.getPR(pr.id);
  const resolvedItem = updated?.feedbackItems.find((i) => i.id === queuedItem.id);
  assert.equal(evaluateCallCount, 0, "evaluateFixNecessityWithAgent should not be called for already-queued items");
  assert.equal(resolvedItem?.status, "resolved");

  delete process.env.CODEFACTORY_HOME;
});

test("babysitPR does not pull rejected or resolved items into in_progress", async () => {
  const storage = new MemStorage();
  const rejectedItem = makeFeedbackItem({
    id: "gh-review-comment-rejected",
    status: "rejected",
    decision: "reject",
    decisionReason: "Not actionable",
  });
  const resolvedItem = makeFeedbackItem({
    id: "gh-review-comment-resolved",
    status: "resolved",
    decision: "accept",
  });
  const pendingItem = makeFeedbackItem({
    id: "gh-review-comment-pending",
    status: "pending",
    decision: null,
  });
  const pr = await storage.addPR({
    number: 106,
    title: "Verbose PR",
    repo: "alex-morgan-o/lolodex",
    branch: "feature/verbose",
    author: "octocat",
    url: "https://github.com/alex-morgan-o/lolodex/pull/106",
    status: "watching",
    feedbackItems: [rejectedItem, resolvedItem, pendingItem],
    accepted: 1,
    rejected: 1,
    flagged: 0,
    testsPassed: null,
    lintPassed: null,
    lastChecked: null,
  });

  const worktreeRoot = await mkdtemp(path.join(os.tmpdir(), "codefactory-home-"));
  process.env.CODEFACTORY_HOME = worktreeRoot;
  let feedbackFetchCount = 0;
  const pullSummary = makePullSummary(pr);
  const followUp = makeFeedbackItem({
    id: "gh-review-comment-followup",
    author: "code-factory",
    body: `Fix applied.\n\n${pendingItem.auditToken}`,
    bodyHtml: `<p>Fix applied.</p><p>${pendingItem.auditToken}</p>`,
    sourceId: "99",
    sourceNodeId: "PRRC_kwDO_followup99",
    sourceUrl: "https://github.com/alex-morgan-o/lolodex/pull/106#discussion_r99",
    threadId: pendingItem.threadId,
    threadResolved: true,
    createdAt: new Date().toISOString(),
    decision: null,
    decisionReason: null,
    action: null,
    status: "pending",
    statusReason: null,
  });

  const babysitter = new PRBabysitter(
    storage,
    {
      buildOctokit: async () => ({}) as never,
      fetchFeedbackItemsForPR: async () => {
        feedbackFetchCount += 1;
        if (feedbackFetchCount === 1) return [rejectedItem, resolvedItem, pendingItem];
        return [rejectedItem, resolvedItem, { ...pendingItem, threadResolved: true }, followUp];
      },
      fetchPullSummary: async () => pullSummary,
      listFailingStatuses: async () => [],
      listOpenPullsForRepo: async () => [],
      resolveGitHubAuthToken: async () => "test-token",
    },
    {
      resolveAgent: async () => "codex",
      evaluateFixNecessityWithAgent: async (_params) => ({ needsFix: true, reason: "Code change needed" }),
      applyFixesWithAgent: async () => ({ code: 0, stdout: "", stderr: "" }),
      runCommand: makeGitRunCommand({ localHeadSha: "def456", remoteHeadSha: "def456" }),
    },
  );

  await babysitter.babysitPR(pr.id, "codex");

  const updated = await storage.getPR(pr.id);
  const updatedRejected = updated?.feedbackItems.find((i) => i.id === rejectedItem.id);
  const updatedResolved = updated?.feedbackItems.find((i) => i.id === resolvedItem.id);
  assert.equal(updatedRejected?.status, "rejected", "rejected item should keep its status");
  assert.equal(updatedResolved?.status, "resolved", "resolved item should keep its status");

  delete process.env.CODEFACTORY_HOME;
});

test("babysitPR skips run when no items are pending or queued", async () => {
  const storage = new MemStorage();
  const rejectedItem = makeFeedbackItem({ status: "rejected", decision: "reject" });
  const pr = await storage.addPR({
    number: 106,
    title: "Verbose PR",
    repo: "alex-morgan-o/lolodex",
    branch: "feature/verbose",
    author: "octocat",
    url: "https://github.com/alex-morgan-o/lolodex/pull/106",
    status: "watching",
    feedbackItems: [rejectedItem],
    accepted: 0,
    rejected: 1,
    flagged: 0,
    testsPassed: null,
    lintPassed: null,
    lastChecked: null,
  });

  let evaluateCallCount = 0;

  const babysitter = new PRBabysitter(
    storage,
    {
      buildOctokit: async () => ({}) as never,
      fetchFeedbackItemsForPR: async () => [rejectedItem],
      fetchPullSummary: async () => makePullSummary(pr),
      listFailingStatuses: async () => [],
      listOpenPullsForRepo: async () => [],
      resolveGitHubAuthToken: async () => undefined,
    },
    {
      resolveAgent: async () => "codex",
      evaluateFixNecessityWithAgent: async () => {
        evaluateCallCount += 1;
        return { needsFix: true, reason: "Should not be called" };
      },
      applyFixesWithAgent: async () => ({ code: 0, stdout: "", stderr: "" }),
      runCommand: makeGitRunCommand(),
    },
  );

  await babysitter.babysitPR(pr.id, "codex");

  const updated = await storage.getPR(pr.id);
  assert.equal(evaluateCallCount, 0, "evaluateFixNecessityWithAgent should not be called when no pending items");
  assert.equal(updated?.status, "watching");

  delete process.env.CODEFACTORY_HOME;
});
