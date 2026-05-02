import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

async function readProjectFile(relativePath: string) {
  return readFile(path.resolve(process.cwd(), relativePath), "utf-8");
}

function assertContainsAll(source: string, labels: Array<[string, string]>) {
  for (const [label, needle] of labels) {
    assert.ok(
      source.includes(needle),
      `Expected ${label} to include ${JSON.stringify(needle)}`,
    );
  }
}

test("full app QA route matrix is wired through the hash router", async () => {
  const source = await readProjectFile("client/src/App.tsx");

  assertContainsAll(source, [
    ["hash router", "useHashLocation"],
    ["dashboard route", '<Route path="/" component={Dashboard} />'],
    ["settings route", '<Route path="/settings" component={Settings} />'],
    ["changelogs route", '<Route path="/changelogs" component={Changelogs} />'],
    ["releases route", '<Route path="/releases" component={Releases} />'],
    ["logs route", '<Route path="/logs" component={Logs} />'],
    ["not found fallback", "<Route component={NotFound} />"],
  ]);
});

test("dashboard keeps the QA-tested PR, repo, feedback, and side-panel workflows wired", async () => {
  const source = await readProjectFile("client/src/pages/dashboard.tsx");

  assertContainsAll(source, [
    ["active tab", 'data-testid="tab-active"'],
    ["archived tab", 'data-testid="tab-archived"'],
    ["add controls toggle", 'data-testid="button-toggle-add-controls"'],
    ["add PR input", 'data-testid="input-add-pr"'],
    ["add PR submit", 'data-testid="button-add-pr"'],
    ["watch repo input", 'data-testid="input-add-repo"'],
    ["watch repo submit", 'data-testid="button-add-repo"'],
    ["repo tracking scope control", "WatchScopeControl"],
    ["tracked repo settings", 'data-testid={`tracked-repo-${repo.repo.replace("/", "-")}`}'],
    ["run-now action", 'data-testid="button-apply"'],
    ["pause-resume watch action", 'data-testid="button-toggle-watch"'],
    ["feedback retry action", "retryMutation"],
    ["feedback manual decisions", '["accept", "reject", "flag"]'],
    ["CI healing panel", 'data-testid="panel-ci-healing"'],
    ["ask agent tab", 'data-testid="tab-ask"'],
    ["activity tab", 'data-testid="tab-activity"'],
    ["ask input", 'data-testid="input-question"'],
    ["ask submit", 'data-testid="button-ask"'],
  ]);

  assertContainsAll(source, [
    ["active PR API", 'queryKey: ["/api/prs"]'],
    ["archived PR API", 'queryKey: ["/api/prs/archived"]'],
    ["repo settings API", 'queryKey: ["/api/repos/settings"]'],
    ["activity API", 'queryKey: ["/api/activities"]'],
    ["config API", 'queryKey: ["/api/config"]'],
    ["healing session API", '"/api/healing-sessions"'],
    ["add PR mutation", 'apiRequest("POST", "/api/prs"'],
    ["watch repo mutation", 'apiRequest("POST", "/api/repos"'],
    ["sync repos mutation", 'apiRequest("POST", "/api/repos/sync"'],
    ["manual release mutation", 'apiRequest("POST", "/api/repos/release"'],
    ["failed activity clear mutation", 'apiRequest("DELETE", "/api/activities/failed"'],
    ["ask agent mutation", 'apiRequest("POST", `/api/prs/${prId}/questions`'],
  ]);
});

test("settings keeps the QA-tested configuration, token, and runtime controls wired", async () => {
  const source = await readProjectFile("client/src/pages/settings.tsx");

  assertContainsAll(source, [
    ["settings config query", 'queryKey: ["/api/config"]'],
    ["runtime query", 'queryKey: ["/api/runtime"]'],
    ["config mutation", 'apiRequest("PATCH", "/api/config"'],
    ["drain mutation", 'apiRequest("POST", "/api/runtime/drain"'],
    ["coding agent selector", 'id="settings-coding-agent"'],
    ["fallback toggle", 'data-testid="checkbox-fallback-to-next-coding-agent"'],
    ["auto resolve conflicts toggle", 'data-testid="checkbox-auto-resolve-conflicts"'],
    ["auto update docs toggle", 'data-testid="checkbox-auto-update-docs"'],
    ["runtime drain button", 'data-testid="button-toggle-drain"'],
    ["runtime drain status", 'data-testid="text-drain-status"'],
    ["ordered GitHub tokens", "githubTokens"],
    ["release automation toggle", 'data-testid="checkbox-auto-create-releases"'],
  ]);
});

test("logs route keeps the QA-tested filtering, streaming, copy, and download surface wired", async () => {
  const source = await readProjectFile("client/src/pages/logs.tsx");

  assertContainsAll(source, [
    ["server logs API", "/api/server-logs?"],
    ["server logs stream API", "/api/server-logs/stream?since="],
    ["level filter", 'id="logs-level"'],
    ["source filter", 'id="logs-source"'],
    ["search input", 'type="search"'],
    ["follow tail toggle", "follow tail"],
    ["copy action", "navigator.clipboard.writeText"],
    ["download action", "oh-my-pr-logs-"],
  ]);
});

test("release and changelog routes keep the QA-tested list, expand, copy, and retry surfaces wired", async () => {
  const releases = await readProjectFile("client/src/pages/releases.tsx");
  const changelogs = await readProjectFile("client/src/pages/changelogs.tsx");

  assertContainsAll(releases, [
    ["release route query", 'queryKey: ["/api/releases"]'],
    ["release retry mutation", 'apiRequest("POST", `/api/releases/${id}/retry`)'],
    ["release page title", "Release Management"],
    ["release notes copy", "CopyButton"],
    ["open release link", "open release"],
    ["empty release state", "No release runs yet."],
  ]);

  assertContainsAll(changelogs, [
    ["changelog route query", 'queryKey: ["/api/changelogs"]'],
    ["changelog page title", "Social Media Changelogs"],
    ["Twitter/X parser", "Twitter / X Thread"],
    ["LinkedIn parser", "LinkedIn"],
    ["changelog copy", "CopyButton"],
    ["empty changelog state", "No changelogs yet."],
  ]);
});
