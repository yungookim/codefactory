import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "fs/promises";
import os from "os";
import path from "path";
import { SqliteStorage } from "./sqliteStorage";

test("addLog writes both sqlite state and daily log file output", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "codefactory-logs-"));
  const storage = new SqliteStorage(root);

  const pr = await storage.addPR({
    number: 106,
    title: "Example PR",
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

  const entry = await storage.addLog(pr.id, "info", "agent started", {
    phase: "agent",
    runId: "run-1",
  });
  const logs = await storage.getLogs(pr.id);
  assert.equal(logs.at(-1)?.message, "agent started");

  const logPath = path.join(root, "log", entry.timestamp.slice(0, 10), "alex-morgan-o__lolodex__106.log");
  const content = await readFile(logPath, "utf8");
  assert.match(content, /agent started/);
  assert.match(content, /\[agent\]/);
  storage.close();
});
