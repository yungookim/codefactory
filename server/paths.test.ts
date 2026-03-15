import test from "node:test";
import assert from "node:assert/strict";
import os from "os";
import path from "path";
import { getCodeFactoryPaths } from "./paths";

test("getCodeFactoryPaths prefers CODEFACTORY_HOME and falls back to ~/.codefactory", () => {
  process.env.CODEFACTORY_HOME = "/tmp/codefactory-test";
  const override = getCodeFactoryPaths();
  assert.equal(override.rootDir, "/tmp/codefactory-test");
  delete process.env.CODEFACTORY_HOME;

  const fallback = getCodeFactoryPaths();
  assert.equal(fallback.rootDir, path.join(os.homedir(), ".codefactory"));
});
