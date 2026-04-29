import assert from "node:assert/strict";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { MemStorage } from "./memoryStorage";
import { generateSocialChangelog } from "./socialChangelogAgent";

async function withFakeAgent(
  output: { stdout?: string; stderr?: string; code?: number },
  run: () => Promise<void>,
): Promise<void> {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "fake-agent-bin-"));
  const fakeClaudePath = path.join(tempRoot, "claude");
  const originalPath = process.env.PATH;

  try {
    await writeFile(
      fakeClaudePath,
      [
        "#!/usr/bin/env node",
        `process.stdout.write(${JSON.stringify(output.stdout ?? "")});`,
        `process.stderr.write(${JSON.stringify(output.stderr ?? "")});`,
        `process.exit(${output.code ?? 0});`,
        "",
      ].join("\n"),
      "utf8",
    );
    await chmod(fakeClaudePath, 0o755);
    process.env.PATH = [tempRoot, originalPath].filter(Boolean).join(path.delimiter);
    await run();
  } finally {
    process.env.PATH = originalPath;
    await rm(tempRoot, { recursive: true, force: true });
  }
}

test("generateSocialChangelog marks empty successful agent output as error", async () => {
  await withFakeAgent({ stdout: "\n\n", code: 0 }, async () => {
    const storage = new MemStorage();
    const changelog = await storage.createSocialChangelog({
      date: "2026-04-29",
      triggerCount: 5,
      prSummaries: [{
        number: 1,
        title: "Improve automation",
        url: "https://github.com/owner/repo/pull/1",
        author: "octocat",
        repo: "owner/repo",
      }],
      content: null,
      status: "generating",
      error: null,
      completedAt: null,
    });

    await generateSocialChangelog({
      storage,
      changelogId: changelog.id,
      prSummaries: changelog.prSummaries,
      date: changelog.date,
      preferredAgent: "claude",
    });

    const updated = await storage.getSocialChangelog(changelog.id);
    assert.equal(updated?.status, "error");
    assert.equal(updated?.content, null);
    assert.match(updated?.error ?? "", /empty response/i);
  });
});
