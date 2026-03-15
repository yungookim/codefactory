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
    file: "src/example.ts",
    line: 12,
    type: "review_comment",
    createdAt: "2026-03-15T10:00:00.000Z",
    decision: null,
    decisionReason: null,
    action: null,
    ...overrides,
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
  });

  const updated = await babysitter.syncFeedbackForPR(pr.id);
  const logs = await storage.getLogs(pr.id);

  assert.equal(updated.status, "watching");
  assert.equal(logs.at(-1)?.message, "GitHub sync complete: 1 feedback item (0 new)");
});

test("babysitPR emits verbose run logs and returns to watching after push", async () => {
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

  const worktreeRoot = await mkdtemp(path.join(os.tmpdir(), "pr-babysitter-test-"));
  process.env.PR_BABYSITTER_ROOT = worktreeRoot;

  const babysitter = new PRBabysitter(
    storage,
    {
      buildOctokit: async () => ({}) as never,
      fetchFeedbackItemsForPR: async () => [existingItem],
      fetchPullSummary: async () => ({
        number: 106,
        title: "Verbose PR",
        branch: "feature/verbose",
        author: "octocat",
        url: pr.url,
        headSha: "abc123",
        headRef: "feature/verbose",
        headRepoFullName: "alex-morgan-o/lolodex",
        headRepoCloneUrl: "https://github.com/alex-morgan-o/lolodex.git",
      }),
      listFailingStatuses: async () => [],
      listOpenPullsForRepo: async () => [],
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
      runCommand: async (command, args) => {
        if (command !== "git") {
          return { code: 1, stdout: "", stderr: `unexpected command: ${command}` };
        }

        if (args[0] === "-C" && args[2] === "rev-parse") {
          return { code: 1, stdout: "", stderr: "" };
        }

        if (args[0] === "clone") {
          await mkdir(args[2], { recursive: true });
          return { code: 0, stdout: "cloned\n", stderr: "" };
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
          return { code: 0, stdout: " M server/example.ts\n", stderr: "" };
        }

        if (args[0] === "add" || args[0] === "commit" || args[0] === "push") {
          return { code: 0, stdout: `${args[0]} ok\n`, stderr: "" };
        }

        if (args[0] === "-C" && args[2] === "worktree" && args[3] === "remove") {
          return { code: 0, stdout: "worktree removed\n", stderr: "" };
        }

        return { code: 0, stdout: "", stderr: "" };
      },
    },
  );

  await babysitter.babysitPR(pr.id, "codex");

  const updated = await storage.getPR(pr.id);
  const logs = await storage.getLogs(pr.id);
  const runIds = new Set(logs.map((log) => log.runId).filter((runId): runId is string => Boolean(runId)));

  assert.equal(updated?.status, "watching");
  assert.equal(updated?.accepted, 1);
  assert.equal(runIds.size, 1);
  assert.ok(logs.some((log) => log.phase === "agent" && log.message.includes("[stdout] agent stdout line")));
  assert.ok(logs.some((log) => log.phase === "agent" && log.message.includes("[stderr] agent stderr line")));
  assert.ok(logs.some((log) => log.phase === "git.push" && log.message.includes("Pushed automated fixes")));
  assert.ok(logs.some((log) => log.phase === "run" && log.message.includes("Babysitter run complete")));

  delete process.env.PR_BABYSITTER_ROOT;
});
