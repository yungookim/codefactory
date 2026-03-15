import { randomUUID } from "crypto";
import { mkdir, rm } from "fs/promises";
import path from "path";
import type { Config, FeedbackItem, PR } from "@shared/schema";
import type { IStorage } from "./storage";
import {
  applyFixesWithAgent,
  evaluateFixNecessityWithAgent,
  resolveAgent,
  runCommand,
  type CodingAgent,
} from "./agentRunner";
import {
  buildOctokit,
  fetchFeedbackItemsForPR,
  fetchPullSummary,
  formatRepoSlug,
  listFailingStatuses,
  listOpenPullsForRepo,
  parseRepoSlug,
  type ParsedPRUrl,
} from "./github";

const DEFAULT_GIT_USER_NAME = "PR Babysitter";
const DEFAULT_GIT_USER_EMAIL = "pr-babysitter@local";

type GitHubService = {
  buildOctokit: typeof buildOctokit;
  fetchFeedbackItemsForPR: typeof fetchFeedbackItemsForPR;
  fetchPullSummary: typeof fetchPullSummary;
  listFailingStatuses: typeof listFailingStatuses;
  listOpenPullsForRepo: typeof listOpenPullsForRepo;
};

type BabysitterRuntime = {
  applyFixesWithAgent: typeof applyFixesWithAgent;
  evaluateFixNecessityWithAgent: typeof evaluateFixNecessityWithAgent;
  resolveAgent: typeof resolveAgent;
  runCommand: typeof runCommand;
};

const defaultGitHubService: GitHubService = {
  buildOctokit,
  fetchFeedbackItemsForPR,
  fetchPullSummary,
  listFailingStatuses,
  listOpenPullsForRepo,
};

const defaultBabysitterRuntime: BabysitterRuntime = {
  applyFixesWithAgent,
  evaluateFixNecessityWithAgent,
  resolveAgent,
  runCommand,
};

function countDecisions(items: FeedbackItem[]): {
  accepted: number;
  rejected: number;
  flagged: number;
} {
  return {
    accepted: items.filter((item) => item.decision === "accept").length,
    rejected: items.filter((item) => item.decision === "reject").length,
    flagged: items.filter((item) => item.decision === "flag").length,
  };
}

function mergeFeedbackItems(existing: FeedbackItem[], incoming: FeedbackItem[]): { merged: FeedbackItem[]; newCount: number } {
  const previousById = new Map(existing.map((item) => [item.id, item]));
  let newCount = 0;

  const merged = incoming.map((item) => {
    const previous = previousById.get(item.id);
    if (!previous) {
      newCount += 1;
      return item;
    }

    // Preserve triage decisions and action annotations across refreshes.
    return {
      ...item,
      decision: previous.decision,
      decisionReason: previous.decisionReason,
      action: previous.action,
    };
  });

  // Keep historical items that are no longer returned by API to avoid losing manual triage context.
  for (const item of existing) {
    if (!merged.find((candidate) => candidate.id === item.id)) {
      merged.push(item);
    }
  }

  merged.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

  return { merged, newCount };
}

function formatFeedbackSyncLogMessage(total: number, newCount: number): string {
  const suffix = total === 1 ? "" : "s";
  return `GitHub sync complete: ${total} feedback item${suffix} (${newCount} new)`;
}

function buildCommentEvaluationPrompt(params: {
  pr: PR;
  item: FeedbackItem;
}): string {
  const { pr, item } = params;

  return [
    "You are deciding whether a PR comment requires code changes.",
    "Return JSON only.",
    `Repository: ${pr.repo}`,
    `PR: #${pr.number}`,
    `Comment author: ${item.author}`,
    `Comment type: ${item.type}`,
    `File: ${item.file || "n/a"}`,
    `Line: ${item.line ?? "n/a"}`,
    "Comment:",
    item.body,
    "Decision rule:",
    "- needsFix=true only when concrete code changes are required.",
    "- needsFix=false for acknowledgements, compliments, or non-actionable statements.",
  ].join("\n");
}

function buildStatusEvaluationPrompt(params: {
  pr: PR;
  context: string;
  description: string;
  targetUrl: string | null;
}): string {
  const { pr, context, description, targetUrl } = params;

  return [
    "You are deciding whether a failing CI status should trigger automated code changes.",
    "Return JSON only.",
    `Repository: ${pr.repo}`,
    `PR: #${pr.number}`,
    `Status context: ${context}`,
    `Description: ${description}`,
    `Target URL: ${targetUrl || "n/a"}`,
    "Decision rule:",
    "- needsFix=true if this is likely caused by source code or project config that can be fixed in-branch.",
    "- needsFix=false if it is transient infra failure, flaky external system, or missing permissions/secrets.",
  ].join("\n");
}

function buildAgentFixPrompt(params: {
  pr: PR;
  commentTasks: FeedbackItem[];
  statusTasks: { context: string; description: string; targetUrl: string | null }[];
}): string {
  const { pr, commentTasks, statusTasks } = params;

  const commentSection = commentTasks.length
    ? commentTasks
        .map((item, index) => {
          return [
            `${index + 1}. [${item.type}] ${item.author}`,
            `   file=${item.file || "n/a"} line=${item.line ?? "n/a"}`,
            `   ${item.body}`,
          ].join("\n");
        })
        .join("\n")
    : "None";

  const statusSection = statusTasks.length
    ? statusTasks
        .map((status, index) => {
          return `${index + 1}. ${status.context}: ${status.description}${status.targetUrl ? ` (${status.targetUrl})` : ""}`;
        })
        .join("\n")
    : "None";

  return [
    `You are acting as an autonomous PR babysitter for ${pr.repo} PR #${pr.number}.`,
    "Make only targeted changes that resolve the approved tasks.",
    "Do not wait for user input, confirmation, or approval at any point.",
    "Do not rewrite unrelated files.",
    "If a task is invalid after inspection, skip it and explain briefly in your final response.",
    "Do not push changes yourself; the outer babysitter will commit and push directly to the PR branch once your edits are ready.",
    "",
    "Approved review-comment tasks:",
    commentSection,
    "",
    "Approved status-check tasks:",
    statusSection,
    "",
    "When done:",
    "1) Ensure the repository is left in a clean commit-ready state.",
    "2) Summarize what changed and what could not be fixed.",
  ].join("\n");
}

function formatCommand(command: string, args: string[]): string {
  return [command, ...args].join(" ");
}

function summarizeCommandFailure(result: Awaited<ReturnType<typeof runCommand>>): string {
  return result.stderr.trim() || result.stdout.trim() || "no output";
}

function drainChunkLines(buffer: string, chunk: string): { lines: string[]; buffer: string } {
  const text = `${buffer}${chunk}`;
  const parts = text.split(/\r?\n/);
  return {
    lines: parts.slice(0, -1),
    buffer: parts.at(-1) ?? "",
  };
}

async function ensureDirectory(dirPath: string): Promise<void> {
  await mkdir(dirPath, { recursive: true });
}

function sanitizeRepoName(repoFullName: string): string {
  return repoFullName.replace(/[^a-zA-Z0-9_.-]+/g, "__");
}

async function ensureGitIdentity(worktreePath: string, run: typeof runCommand): Promise<void> {
  const name = await run("git", ["config", "--get", "user.name"], { cwd: worktreePath, timeoutMs: 3000 });
  if (name.code !== 0 || !name.stdout.trim()) {
    await run("git", ["config", "user.name", DEFAULT_GIT_USER_NAME], { cwd: worktreePath, timeoutMs: 3000 });
  }

  const email = await run("git", ["config", "--get", "user.email"], { cwd: worktreePath, timeoutMs: 3000 });
  if (email.code !== 0 || !email.stdout.trim()) {
    await run("git", ["config", "user.email", DEFAULT_GIT_USER_EMAIL], { cwd: worktreePath, timeoutMs: 3000 });
  }
}

async function createWorktree(params: {
  cloneUrl: string;
  repoFullName: string;
  headRef: string;
  prNumber: number;
  workspaceRoot: string;
  runCommand: typeof runCommand;
}): Promise<{
  repoCacheDir: string;
  worktreePath: string;
}> {
  const { cloneUrl, repoFullName, headRef, prNumber, workspaceRoot, runCommand: run } = params;

  const cacheRoot = path.join(workspaceRoot, "repos");
  const worktreeRoot = path.join(workspaceRoot, "worktrees");
  await ensureDirectory(cacheRoot);
  await ensureDirectory(worktreeRoot);

  const safeRepoName = sanitizeRepoName(repoFullName);
  const repoCacheDir = path.join(cacheRoot, safeRepoName);

  const cloneCheck = await run("git", ["-C", repoCacheDir, "rev-parse", "--is-inside-work-tree"], {
    timeoutMs: 4000,
  });

  if (cloneCheck.code !== 0) {
    const cloneResult = await run("git", ["clone", cloneUrl, repoCacheDir], {
      timeoutMs: 180000,
    });

    if (cloneResult.code !== 0) {
      throw new Error(`git clone failed: ${cloneResult.stderr || cloneResult.stdout}`);
    }
  } else {
    const fetchResult = await run("git", ["-C", repoCacheDir, "fetch", "origin"], {
      timeoutMs: 120000,
    });

    if (fetchResult.code !== 0) {
      throw new Error(`git fetch failed: ${fetchResult.stderr || fetchResult.stdout}`);
    }
  }

  const fetchBranch = await run("git", ["-C", repoCacheDir, "fetch", "origin", headRef], {
    timeoutMs: 120000,
  });

  if (fetchBranch.code !== 0) {
    throw new Error(`git fetch origin ${headRef} failed: ${fetchBranch.stderr || fetchBranch.stdout}`);
  }

  const worktreePath = path.join(
    worktreeRoot,
    `${safeRepoName}-pr-${prNumber}-${Date.now()}`,
  );

  const worktreeCreate = await run(
    "git",
    ["-C", repoCacheDir, "worktree", "add", "--detach", worktreePath, "FETCH_HEAD"],
    { timeoutMs: 60000 },
  );

  if (worktreeCreate.code !== 0) {
    throw new Error(`git worktree add failed: ${worktreeCreate.stderr || worktreeCreate.stdout}`);
  }

  return { repoCacheDir, worktreePath };
}

async function removeWorktree(repoCacheDir: string, worktreePath: string, run: typeof runCommand): Promise<void> {
  await run("git", ["-C", repoCacheDir, "worktree", "remove", "--force", worktreePath], {
    timeoutMs: 30000,
  });
  await rm(worktreePath, { recursive: true, force: true });
}

export class PRBabysitter {
  private readonly storage: IStorage;
  private readonly inProgress = new Set<string>();
  private readonly github: GitHubService;
  private readonly runtime: BabysitterRuntime;

  constructor(
    storage: IStorage,
    github: GitHubService = defaultGitHubService,
    runtime: BabysitterRuntime = defaultBabysitterRuntime,
  ) {
    this.storage = storage;
    this.github = github;
    this.runtime = runtime;
  }

  async syncFeedbackForPR(
    prId: string,
    options?: {
      runId?: string | null;
      logStart?: boolean;
      phase?: string | null;
    },
  ): Promise<PR> {
    const pr = await this.storage.getPR(prId);
    if (!pr) {
      throw new Error("PR not found");
    }

    const parsedRepo = parseRepoSlug(pr.repo);
    if (!parsedRepo) {
      throw new Error(`Invalid repository slug: ${pr.repo}`);
    }

    const parsed: ParsedPRUrl = {
      owner: parsedRepo.owner,
      repo: parsedRepo.repo,
      number: pr.number,
    };

    const config = await this.storage.getConfig();
    const octokit = await this.github.buildOctokit(config);
    const phase = options?.phase ?? "sync";

    if (options?.logStart) {
      await this.storage.addLog(pr.id, "info", "Syncing GitHub comments/reviews...", {
        runId: options.runId ?? null,
        phase,
      });
    }

    const incomingFeedback = await this.github.fetchFeedbackItemsForPR(octokit, parsed, config);
    const { merged, newCount } = mergeFeedbackItems(pr.feedbackItems, incomingFeedback);
    const counters = countDecisions(merged);

    const updated = await this.storage.updatePR(pr.id, {
      title: pr.title,
      status: "watching",
      lastChecked: new Date().toISOString(),
      feedbackItems: merged,
      accepted: counters.accepted,
      rejected: counters.rejected,
      flagged: counters.flagged,
    });

    if (!updated) {
      throw new Error("Failed to update PR after feedback sync");
    }

    await this.storage.addLog(pr.id, "info", formatFeedbackSyncLogMessage(incomingFeedback.length, newCount), {
      runId: options?.runId ?? null,
      phase,
      metadata: {
        total: incomingFeedback.length,
        newCount,
      },
    });

    return updated;
  }

  async syncAndBabysitTrackedRepos(): Promise<void> {
    const config = await this.storage.getConfig();
    const octokit = await this.github.buildOctokit(config);

    const tracked = await this.storage.getPRs();
    const repoCandidates = new Set<string>([
      ...tracked.map((pr) => pr.repo),
      ...config.watchedRepos,
    ]);

    const repos = Array.from(repoCandidates)
      .map((repo) => parseRepoSlug(repo))
      .filter((repo): repo is NonNullable<typeof repo> => Boolean(repo));

    for (const repo of repos) {
      const repoSlug = formatRepoSlug(repo);

      let openPulls;
      try {
        openPulls = await this.github.listOpenPullsForRepo(octokit, repo);
      } catch (error) {
        console.error(`Failed to list open PRs for ${repoSlug}`, error);
        continue;
      }

      for (const pull of openPulls) {
        let local = await this.storage.getPRByRepoAndNumber(repoSlug, pull.number);
        if (!local) {
          local = await this.storage.addPR({
            number: pull.number,
            title: pull.title,
            repo: repoSlug,
            branch: pull.branch,
            author: pull.author,
            url: pull.url,
            status: "watching",
            feedbackItems: [],
            accepted: 0,
            rejected: 0,
            flagged: 0,
            testsPassed: null,
            lintPassed: null,
            lastChecked: null,
          });

          await this.storage.addLog(local.id, "info", `Auto-registered open PR #${pull.number} from ${repoSlug}`);
        }

        await this.storage.addLog(local.id, "info", "Watcher queued autonomous babysitter run", {
          phase: "watcher",
          metadata: { repo: repoSlug },
        });
        await this.babysitPR(local.id, config.codingAgent as CodingAgent);
      }
    }
  }

  async babysitPR(prId: string, preferredAgent: CodingAgent): Promise<void> {
    if (this.inProgress.has(prId)) {
      const pr = await this.storage.getPR(prId);
      if (pr) {
        await this.storage.addLog(pr.id, "warn", "Babysitter run skipped because another run is already in progress", {
          phase: "run",
        });
      }
      return;
    }

    this.inProgress.add(prId);
    const runId = randomUUID();
    let logQueue = Promise.resolve();

    const queueLog = (
      currentPrId: string,
      level: "info" | "warn" | "error",
      message: string,
      details?: {
        phase?: string | null;
        metadata?: Record<string, unknown> | null;
      },
	    ) => {
	      logQueue = logQueue
	        .then(async () => {
	          await this.storage.addLog(currentPrId, level, message, {
	            runId,
	            phase: details?.phase ?? null,
	            metadata: details?.metadata ?? null,
	          });
	        })
	        .catch((logError) => {
	          console.error("Babysitter log write failed", logError);
	        });

      return logQueue;
    };

    const createChunkLogger = (
      currentPrId: string,
      phase: string,
      stream: "stdout" | "stderr",
      level: "info" | "warn",
    ) => {
      let buffer = "";

      return {
        onChunk: (chunk: string) => {
          const drained = drainChunkLines(buffer, chunk);
          buffer = drained.buffer;
          for (const line of drained.lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            void queueLog(currentPrId, level, `[${stream}] ${trimmed}`, {
              phase,
              metadata: { stream },
            });
          }
        },
        flush: async () => {
          const trimmed = buffer.trim();
          if (!trimmed) return;
          buffer = "";
          await queueLog(currentPrId, level, `[${stream}] ${trimmed}`, {
            phase,
            metadata: { stream },
          });
        },
      };
    };

    const runLoggedCommand = async (params: {
      currentPrId: string;
      command: string;
      args: string[];
      cwd?: string;
      timeoutMs?: number;
      phase: string;
      successMessage: string;
    }) => {
      const { currentPrId, command, args, cwd, timeoutMs, phase, successMessage } = params;

      await queueLog(currentPrId, "info", `Running ${formatCommand(command, args)}`, {
        phase,
      });

      const stdoutLogger = createChunkLogger(currentPrId, phase, "stdout", "info");
      const stderrLogger = createChunkLogger(currentPrId, phase, "stderr", "warn");

      const result = await this.runtime.runCommand(command, args, {
        cwd,
        timeoutMs,
        onStdoutChunk: stdoutLogger.onChunk,
        onStderrChunk: stderrLogger.onChunk,
      });

      await stdoutLogger.flush();
      await stderrLogger.flush();

      if (result.code === 0) {
        await queueLog(currentPrId, "info", successMessage, {
          phase,
          metadata: { command: formatCommand(command, args), code: result.code },
        });
      } else {
        await queueLog(currentPrId, "error", `${formatCommand(command, args)} failed (${result.code})`, {
          phase,
          metadata: {
            command: formatCommand(command, args),
            code: result.code,
            summary: summarizeCommandFailure(result),
          },
        });
      }

      return result;
    };

    try {
      await this.storage.updatePR(prId, {
        status: "processing",
        lastChecked: new Date().toISOString(),
      });
      await queueLog(prId, "info", `Babysitter run started using preferred agent ${preferredAgent}`, {
        phase: "run",
        metadata: { preferredAgent },
      });

      let pr = await this.syncFeedbackForPR(prId, {
        runId,
        logStart: true,
        phase: "sync",
      });
      const config = await this.storage.getConfig();
      const agent = await this.runtime.resolveAgent(preferredAgent);
      const parsedRepo = parseRepoSlug(pr.repo);

      if (!parsedRepo) {
        throw new Error(`Invalid repository slug: ${pr.repo}`);
      }

      await queueLog(pr.id, "info", `Resolved coding agent to ${agent}`, {
        phase: "run",
      });

      const octokit = await this.github.buildOctokit(config);
      const parsedPr: ParsedPRUrl = {
        owner: parsedRepo.owner,
        repo: parsedRepo.repo,
        number: pr.number,
      };

      const pullSummary = await this.github.fetchPullSummary(octokit, parsedPr);
      const failingStatuses = await this.github.listFailingStatuses(octokit, parsedRepo, pullSummary.headSha);

      const pendingComments = pr.feedbackItems.filter((item) => item.decision === null);
      await queueLog(pr.id, "info", `Evaluating ${pendingComments.length} pending feedback item(s)`, {
        phase: "evaluate.comments",
      });

      const commentTasks: FeedbackItem[] = [];
      const commentDecisions = new Map<string, { decision: "accept" | "reject" | "flag"; reason: string }>();

      for (const item of pendingComments) {
        await queueLog(pr.id, "info", `Inspecting feedback from ${item.author}`, {
          phase: "evaluate.comments",
          metadata: {
            feedbackId: item.id,
            file: item.file,
            line: item.line,
          },
        });

        const evaluation = await this.runtime.evaluateFixNecessityWithAgent({
          agent,
          cwd: process.cwd(),
          prompt: buildCommentEvaluationPrompt({ pr, item }),
        });

        if (evaluation.needsFix) {
          commentTasks.push(item);
          commentDecisions.set(item.id, { decision: "accept", reason: evaluation.reason });
          await queueLog(pr.id, "info", `Accepted feedback ${item.id}: ${evaluation.reason}`, {
            phase: "evaluate.comments",
            metadata: { feedbackId: item.id, decision: "accept" },
          });
        } else {
          commentDecisions.set(item.id, { decision: "reject", reason: evaluation.reason });
          await queueLog(pr.id, "info", `Rejected feedback ${item.id}: ${evaluation.reason}`, {
            phase: "evaluate.comments",
            metadata: { feedbackId: item.id, decision: "reject" },
          });
        }
      }

      const statusTasks: { context: string; description: string; targetUrl: string | null }[] = [];
      await queueLog(pr.id, "info", `Evaluating ${failingStatuses.length} failing status check(s)`, {
        phase: "evaluate.status",
      });
      for (const status of failingStatuses) {
        const evaluation = await this.runtime.evaluateFixNecessityWithAgent({
          agent,
          cwd: process.cwd(),
          prompt: buildStatusEvaluationPrompt({
            pr,
            context: status.context,
            description: status.description,
            targetUrl: status.targetUrl,
          }),
        });

        if (evaluation.needsFix) {
          statusTasks.push(status);
          await queueLog(pr.id, "info", `Accepted failing status ${status.context}: ${evaluation.reason}`, {
            phase: "evaluate.status",
            metadata: { context: status.context, decision: "accept" },
          });
        } else {
          await queueLog(pr.id, "info", `Rejected failing status ${status.context}: ${evaluation.reason}`, {
            phase: "evaluate.status",
            metadata: { context: status.context, decision: "reject" },
          });
        }
      }

      if (commentDecisions.size > 0) {
        const updatedItems = pr.feedbackItems.map((item) => {
          const decision = commentDecisions.get(item.id);
          if (!decision) return item;

          return {
            ...item,
            decision: decision.decision,
            decisionReason: decision.reason,
            action: decision.decision === "accept" ? item.body : null,
          };
        });

        const counters = countDecisions(updatedItems);
        const updatedPR = await this.storage.updatePR(pr.id, {
          feedbackItems: updatedItems,
          accepted: counters.accepted,
          rejected: counters.rejected,
          flagged: counters.flagged,
        });

        if (updatedPR) {
          pr = updatedPR;
        }
      }

      if (commentTasks.length === 0 && statusTasks.length === 0) {
        await queueLog(pr.id, "info", `Babysitter checked PR #${pr.number}; no necessary fixes identified`, {
          phase: "run",
        });
        await this.storage.updatePR(pr.id, {
          status: "watching",
          lastChecked: new Date().toISOString(),
        });
        return;
      }

      await queueLog(
        pr.id,
        "info",
        `Babysitter preparing fix run with ${commentTasks.length} comment task(s) and ${statusTasks.length} status task(s) using ${agent}`,
        {
          phase: "run",
          metadata: {
            commentTasks: commentTasks.length,
            statusTasks: statusTasks.length,
            agent,
          },
        },
      );

      const workspaceRoot = process.env.PR_BABYSITTER_ROOT || path.join("/tmp", "pr-babysitter");
      await queueLog(pr.id, "info", `Preparing worktree in ${workspaceRoot}`, {
        phase: "worktree",
      });
      const { repoCacheDir, worktreePath } = await createWorktree({
        cloneUrl: pullSummary.headRepoCloneUrl,
        repoFullName: pullSummary.headRepoFullName,
        headRef: pullSummary.headRef,
        prNumber: pr.number,
        workspaceRoot,
        runCommand: this.runtime.runCommand,
      });

      try {
        await queueLog(pr.id, "info", `Worktree ready at ${worktreePath}`, {
          phase: "worktree",
        });
        await queueLog(pr.id, "info", "Ensuring git identity", {
          phase: "git.identity",
        });
        await ensureGitIdentity(worktreePath, this.runtime.runCommand);
        await queueLog(pr.id, "info", "Git identity ready", {
          phase: "git.identity",
        });

        const agentStdout = createChunkLogger(pr.id, "agent", "stdout", "info");
        const agentStderr = createChunkLogger(pr.id, "agent", "stderr", "warn");
        await queueLog(pr.id, "info", `Launching ${agent} in autonomous mode`, {
          phase: "agent",
        });

        const applyResult = await this.runtime.applyFixesWithAgent({
          agent,
          cwd: worktreePath,
          prompt: buildAgentFixPrompt({
            pr,
            commentTasks,
            statusTasks,
          }),
          onStdoutChunk: agentStdout.onChunk,
          onStderrChunk: agentStderr.onChunk,
        });
        await agentStdout.flush();
        await agentStderr.flush();

        if (applyResult.code !== 0) {
          throw new Error(`Agent apply failed (${applyResult.code}): ${applyResult.stderr || applyResult.stdout}`);
        }
        await queueLog(pr.id, "info", `${agent} completed successfully`, {
          phase: "agent",
          metadata: { code: applyResult.code },
        });

        const status = await runLoggedCommand({
          currentPrId: pr.id,
          command: "git",
          args: ["status", "--porcelain"],
          cwd: worktreePath,
          timeoutMs: 5000,
          phase: "git.status",
          successMessage: "Collected git status",
        });
        if (status.code !== 0) {
          throw new Error(`git status failed: ${status.stderr || status.stdout}`);
        }

        if (!status.stdout.trim()) {
          await queueLog(pr.id, "info", "Babysitter run completed but no file changes were produced", {
            phase: "run",
          });
          await this.storage.updatePR(pr.id, {
            status: "watching",
            lastChecked: new Date().toISOString(),
          });
          return;
        }

        const changedPaths = status.stdout.trim().split(/\r?\n/).filter(Boolean).length;
        await queueLog(pr.id, "info", `Detected ${changedPaths} changed path(s)`, {
          phase: "git.status",
          metadata: { changedPaths },
        });

        const addResult = await runLoggedCommand({
          currentPrId: pr.id,
          command: "git",
          args: ["add", "-A"],
          cwd: worktreePath,
          timeoutMs: 30000,
          phase: "git.add",
          successMessage: "Staged automated changes",
        });
        if (addResult.code !== 0) {
          throw new Error(`git add failed: ${addResult.stderr || addResult.stdout}`);
        }

        const commitMessage = `chore: apply automated babysitter fixes for PR #${pr.number}`;
        const commitResult = await runLoggedCommand({
          currentPrId: pr.id,
          command: "git",
          args: ["commit", "-m", commitMessage],
          cwd: worktreePath,
          timeoutMs: 30000,
          phase: "git.commit",
          successMessage: `Committed automated fixes with message: ${commitMessage}`,
        });

        if (commitResult.code !== 0) {
          throw new Error(`git commit failed: ${commitResult.stderr || commitResult.stdout}`);
        }

        const pushResult = await runLoggedCommand({
          currentPrId: pr.id,
          command: "git",
          args: ["push", "origin", `HEAD:${pullSummary.headRef}`],
          cwd: worktreePath,
          timeoutMs: 120000,
          phase: "git.push",
          successMessage: `Pushed automated fixes to ${pullSummary.headRef}`,
        });

        if (pushResult.code !== 0) {
          throw new Error(`git push failed: ${pushResult.stderr || pushResult.stdout}`);
        }

        await this.storage.updatePR(pr.id, {
          status: "watching",
          lastChecked: new Date().toISOString(),
        });
        await queueLog(pr.id, "info", "Babysitter run complete", {
          phase: "run",
        });
      } finally {
        try {
          await queueLog(pr.id, "info", "Cleaning up worktree", {
            phase: "cleanup",
          });
          await removeWorktree(repoCacheDir, worktreePath, this.runtime.runCommand);
          await queueLog(pr.id, "info", "Worktree cleanup complete", {
            phase: "cleanup",
          });
        } catch (cleanupError) {
          const cleanupMessage = cleanupError instanceof Error ? cleanupError.message : String(cleanupError);
          await queueLog(pr.id, "error", `Worktree cleanup failed: ${cleanupMessage}`, {
            phase: "cleanup",
          });
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const pr = await this.storage.getPR(prId);
      if (pr) {
        await queueLog(pr.id, "error", `Babysitter error: ${message}`, {
          phase: "run",
        });
        await this.storage.updatePR(pr.id, { status: "error", lastChecked: new Date().toISOString() });
      }
      console.error("Babysitter failure", error);
    } finally {
      await logQueue;
      this.inProgress.delete(prId);
    }
  }
}
