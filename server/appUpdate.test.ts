import assert from "node:assert/strict";
import test from "node:test";
import { fetchAppUpdateStatus } from "./appUpdate";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
    },
  });
}

test("fetchAppUpdateStatus reports a newer stable release", async () => {
  const status = await fetchAppUpdateStatus("1.0.0", async () =>
    jsonResponse(200, {
      tag_name: "v1.2.0",
      html_url: "https://github.com/yungookim/oh-my-pr/releases/tag/v1.2.0",
    }),
  );

  assert.deepEqual(status, {
    currentVersion: "1.0.0",
    latestVersion: "v1.2.0",
    latestReleaseUrl: "https://github.com/yungookim/oh-my-pr/releases/tag/v1.2.0",
    updateAvailable: true,
  });
});

test("fetchAppUpdateStatus skips network checks for non-semver builds", async () => {
  let called = false;

  const status = await fetchAppUpdateStatus("dev", async () => {
    called = true;
    return jsonResponse(200, {
      tag_name: "v9.9.9",
      html_url: "https://github.com/yungookim/oh-my-pr/releases/tag/v9.9.9",
    });
  });

  assert.equal(called, false);
  assert.deepEqual(status, {
    currentVersion: "dev",
    latestVersion: null,
    latestReleaseUrl: "https://github.com/yungookim/oh-my-pr/releases",
    updateAvailable: false,
  });
});

test("fetchAppUpdateStatus falls back quietly when the release check fails", async () => {
  const status = await fetchAppUpdateStatus("1.0.0", async () => {
    throw new Error("network down");
  });

  assert.deepEqual(status, {
    currentVersion: "1.0.0",
    latestVersion: null,
    latestReleaseUrl: "https://github.com/yungookim/oh-my-pr/releases",
    updateAvailable: false,
  });
});
