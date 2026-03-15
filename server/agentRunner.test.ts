import assert from "node:assert/strict";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { evaluateFixNecessityWithAgent, runCommand } from "./agentRunner";

test("runCommand reports a timeout even when the child exits 0 after SIGTERM", async () => {
  const result = await runCommand(
    process.execPath,
    [
      "-e",
      "process.on('SIGTERM', () => process.exit(0)); setInterval(() => {}, 1000);",
    ],
    { timeoutMs: 50 },
  );

  assert.equal(result.code, 124);
  assert.equal(result.timedOut, true);
  assert.match(result.stderr, /timed out after 50ms/i);
});

test("evaluateFixNecessityWithAgent throws a clear error when codex writes no output file", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "fake-codex-bin-"));
  const fakeCodexPath = path.join(tempRoot, "codex");
  const originalPath = process.env.PATH;

  try {
    await writeFile(fakeCodexPath, "#!/bin/sh\nexit 0\n", "utf8");
    await chmod(fakeCodexPath, 0o755);
    process.env.PATH = [tempRoot, originalPath].filter(Boolean).join(path.delimiter);

    await assert.rejects(
      () =>
        evaluateFixNecessityWithAgent({
          agent: "codex",
          cwd: process.cwd(),
          prompt: "Respond with JSON.",
        }),
      /without writing expected output file/,
    );
  } finally {
    process.env.PATH = originalPath;
    await rm(tempRoot, { recursive: true, force: true });
  }
});
