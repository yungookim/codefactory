import { mkdtemp, readFile, rm } from "fs/promises";
import { tmpdir } from "os";
import path from "path";
import { resolveAgent, runCommand, type CodingAgent } from "./agentRunner";

const DEFAULT_RELEASE_AGENT_TIMEOUT_MS = 120_000;

export type ReleaseBump = "patch" | "minor" | "major";

export type ReleaseAgentPullSummary = {
  number: number;
  title: string;
  url: string;
  author: string;
  repo: string;
  mergedAt: string;
  mergeSha: string;
};

export type ReleaseEvaluationDecision = {
  shouldRelease: boolean;
  reason: string;
  bump: ReleaseBump | null;
  title: string | null;
  notes: string | null;
};

export async function evaluateReleaseWorthinessWithAgent(params: {
  preferredAgent: CodingAgent;
  repo: string;
  baseBranch: string;
  latestTag: string | null;
  triggerPr: ReleaseAgentPullSummary;
  includedPulls: ReleaseAgentPullSummary[];
  cwd?: string;
  timeoutMs?: number;
}): Promise<ReleaseEvaluationDecision> {
  const cwd = params.cwd ?? process.cwd();
  const timeoutMs = params.timeoutMs ?? DEFAULT_RELEASE_AGENT_TIMEOUT_MS;
  const agent = await resolveAgent(params.preferredAgent);
  const prompt = buildReleaseDecisionPrompt(params);

  if (agent === "codex") {
    const tempDir = await mkdtemp(path.join(tmpdir(), "codex-release-eval-"));
    const outputFile = path.join(tempDir, "output.txt");

    try {
      const result = await runCommand(
        "codex",
        [
          "exec",
          "--skip-git-repo-check",
          "--sandbox",
          "read-only",
          "-o",
          outputFile,
          prompt,
        ],
        { cwd, timeoutMs },
      );

      if (result.code !== 0) {
        throw new Error(`codex release evaluation failed (${result.code}): ${result.stderr || result.stdout}`);
      }

      const raw = await readFile(outputFile, "utf8");
      return parseReleaseDecisionOutput(raw);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  }

  const result = await runCommand(
    "claude",
    [
      "-p",
      "--output-format",
      "text",
      prompt,
    ],
    { cwd, timeoutMs },
  );

  if (result.code !== 0) {
    throw new Error(`claude release evaluation failed (${result.code}): ${result.stderr || result.stdout}`);
  }

  return parseReleaseDecisionOutput(result.stdout);
}

export function buildReleaseDecisionPrompt(params: {
  repo: string;
  baseBranch: string;
  latestTag: string | null;
  triggerPr: ReleaseAgentPullSummary;
  includedPulls: ReleaseAgentPullSummary[];
}): string {
  const includedPullsSection = params.includedPulls
    .map((pr, index) => {
      return [
        `${index + 1}. PR #${pr.number} by @${pr.author}`,
        `   Title: ${pr.title}`,
        `   URL: ${pr.url}`,
        `   Merged at: ${pr.mergedAt}`,
        `   Merge SHA: ${pr.mergeSha}`,
      ].join("\n");
    })
    .join("\n");

  return [
    "Respond with ONLY valid JSON and nothing else.",
    "Schema:",
    "{\"shouldRelease\":boolean,\"reason\":string,\"bump\":\"patch\"|\"minor\"|\"major\"|null,\"title\":string|null,\"notes\":string|null}",
    "",
    "You are deciding whether a merged set of pull requests should be published as a GitHub release.",
    "Be conservative. Release only when the merged changes are meaningful enough for users or operators to care about.",
    "",
    `Repository: ${params.repo}`,
    `Release branch: ${params.baseBranch}`,
    `Latest release tag: ${params.latestTag ?? "none"}`,
    "",
    `Trigger PR: #${params.triggerPr.number} "${params.triggerPr.title}"`,
    `Trigger merged at: ${params.triggerPr.mergedAt}`,
    `Trigger merge SHA: ${params.triggerPr.mergeSha}`,
    "",
    "Merged PRs included in this candidate release:",
    includedPullsSection || "(none)",
    "",
    "Decision rules:",
    "- shouldRelease=true only when the merged changes are worth announcing as a GitHub release.",
    "- bump must be null when shouldRelease=false.",
    "- bump must be one of patch, minor, or major when shouldRelease=true.",
    "- Use patch for fixes or small improvements, minor for additive user-facing features, and major for breaking changes.",
    "- title should be short and release-note ready when shouldRelease=true, else null.",
    "- notes should be GitHub-release Markdown focused on user-visible/operator-visible impact when shouldRelease=true, else null.",
    "- notes must have exactly TWO sections in this order:",
    "  1. '## Why This Matters' — a user-friendly, value-driven summary at the top that explains how the release makes users' lives better.",
    "  2. '## Detailed Changes' — a line-by-line changelog of the included changes in plain English, more detailed than a headline but not deeply technical.",
    "- notes should mention the key merged PRs in plain language, not internal process commentary.",
    "- Prefer user outcomes, workflow improvements, and visible behavior over implementation details.",
  ].join("\n");
}

export function parseReleaseDecisionOutput(output: string): ReleaseEvaluationDecision {
  const parsed = tryParseJsonFromText(output.trim());
  if (!parsed || typeof parsed !== "object") {
    throw new Error(`Could not parse release evaluation JSON: ${output.slice(0, 500)}`);
  }

  const candidate = parsed as {
    shouldRelease?: unknown;
    reason?: unknown;
    bump?: unknown;
    title?: unknown;
    notes?: unknown;
  };

  if (typeof candidate.shouldRelease !== "boolean") {
    throw new Error("Release evaluation missing boolean 'shouldRelease'");
  }

  if (typeof candidate.reason !== "string" || candidate.reason.trim().length === 0) {
    throw new Error("Release evaluation missing string 'reason'");
  }

  if (!candidate.shouldRelease) {
    return {
      shouldRelease: false,
      reason: candidate.reason.trim(),
      bump: null,
      title: null,
      notes: null,
    };
  }

  if (candidate.bump !== "patch" && candidate.bump !== "minor" && candidate.bump !== "major") {
    throw new Error("Release evaluation returned invalid 'bump'");
  }

  if (typeof candidate.title !== "string" || candidate.title.trim().length === 0) {
    throw new Error("Release evaluation missing non-empty 'title'");
  }

  if (typeof candidate.notes !== "string" || candidate.notes.trim().length === 0) {
    throw new Error("Release evaluation missing non-empty 'notes'");
  }

  return {
    shouldRelease: true,
    reason: candidate.reason.trim(),
    bump: candidate.bump,
    title: candidate.title.trim(),
    notes: candidate.notes.trim(),
  };
}

function tryParseJsonFromText(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    // fall through
  }

  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    return null;
  }

  try {
    return JSON.parse(text.slice(firstBrace, lastBrace + 1));
  } catch {
    return null;
  }
}
