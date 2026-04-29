import test from "node:test";
import assert from "node:assert/strict";
import { getRepoAddControlsOpen } from "./repoAddControls";

test("getRepoAddControlsOpen opens add controls when no repositories are tracked", () => {
  assert.equal(getRepoAddControlsOpen(null, 0), true);
});

test("getRepoAddControlsOpen collapses add controls once repositories are tracked", () => {
  assert.equal(getRepoAddControlsOpen(null, 1), false);
});

test("getRepoAddControlsOpen preserves an explicit user toggle", () => {
  assert.equal(getRepoAddControlsOpen(true, 1), true);
  assert.equal(getRepoAddControlsOpen(false, 0), false);
});
