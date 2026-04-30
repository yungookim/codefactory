import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const APP_NAME = "oh-my-pr";

async function readProjectFile(path: string): Promise<string> {
  return readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

test("live app branding uses oh-my-pr instead of Code Factory", async () => {
  const files = [
    "client/index.html",
    "client/src/pages/dashboard.tsx",
    "client/src/pages/changelogs.tsx",
    "client/src/pages/releases.tsx",
    "src-tauri/tauri.conf.json",
    "src-tauri/src/lib.rs",
    "src-tauri/Cargo.toml",
    "src-tauri/Cargo.lock",
    "src-tauri/icons/icon.svg",
    "docs/public/_site/configuration.html",
    "server/localOnly.ts",
    "server/sqliteStorage.ts",
    "server/prQuestionAgent.ts",
    "server/mcp.ts",
  ];

  const contents = await Promise.all(files.map(async (file) => [file, await readProjectFile(file)] as const));
  for (const [file, content] of contents) {
    assert.doesNotMatch(content, /Code Factory|code factory|code-factory|PR Feedback Agent/, file);
    assert.match(content, new RegExp(APP_NAME.replaceAll("-", "\\-")), file);
  }
});

test("standalone metadata names the app oh-my-pr", async () => {
  const tauriConfig = JSON.parse(await readProjectFile("src-tauri/tauri.conf.json"));
  const cargoToml = await readProjectFile("src-tauri/Cargo.toml");

  assert.equal(tauriConfig.productName, APP_NAME);
  assert.equal(tauriConfig.identifier, "com.yungookim.ohmypr");
  assert.equal(tauriConfig.app.windows[0].title, APP_NAME);
  assert.match(cargoToml, /^name = "oh-my-pr"$/m);
});
