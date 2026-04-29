import assert from "node:assert/strict";
import test from "node:test";
import { buildDeploymentHealingPrompt, extractDeploymentHealingSummary, runDeploymentHealingRepair } from "./deploymentHealingAgent";

test("buildDeploymentHealingPrompt includes platform and log", () => {
  const prompt = buildDeploymentHealingPrompt({
    repo: "owner/repo", platform: "vercel", mergeSha: "abc123", triggerPrNumber: 42,
    triggerPrTitle: "Add feature", triggerPrUrl: "https://github.com/owner/repo/pull/42",
    deploymentLog: "Error: Cannot find module 'express'\n    at require (internal/modules/cjs/loader.js:1)",
    baseBranch: "main",
  });
  assert.ok(prompt.includes("vercel"), "should mention platform");
  assert.ok(prompt.includes("owner/repo"), "should mention repo");
  assert.ok(prompt.includes("abc123"), "should mention sha");
  assert.ok(prompt.includes("Cannot find module"), "should include log");
  assert.ok(prompt.includes("deploy-fix/"), "should mention branch naming");
  assert.ok(prompt.includes("DEPLOYMENT_FIX_SUMMARY:"), "should include summary marker");
});

test("extractDeploymentHealingSummary finds marker", () => {
  const summary = extractDeploymentHealingSummary(
    "lots of output\nDEPLOYMENT_FIX_SUMMARY: Added express to dependencies\nmore output",
  );
  assert.equal(summary, "Added express to dependencies");
});

test("extractDeploymentHealingSummary falls back to last line", () => {
  const summary = extractDeploymentHealingSummary("first\nsecond\nthird line");
  assert.equal(summary, "third line");
});

test("extractDeploymentHealingSummary handles empty output", () => {
  const summary = extractDeploymentHealingSummary("");
  assert.equal(summary, "No agent summary provided");
});

test("runDeploymentHealingRepair rejects non-zero agent exits even when commits exist", async () => {
  const result = await runDeploymentHealingRepair({
    repo: "owner/repo",
    platform: "vercel",
    mergeSha: "merge123",
    triggerPrNumber: 42,
    triggerPrTitle: "Add feature",
    triggerPrUrl: "https://github.com/owner/repo/pull/42",
    deploymentLog: "Cannot find module",
    baseBranch: "main",
    repoCloneUrl: "https://github.com/owner/repo.git",
    agent: "claude",
    githubToken: "ghs_test",
    dependencies: {
      ensureRepoCache: async () => ({ repoCacheDir: "/tmp/repo-cache", healed: false }),
      applyFixesWithAgent: async () => ({
        code: 2,
        stdout: "DEPLOYMENT_FIX_SUMMARY: attempted a fix",
        stderr: "agent crashed",
      }),
      runCommand: async (command, args) => {
        assert.equal(command, "git");
        const signature = args.join(" ");
        if (signature.includes("checkout -b")) {
          return { code: 0, stdout: "", stderr: "" };
        }
        if (signature.includes("log merge123..HEAD --oneline")) {
          return { code: 0, stdout: "abc123 fix deployment\n", stderr: "" };
        }
        if (signature.includes("checkout --detach")) {
          return { code: 0, stdout: "", stderr: "" };
        }
        throw new Error(`unexpected git command: ${signature}`);
      },
    },
  });

  assert.equal(result.accepted, false);
  assert.match(result.rejectionReason ?? "", /agent failed \(2\): agent crashed/);
  assert.equal(result.summary, "attempted a fix");
});
