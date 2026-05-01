import assert from "node:assert/strict";
import test from "node:test";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

// Configure logger destination BEFORE first import.
const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "ompr-log-"));
const LOG_FILE = path.join(TMP_DIR, "server.log");
process.env.OH_MY_PR_LOG_FILE = LOG_FILE;
process.env.LOG_LEVEL = "info";
process.env.NODE_ENV = "production";

const { logger, sanitizeString, readRingBuffer, _resetRingBufferForTests } = await import("./logger");

function flushAndRead(): Promise<string> {
  return new Promise((resolve) => {
    setTimeout(() => resolve(fs.readFileSync(LOG_FILE, "utf8")), 50);
  });
}

test("sanitizeString redacts ghp_/gho_/ghs_ tokens", () => {
  const out = sanitizeString("auth=ghp_abcdefghijklmnopqrstuvwxyz0123456789");
  assert.match(out, /ghp_\[REDACTED\]/);
  assert.doesNotMatch(out, /abcdefghijkl/);
});

test("sanitizeString redacts github_pat_ tokens", () => {
  const out = sanitizeString("token: github_pat_ABCDEF1234567890_abcdef1234567890");
  assert.match(out, /github_pat_\[REDACTED\]/);
});

test("sanitizeString redacts x-access-token URLs", () => {
  const url = "https://x-access-token:ghs_secret123456789012345@github.com/owner/repo.git";
  const out = sanitizeString(url);
  assert.match(out, /x-access-token:\[REDACTED\]/);
  assert.doesNotMatch(out, /ghs_secret/);
});

test("sanitizeString redacts Bearer / token authorization values", () => {
  assert.match(sanitizeString("Authorization: Bearer abcdef0123456789xyzfoo"), /Bearer \[REDACTED\]/);
  assert.match(sanitizeString("token abcdef0123456789xyzfoo"), /token \[REDACTED\]/i);
});

test("sanitizeString leaves benign strings untouched", () => {
  assert.equal(sanitizeString("hello world"), "hello world");
  assert.equal(sanitizeString("status=ok count=12"), "status=ok count=12");
});

test("logger writes file and redacts tokens in serialized output", async () => {
  logger.info(
    { repo: "https://x-access-token:ghs_secret123456789012345@github.com/o/r.git" },
    "cloning",
  );
  logger.warn("Authorization: Bearer abcdef0123456789xyzfoo");

  const content = await flushAndRead();
  assert.match(content, /\[REDACTED\]/);
  assert.doesNotMatch(content, /ghs_secret/);
  assert.doesNotMatch(content, /abcdef0123456789xyzfoo/);
});

test("redact paths censor structured token fields", async () => {
  logger.info({ headers: { authorization: "Bearer ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" } }, "request");
  const content = await flushAndRead();
  // Either redact paths or sanitizeDeep should win — token must not appear.
  assert.doesNotMatch(content, /ghp_xxxxxxxxxx/);
});

test("ring buffer captures entries", async () => {
  _resetRingBufferForTests();
  for (let i = 0; i < 5; i += 1) logger.info(`ring-msg-${i}`);
  await new Promise((r) => setTimeout(r, 30));
  const buf = readRingBuffer();
  assert.ok(buf.length >= 5);
  assert.match(buf.join("\n"), /ring-msg-0/);
  assert.match(buf.join("\n"), /ring-msg-4/);
});

test.after(() => {
  try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch { /* ignore */ }
});
