import assert from "node:assert/strict";
import test from "node:test";
import type { CommandResult } from "./agentRunner";
import { VercelAdapter, RailwayAdapter } from "./deploymentAdapters";

type RunCommand = (cmd: string, args: string[], opts?: { timeoutMs?: number; cwd?: string }) => Promise<CommandResult>;

function mockRunner(results: Record<string, CommandResult>): RunCommand {
  return async (_cmd: string, args: string[]) => {
    const key = args.join(" ");
    for (const [pattern, result] of Object.entries(results)) {
      if (key.includes(pattern)) return result;
    }
    return { stdout: "", stderr: "unmatched command", code: 1 };
  };
}

function ok(stdout: string): CommandResult {
  return { stdout, stderr: "", code: 0 };
}

test("VercelAdapter.getDeploymentStatus parses ready deployment", async () => {
  const adapter = new VercelAdapter(mockRunner({
    "list": ok(JSON.stringify({
      deployments: [{ uid: "dpl_abc", state: "READY", url: "my-app.vercel.app", meta: { githubCommitSha: "sha123" } }],
    })),
  }));
  const status = await adapter.getDeploymentStatus({ repo: "owner/repo", sha: "sha123" });
  assert.equal(status.state, "ready");
  assert.equal(status.deploymentId, "dpl_abc");
  assert.equal(status.url, "my-app.vercel.app");
});

test("VercelAdapter.getDeploymentStatus returns error for failed deployment", async () => {
  const adapter = new VercelAdapter(mockRunner({
    "list": ok(JSON.stringify({
      deployments: [{ uid: "dpl_abc", state: "ERROR", url: "my-app.vercel.app", meta: { githubCommitSha: "sha123" } }],
    })),
  }));
  const status = await adapter.getDeploymentStatus({ repo: "owner/repo", sha: "sha123" });
  assert.equal(status.state, "error");
});

test("VercelAdapter.getDeploymentStatus returns not_found when no matching deployment", async () => {
  const adapter = new VercelAdapter(mockRunner({
    "list": ok(JSON.stringify({ deployments: [] })),
  }));
  const status = await adapter.getDeploymentStatus({ repo: "owner/repo", sha: "sha123" });
  assert.equal(status.state, "not_found");
});

test("VercelAdapter.getDeploymentLogs returns log output", async () => {
  const adapter = new VercelAdapter(mockRunner({
    "inspect": ok(JSON.stringify({ url: "my-app.vercel.app" })),
    "logs": ok("Build failed: module not found"),
  }));
  const logs = await adapter.getDeploymentLogs({ repo: "owner/repo", deploymentId: "dpl_abc" });
  assert.ok(logs.includes("Build failed"));
});

test("RailwayAdapter.getDeploymentStatus parses success", async () => {
  const adapter = new RailwayAdapter(mockRunner({
    "status": ok(JSON.stringify({ deploymentId: "dep_123", status: "SUCCESS", url: "my-app.up.railway.app" })),
  }));
  const status = await adapter.getDeploymentStatus({ repo: "owner/repo", sha: "sha123" });
  assert.equal(status.state, "ready");
  assert.equal(status.deploymentId, "dep_123");
});

test("RailwayAdapter.getDeploymentStatus returns error for crashed deployment", async () => {
  const adapter = new RailwayAdapter(mockRunner({
    "status": ok(JSON.stringify({ deploymentId: "dep_123", status: "CRASHED", url: null })),
  }));
  const status = await adapter.getDeploymentStatus({ repo: "owner/repo", sha: "sha123" });
  assert.equal(status.state, "error");
});

test("RailwayAdapter.getDeploymentLogs returns log output", async () => {
  const adapter = new RailwayAdapter(mockRunner({
    "logs": ok("Error: cannot find module 'express'"),
  }));
  const logs = await adapter.getDeploymentLogs({ repo: "owner/repo", deploymentId: "dep_123" });
  assert.ok(logs.includes("cannot find module"));
});
