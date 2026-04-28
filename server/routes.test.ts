import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import express from "express";
import type { Octokit } from "@octokit/rest";
import type { AppUpdateStatus, NewPR } from "@shared/schema";
import type { ReleaseAgentPullSummary, ReleaseEvaluationDecision } from "./releaseAgent";
import { ReleaseManager, type ReleaseGitHubService } from "./releaseManager";
import { MemStorage } from "./memoryStorage";
import type { RouteDependencies } from "./routes";
import { registerRoutes } from "./routes";

async function seedPR(storage: MemStorage, overrides: Partial<NewPR> = {}) {
  return storage.addPR({
    number: 42,
    title: "feat: add widget",
    repo: "acme/widgets",
    branch: "feat/widget",
    author: "alice",
    url: "https://github.com/acme/widgets/pull/42",
    status: "watching",
    feedbackItems: [],
    accepted: 0,
    rejected: 0,
    flagged: 0,
    testsPassed: null,
    lintPassed: null,
    lastChecked: null,
    ...overrides,
  });
}

async function createHarness(storage = new MemStorage(), dependencies: Partial<RouteDependencies> = {}) {
  const app = express();
  app.use(express.json());

  const server = createServer(app);
  await registerRoutes(server, app, {
    storage,
    startBackgroundServices: false,
    startWatcher: false,
    ...dependencies,
  });

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Expected an ephemeral test server address");
  }

  return {
    storage,
    baseUrl: `http://127.0.0.1:${address.port}`,
    async close(): Promise<void> {
      server.closeAllConnections?.();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }

          resolve();
        });
      });
    },
  };
}

function makeMergedSummary(overrides: Partial<ReleaseAgentPullSummary> = {}): ReleaseAgentPullSummary {
  return {
    number: 42,
    title: "Manual release",
    url: "https://github.com/acme/widgets/pull/42",
    author: "alice",
    repo: "acme/widgets",
    mergedAt: "2026-04-24T12:00:00.000Z",
    mergeSha: "manual-release-sha",
    ...overrides,
  };
}

function makeReleaseManagerForRoutes(
  storage: MemStorage,
  overrides: Partial<ReleaseGitHubService> = {},
): ReleaseManager {
  const github: ReleaseGitHubService = {
    buildOctokit: async () => ({}) as Octokit,
    getDefaultBranch: async () => "main",
    findLatestSemverReleaseTag: async () => "v1.2.3",
    bumpReleaseTag: () => "v1.2.4",
    listUnreleasedMergedPulls: async () => [makeMergedSummary()],
    listMergedPullsForReleaseCandidate: async () => [makeMergedSummary()],
    findReleaseByTag: async () => null,
    createGitHubRelease: async (_octokit, _repo, params) => ({
      id: 123,
      url: `https://github.com/acme/widgets/releases/tag/${params.tagName}`,
      tagName: params.tagName,
      name: params.name,
    }),
    ...overrides,
  };

  return new ReleaseManager(storage, {
    github,
    evaluateRelease: async (): Promise<ReleaseEvaluationDecision> => ({
      shouldRelease: true,
      reason: "Manual release requested",
      bump: "patch",
      title: "Manual release",
      notes: "Manual release notes",
    }),
  });
}

test("GET/PATCH /api/config masks and persists ordered github tokens", async () => {
  const harness = await createHarness();

  try {
    const patchResponse = await fetch(`${harness.baseUrl}/api/config`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ githubTokens: ["ghs_alpha1234", "ghs_beta5678"] }),
    });

    assert.equal(patchResponse.status, 200);
    const patched = await patchResponse.json() as { githubTokens: string[]; githubToken: string };
    assert.deepEqual(patched.githubTokens, ["***1234", "***5678"]);
    assert.equal(patched.githubToken, "***1234");

    const stored = await harness.storage.getConfig();
    assert.deepEqual(stored.githubTokens, ["ghs_alpha1234", "ghs_beta5678"]);

    const getResponse = await fetch(`${harness.baseUrl}/api/config`);
    assert.equal(getResponse.status, 200);
    const fetched = await getResponse.json() as { githubTokens: string[]; githubToken: string };
    assert.deepEqual(fetched.githubTokens, ["***1234", "***5678"]);
    assert.equal(fetched.githubToken, "***1234");
  } finally {
    await harness.close();
  }
});

test("PATCH /api/config preserves masked github tokens when reordering", async () => {
  const harness = await createHarness();

  try {
    await harness.storage.updateConfig({
      githubTokens: ["ghs_alpha1234", "ghs_beta5678"],
    });

    const response = await fetch(`${harness.baseUrl}/api/config`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ githubTokens: ["***5678", "***1234", "ghs_gamma9999"] }),
    });

    assert.equal(response.status, 200);
    const patched = await response.json() as { githubTokens: string[] };
    assert.deepEqual(patched.githubTokens, ["***5678", "***1234", "***9999"]);

    const stored = await harness.storage.getConfig();
    assert.deepEqual(stored.githubTokens, ["ghs_beta5678", "ghs_alpha1234", "ghs_gamma9999"]);
  } finally {
    await harness.close();
  }
});

test("PATCH /api/config accepts legacy single githubToken updates", async () => {
  const harness = await createHarness();

  try {
    const response = await fetch(`${harness.baseUrl}/api/config`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ githubToken: "ghs_legacy9999" }),
    });

    assert.equal(response.status, 200);
    const patched = await response.json() as { githubTokens: string[]; githubToken: string };
    assert.deepEqual(patched.githubTokens, ["***9999"]);
    assert.equal(patched.githubToken, "***9999");

    const stored = await harness.storage.getConfig();
    assert.deepEqual(stored.githubTokens, ["ghs_legacy9999"]);
  } finally {
    await harness.close();
  }
});

test("POST /api/prs/:id/questions enqueues a durable answer_pr_question job", async () => {
  const harness = await createHarness();
  const pr = await seedPR(harness.storage);

  try {
    const response = await fetch(`${harness.baseUrl}/api/prs/${pr.id}/questions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({ question: "What changed?" }),
    });

    assert.equal(response.status, 201);
    const created = await response.json() as { id: string; status: string };
    assert.equal(created.status, "pending");

    const questions = await harness.storage.getQuestions(pr.id);
    assert.equal(questions.length, 1);
    assert.equal(questions[0].status, "pending");
    assert.equal(questions[0].answer, null);

    const jobs = await harness.storage.listBackgroundJobs({
      kind: "answer_pr_question",
      status: "queued",
    });
    assert.equal(jobs.length, 1);
    assert.equal(jobs[0].targetId, created.id);
    assert.equal(jobs[0].payload.prId, pr.id);
  } finally {
    await harness.close();
  }
});

test("POST /api/prs/:id/babysit enqueues a durable babysit_pr job", async () => {
  const harness = await createHarness();
  const pr = await seedPR(harness.storage);

  try {
    const response = await fetch(`${harness.baseUrl}/api/prs/${pr.id}/babysit`, {
      method: "POST",
    });

    assert.equal(response.status, 200);

    const jobs = await harness.storage.listBackgroundJobs({
      kind: "babysit_pr",
      status: "queued",
    });
    assert.equal(jobs.length, 1);
    assert.equal(jobs[0].targetId, pr.id);
    assert.equal(jobs[0].payload.preferredAgent, "claude");
  } finally {
    await harness.close();
  }
});

test("POST /api/repos/sync enqueues a durable sync_watched_repos job", async () => {
  const harness = await createHarness();

  try {
    const response = await fetch(`${harness.baseUrl}/api/repos/sync`, {
      method: "POST",
    });

    assert.equal(response.status, 200);
    const body = await response.json() as { ok: boolean };
    assert.equal(body.ok, true);

    const jobs = await harness.storage.listBackgroundJobs({
      kind: "sync_watched_repos",
      status: "queued",
    });
    assert.equal(jobs.length, 1);
    assert.equal(jobs[0].targetId, "runtime:1");
    assert.equal(jobs[0].dedupeKey, "sync_watched_repos");
  } finally {
    await harness.close();
  }
});

test("GET /api/activities lists in-progress and queued jobs", async () => {
  const harness = await createHarness();
  const pr = await seedPR(harness.storage, {
    title: "fix activity menu",
    repo: "acme/widgets",
    number: 77,
    url: "https://github.com/acme/widgets/pull/77",
  });

  try {
    const runningJob = await harness.storage.enqueueBackgroundJob({
      kind: "babysit_pr",
      targetId: pr.id,
      dedupeKey: `babysit_pr:${pr.id}`,
      payload: { preferredAgent: "claude" },
      availableAt: "2026-04-26T10:00:00.000Z",
    });
    await harness.storage.claimNextBackgroundJob({
      workerId: "worker-1",
      leaseToken: "lease-1",
      leaseExpiresAt: "2026-04-26T10:10:00.000Z",
      now: "2026-04-26T10:01:00.000Z",
    });

    const queuedJob = await harness.storage.enqueueBackgroundJob({
      kind: "sync_watched_repos",
      targetId: "runtime:1",
      dedupeKey: "sync_watched_repos",
      availableAt: "2026-04-26T10:02:00.000Z",
    });

    const response = await fetch(`${harness.baseUrl}/api/activities`);
    assert.equal(response.status, 200);
    const body = await response.json() as {
      inProgress: Array<{
        id: string;
        kind: string;
        status: string;
        label: string;
        detail: string | null;
        targetId: string;
        targetUrl: string | null;
      }>;
      queued: Array<{
        id: string;
        kind: string;
        status: string;
        label: string;
        detail: string | null;
        targetId: string;
      }>;
    };

    assert.equal(body.inProgress.length, 1);
    assert.equal(body.inProgress[0]?.id, runningJob.id);
    assert.equal(body.inProgress[0]?.kind, "babysit_pr");
    assert.equal(body.inProgress[0]?.status, "in_progress");
    assert.equal(body.inProgress[0]?.label, "Babysitting PR #77");
    assert.equal(body.inProgress[0]?.detail, "acme/widgets - fix activity menu");
    assert.equal(body.inProgress[0]?.targetId, pr.id);
    assert.equal(body.inProgress[0]?.targetUrl, pr.url);

    assert.equal(body.queued.length, 1);
    assert.equal(body.queued[0]?.id, queuedJob.id);
    assert.equal(body.queued[0]?.kind, "sync_watched_repos");
    assert.equal(body.queued[0]?.status, "queued");
    assert.equal(body.queued[0]?.label, "Sync watched repositories");
    assert.equal(body.queued[0]?.targetId, "runtime:1");
  } finally {
    await harness.close();
  }
});

test("GET /api/activities batches PR activity metadata", async () => {
  const harness = await createHarness();
  const firstPr = await seedPR(harness.storage, {
    title: "fix activity menu",
    repo: "acme/widgets",
    number: 77,
    url: "https://github.com/acme/widgets/pull/77",
  });
  const secondPr = await seedPR(harness.storage, {
    title: "answer follow-up",
    repo: "acme/widgets",
    number: 78,
    url: "https://github.com/acme/widgets/pull/78",
  });

  try {
    await harness.storage.enqueueBackgroundJob({
      kind: "babysit_pr",
      targetId: firstPr.id,
      dedupeKey: `babysit_pr:${firstPr.id}`,
      payload: { preferredAgent: "claude" },
    });
    await harness.storage.enqueueBackgroundJob({
      kind: "answer_pr_question",
      targetId: "question-1",
      dedupeKey: "answer_pr_question:question-1",
      payload: { prId: secondPr.id },
    });

    const getPR = harness.storage.getPR.bind(harness.storage);
    harness.storage.getPR = async (id: string) => {
      throw new Error(`unexpected per-job PR lookup for ${id}`);
    };

    const response = await fetch(`${harness.baseUrl}/api/activities`);
    assert.equal(response.status, 200);
    const body = await response.json() as {
      queued: Array<{
        label: string;
        detail: string | null;
        targetUrl: string | null;
      }>;
    };

    assert.deepEqual(
      body.queued.map((item) => [item.label, item.detail, item.targetUrl]),
      [
        ["Babysitting PR #77", "acme/widgets - fix activity menu", firstPr.url],
        ["Answering question for PR #78", "acme/widgets - answer follow-up", secondPr.url],
      ],
    );
    harness.storage.getPR = getPR;
  } finally {
    await harness.close();
  }
});

test("GET /api/activities warns when a babysitter job fails from agent authentication", async () => {
  const harness = await createHarness();
  const pr = await seedPR(harness.storage, {
    title: "fix auth warning",
    repo: "acme/widgets",
    number: 77,
    url: "https://github.com/acme/widgets/pull/77",
  });

  try {
    const job = await harness.storage.enqueueBackgroundJob({
      kind: "babysit_pr",
      targetId: pr.id,
      dedupeKey: `babysit_pr:${pr.id}`,
      payload: { preferredAgent: "claude" },
      availableAt: "2026-04-26T10:00:00.000Z",
    });
    await harness.storage.claimNextBackgroundJob({
      workerId: "worker-1",
      leaseToken: "lease-1",
      leaseExpiresAt: "2026-04-26T10:10:00.000Z",
      now: "2026-04-26T10:01:00.000Z",
    });
    await harness.storage.failBackgroundJob(
      job.id,
      "lease-1",
      "claude evaluation failed (1): Failed to authenticate. API Error: 401 {\"type\":\"error\",\"error\":{\"type\":\"authentication_error\",\"message\":\"Invalid authentication credentials\"}}",
      "2026-04-26T10:02:00.000Z",
    );
    await harness.storage.updatePR(pr.id, {
      status: "error",
      lastChecked: "2026-04-26T10:02:00.000Z",
    });

    const response = await fetch(`${harness.baseUrl}/api/activities`);
    assert.equal(response.status, 200);
    const body = await response.json() as {
      warnings?: Array<{
        id: string;
        severity: string;
        title: string;
        message: string;
        fixSteps: string[];
        targetId: string;
        targetUrl: string | null;
      }>;
    };

    assert.ok(Array.isArray(body.warnings));
    assert.equal(body.warnings.length, 1);
    assert.equal(body.warnings[0]?.id, job.id);
    assert.equal(body.warnings[0]?.severity, "warning");
    assert.equal(body.warnings[0]?.title, "Claude authentication failed");
    assert.match(body.warnings[0]?.message ?? "", /PR #77/);
    assert.match(body.warnings[0]?.message ?? "", /acme\/widgets/);
    assert.deepEqual(body.warnings[0]?.fixSteps, [
      "Run `claude auth login` on this machine.",
      "Restart oh-my-pr if it was launched before you refreshed credentials.",
      "Rerun the babysitter for this PR.",
    ]);
    assert.equal(body.warnings[0]?.targetId, pr.id);
    assert.equal(body.warnings[0]?.targetUrl, pr.url);
  } finally {
    await harness.close();
  }
});

test("POST /api/repos/release queues a manual release run for the requested repo", async () => {
  const storage = new MemStorage();
  const harness = await createHarness(storage, {
    releaseManager: makeReleaseManagerForRoutes(storage),
  });

  try {
    const response = await fetch(`${harness.baseUrl}/api/repos/release`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({ repo: "https://github.com/acme/widgets" }),
    });

    assert.equal(response.status, 201);
    const body = await response.json() as {
      repo: string;
      source?: string;
      triggerPrNumber: number;
      triggerMergeSha: string;
    };
    assert.equal(body.repo, "acme/widgets");
    assert.equal(body.source, "manual");
    assert.equal(body.triggerPrNumber, 42);
    assert.equal(body.triggerMergeSha, "manual-release-sha");
  } finally {
    await harness.close();
  }
});

test("POST /api/repos/release returns 409 when the repo has no unreleased merged PRs", async () => {
  const storage = new MemStorage();
  const harness = await createHarness(storage, {
    releaseManager: makeReleaseManagerForRoutes(storage, {
      listUnreleasedMergedPulls: async () => [],
    }),
  });

  try {
    const response = await fetch(`${harness.baseUrl}/api/repos/release`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({ repo: "acme/widgets" }),
    });

    assert.equal(response.status, 409);
    const body = await response.json() as { error: string };
    assert.match(body.error, /No unreleased merged pull requests found for acme\/widgets/);
  } finally {
    await harness.close();
  }
});

test("GET/PATCH /api/repos/settings exposes repo-level settings", async () => {
  const harness = await createHarness();
  await harness.storage.updateConfig({
    watchedRepos: ["acme/widgets"],
  });

  try {
    const initialResponse = await fetch(`${harness.baseUrl}/api/repos/settings`);
    assert.equal(initialResponse.status, 200);
    const initial = await initialResponse.json() as Array<{
      repo: string;
      autoCreateReleases: boolean;
      ownPrsOnly: boolean;
    }>;
    assert.deepEqual(initial, [{
      repo: "acme/widgets",
      autoCreateReleases: true,
      ownPrsOnly: true,
    }]);

    const updateResponse = await fetch(`${harness.baseUrl}/api/repos/settings`, {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        repo: "acme/widgets",
        autoCreateReleases: false,
        ownPrsOnly: false,
      }),
    });
    assert.equal(updateResponse.status, 200);
    const updated = await updateResponse.json() as {
      repo: string;
      autoCreateReleases: boolean;
      ownPrsOnly: boolean;
    };
    assert.deepEqual(updated, {
      repo: "acme/widgets",
      autoCreateReleases: false,
      ownPrsOnly: false,
    });

    const persisted = await harness.storage.getRepoSettings("acme/widgets");
    assert.deepEqual(persisted, {
      repo: "acme/widgets",
      autoCreateReleases: false,
      ownPrsOnly: false,
    });
  } finally {
    await harness.close();
  }
});

test("PATCH /api/repos/settings can update only ownPrsOnly", async () => {
  const harness = await createHarness();
  await harness.storage.updateRepoSettings("acme/widgets", {
    autoCreateReleases: false,
    ownPrsOnly: true,
  });

  try {
    const updateResponse = await fetch(`${harness.baseUrl}/api/repos/settings`, {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        repo: "acme/widgets",
        ownPrsOnly: false,
      }),
    });
    assert.equal(updateResponse.status, 200);

    const updated = await updateResponse.json() as {
      repo: string;
      autoCreateReleases: boolean;
      ownPrsOnly: boolean;
    };
    assert.deepEqual(updated, {
      repo: "acme/widgets",
      autoCreateReleases: false,
      ownPrsOnly: false,
    });
  } finally {
    await harness.close();
  }
});

test("GET /api/app-update exposes the app update check result", async () => {
  const originalVersion = process.env.APP_VERSION;
  process.env.APP_VERSION = "1.0.0";
  const expected: AppUpdateStatus = {
    currentVersion: "1.0.0",
    latestVersion: "v1.1.0",
    latestReleaseUrl: "https://github.com/yungookim/oh-my-pr/releases/tag/v1.1.0",
    updateAvailable: true,
  };
  const harness = await createHarness(new MemStorage(), {
    appUpdateChecker: async (currentVersion) => ({
      ...expected,
      currentVersion,
    }),
  });

  try {
    const response = await fetch(`${harness.baseUrl}/api/app-update`);
    assert.equal(response.status, 200);
    const payload = await response.json() as AppUpdateStatus;
    assert.deepEqual(payload, expected);
  } finally {
    process.env.APP_VERSION = originalVersion;
    await harness.close();
  }
});

test("GET /api/healing-sessions returns persisted healing sessions", async () => {
  const harness = await createHarness();

  try {
    const pr = await seedPR(harness.storage, {
      number: 52,
      title: "Healing route",
      repo: "alex-morgan-o/lolodex",
      branch: "feature/healing-route",
      author: "octocat",
      url: "https://github.com/alex-morgan-o/lolodex/pull/52",
    });
    const session = await harness.storage.createHealingSession({
      prId: pr.id,
      repo: pr.repo,
      prNumber: pr.number,
      initialHeadSha: "abc123",
      currentHeadSha: "abc123",
      state: "awaiting_repair_slot",
      endedAt: null,
      blockedReason: null,
      escalationReason: null,
      latestFingerprint: "github.check_run:typescript:build",
      attemptCount: 0,
      lastImprovementScore: null,
    });

    const response = await fetch(`${harness.baseUrl}/api/healing-sessions`);
    assert.equal(response.status, 200);
    const sessions = await response.json() as Array<{ id: string; prId: string; state: string }>;
    assert.equal(sessions.length, 1);
    assert.equal(sessions[0]?.id, session.id);
    assert.equal(sessions[0]?.prId, pr.id);
    assert.equal(sessions[0]?.state, "awaiting_repair_slot");
  } finally {
    await harness.close();
  }
});

test("GET /api/healing-sessions/:id returns a specific session and 404s when missing", async () => {
  const harness = await createHarness();

  try {
    const pr = await seedPR(harness.storage, {
      number: 53,
      title: "Healing detail route",
      repo: "alex-morgan-o/lolodex",
      branch: "feature/healing-detail",
      author: "octocat",
      url: "https://github.com/alex-morgan-o/lolodex/pull/53",
    });
    const session = await harness.storage.createHealingSession({
      prId: pr.id,
      repo: pr.repo,
      prNumber: pr.number,
      initialHeadSha: "def456",
      currentHeadSha: "def456",
      state: "blocked",
      endedAt: new Date().toISOString(),
      blockedReason: "External CI failure",
      escalationReason: null,
      latestFingerprint: "github.check_run:missing-secret:deploy",
      attemptCount: 0,
      lastImprovementScore: null,
    });

    const okResponse = await fetch(`${harness.baseUrl}/api/healing-sessions/${session.id}`);
    assert.equal(okResponse.status, 200);
    const payload = await okResponse.json() as { id: string; state: string; blockedReason: string | null };
    assert.equal(payload.id, session.id);
    assert.equal(payload.state, "blocked");
    assert.equal(payload.blockedReason, "External CI failure");

    const missingResponse = await fetch(`${harness.baseUrl}/api/healing-sessions/does-not-exist`);
    assert.equal(missingResponse.status, 404);
    const missingPayload = await missingResponse.json() as { error: string };
    assert.equal(missingPayload.error, "Healing session not found");
  } finally {
    await harness.close();
  }
});
