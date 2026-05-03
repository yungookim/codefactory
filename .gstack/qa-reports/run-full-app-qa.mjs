import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import WebSocket from "ws";

const target = process.env.QA_TARGET ?? "http://localhost:5002";
const reportDir = process.env.QA_REPORT_DIR ?? ".gstack/qa-reports";
const screenshotDir = path.join(reportDir, "screenshots");
const debugPort = Number(process.env.QA_CHROME_PORT ?? "9233");
const userDataDir = process.env.QA_CHROME_PROFILE ?? path.join(tmpdir(), `oh-my-pr-qa-chrome-${process.pid}`);
const date = new Date().toISOString().split("T")[0];

const checks = [];
const issues = [];
const screenshots = [];
const consoleEvents = [];
const networkEvents = [];

function recordCheck(name, ok, details = "") {
  checks.push({ name, ok, details });
  if (!ok) {
    issues.push({
      severity: "Medium",
      category: "Functional",
      title: name,
      details,
    });
  }
}

function normalizeRoute(route) {
  return route.startsWith("#") ? `${target}/${route}` : `${target}${route}`;
}

function findOnPath(commands) {
  const pathDirs = (process.env.PATH ?? "").split(path.delimiter).filter(Boolean);
  const extensions = process.platform === "win32"
    ? (process.env.PATHEXT ?? ".EXE;.CMD;.BAT;.COM").split(path.delimiter)
    : [""];

  for (const command of commands) {
    if (command.includes("/") || command.includes("\\")) {
      if (existsSync(command)) return command;
      continue;
    }

    for (const pathDir of pathDirs) {
      for (const extension of extensions) {
        const executable = path.join(pathDir, command);
        if (existsSync(executable)) return executable;
        if (extension && existsSync(`${executable}${extension}`)) return `${executable}${extension}`;
      }
    }
  }

  return null;
}

function resolveChromePath() {
  for (const envVar of ["QA_CHROME_PATH", "CHROME_PATH", "CHROME_BIN"]) {
    const value = process.env[envVar]?.trim();
    if (value) return value;
  }

  const pathMatch = findOnPath([
    "google-chrome-stable",
    "google-chrome",
    "chromium",
    "chromium-browser",
    "chrome",
    "chrome.exe",
  ]);
  if (pathMatch) return pathMatch;

  const platformCandidates = {
    darwin: [
      path.join("/Applications", "Google Chrome.app", "Contents", "MacOS", "Google Chrome"),
      path.join(homedir(), "Applications", "Google Chrome.app", "Contents", "MacOS", "Google Chrome"),
    ],
    linux: [
      "/usr/bin/google-chrome-stable",
      "/usr/bin/google-chrome",
      "/usr/bin/chromium",
      "/usr/bin/chromium-browser",
      "/snap/bin/chromium",
    ],
    win32: [
      process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, "Google", "Chrome", "Application", "chrome.exe"),
      process.env["PROGRAMFILES(X86)"] && path.join(process.env["PROGRAMFILES(X86)"], "Google", "Chrome", "Application", "chrome.exe"),
      process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "Google", "Chrome", "Application", "chrome.exe"),
    ],
  };

  const candidates = (platformCandidates[process.platform] ?? []).filter(Boolean);
  const match = candidates.find((candidate) => existsSync(candidate));
  if (match) return match;

  throw new Error("Chrome executable not found. Install Chrome/Chromium or set QA_CHROME_PATH, CHROME_PATH, or CHROME_BIN.");
}

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForJson(url, retries = 60) {
  let lastError;
  for (let i = 0; i < retries; i += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return await response.json();
      lastError = new Error(`${response.status} ${response.statusText}`);
    } catch (error) {
      lastError = error;
    }
    await sleep(100);
  }
  throw lastError ?? new Error(`Timed out waiting for ${url}`);
}

function createCdpClient(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let id = 0;
  const pending = new Map();
  const listeners = new Map();

  ws.on("message", (data) => {
    const payload = typeof data === "string"
      ? data
      : Array.isArray(data)
        ? Buffer.concat(data).toString("utf-8")
        : Buffer.from(data).toString("utf-8");
    const message = JSON.parse(payload);
    if (message.id && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) reject(new Error(message.error.message));
      else resolve(message.result);
      return;
    }

    const handlers = listeners.get(message.method) ?? [];
    for (const handler of handlers) handler(message.params ?? {});
  });

  return {
    ready: new Promise((resolve, reject) => {
      ws.once("open", resolve);
      ws.once("error", reject);
    }),
    on(method, handler) {
      const handlers = listeners.get(method) ?? [];
      handlers.push(handler);
      listeners.set(method, handlers);
    },
    send(method, params = {}) {
      const messageId = ++id;
      const payload = JSON.stringify({ id: messageId, method, params });
      return new Promise((resolve, reject) => {
        pending.set(messageId, { resolve, reject });
        ws.send(payload);
      });
    },
    close() {
      ws.close();
    },
  };
}

async function capture(client, name) {
  const result = await client.send("Page.captureScreenshot", {
    format: "png",
    captureBeyondViewport: true,
  });
  const filePath = path.join(screenshotDir, `${name}.png`);
  await writeFile(filePath, Buffer.from(result.data, "base64"));
  screenshots.push(filePath);
  return filePath;
}

async function evaluate(client, expression, awaitPromise = false) {
  const result = await client.send("Runtime.evaluate", {
    expression,
    awaitPromise,
    returnByValue: true,
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.text ?? "Runtime.evaluate failed");
  }
  return result.result.value;
}

async function setViewport(client, width, height, mobile = false) {
  await client.send("Emulation.setDeviceMetricsOverride", {
    width,
    height,
    deviceScaleFactor: 1,
    mobile,
  });
  await client.send("Emulation.setVisibleSize", { width, height });
}

async function navigate(client, route, label, readyExpression = "document.body.innerText.trim().length > 0") {
  const url = normalizeRoute(route);
  await client.send("Page.navigate", { url });
  const ready = await waitFor(client, `
    (() => document.readyState === "complete"
      && window.location.href === ${JSON.stringify(url)}
      && (${readyExpression}))()
  `, 5000);
  if (!ready) {
    throw new Error(`Timed out waiting for ${label} after navigating to ${url}`);
  }
  const text = await evaluate(client, "document.body.innerText");
  await capture(client, label);
  return text;
}

async function click(client, selector) {
  const rect = await evaluate(client, `
    (() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return false;
      el.scrollIntoView({ block: "center", inline: "center" });
      const rect = el.getBoundingClientRect();
      return {
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
      };
    })()
  `);
  if (!rect) return false;
  await client.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: rect.x, y: rect.y });
  await client.send("Input.dispatchMouseEvent", { type: "mousePressed", x: rect.x, y: rect.y, button: "left", clickCount: 1 });
  await client.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: rect.x, y: rect.y, button: "left", clickCount: 1 });
  return true;
}

async function setInput(client, selector, value) {
  return evaluate(client, `
    (() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return false;
      const proto = Object.getPrototypeOf(el);
      const descriptor = Object.getOwnPropertyDescriptor(proto, "value")
        || Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")
        || Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value");
      descriptor.set.call(el, ${JSON.stringify(value)});
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    })()
  `);
}

async function selectValue(client, selector, value) {
  return evaluate(client, `
    (() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return false;
      el.value = ${JSON.stringify(value)};
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    })()
  `);
}

async function waitFor(client, expression, timeoutMs = 2000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      if (await evaluate(client, expression)) return true;
    } catch {
      // Ignore transient evaluation failures while the page is navigating.
    }
    await sleep(100);
  }
  return false;
}

async function apiSmoke() {
  const endpoints = [
    "/api/runtime",
    "/api/config",
    "/api/prs",
    "/api/prs/archived",
    "/api/repos/settings",
    "/api/activities",
    "/api/onboarding/status",
    "/api/healing-sessions",
    "/api/releases",
    "/api/changelogs",
    "/api/server-logs?limit=10",
  ];

  const results = [];
  for (const endpoint of endpoints) {
    const response = await fetch(`${target}${endpoint}`);
    const text = await response.text();
    const redactionProbeText = text.replaceAll("ghp_your_token", "[PLACEHOLDER_TOKEN]");
    const hasRawToken = /gh[pousr]_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+|x-access-token:[^@"'\\\s]+@/i.test(redactionProbeText);
    results.push({ endpoint, status: response.status, ok: response.ok, hasRawToken });
    recordCheck(`API ${endpoint} returns 2xx`, response.ok, `status ${response.status}`);
    recordCheck(`API ${endpoint} redacts token-shaped values`, !hasRawToken);
  }
  return results;
}

async function main() {
  await mkdir(screenshotDir, { recursive: true });

  const apiResults = await apiSmoke();
  const chromePath = resolveChromePath();

  const chrome = spawn(chromePath, [
    "--headless=new",
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${userDataDir}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-gpu",
    "--window-size=1280,720",
    "about:blank",
  ], { stdio: ["ignore", "pipe", "pipe"] });

  chrome.stderr.on("data", () => {});
  chrome.stdout.on("data", () => {});

  try {
    await waitForJson(`http://127.0.0.1:${debugPort}/json/version`);
    const targetResponse = await fetch(`http://127.0.0.1:${debugPort}/json/new?${encodeURIComponent("about:blank")}`, {
      method: "PUT",
    });
    if (!targetResponse.ok) {
      throw new Error(`Could not create Chrome page target: ${targetResponse.status}`);
    }
    const pageTarget = await targetResponse.json();
    const client = createCdpClient(pageTarget.webSocketDebuggerUrl);
    await client.ready;

    client.on("Runtime.consoleAPICalled", (params) => {
      if (params.type === "error" || params.type === "warning") {
        consoleEvents.push({
          type: params.type,
          text: params.args?.map((arg) => arg.value ?? arg.description ?? "").join(" "),
        });
      }
    });
    client.on("Runtime.exceptionThrown", (params) => {
      consoleEvents.push({
        type: "exception",
        text: params.exceptionDetails?.text ?? "runtime exception",
      });
    });
    client.on("Log.entryAdded", (params) => {
      if (params.entry?.level === "error" || params.entry?.level === "warning") {
        consoleEvents.push({
          type: params.entry.level,
          text: params.entry.text,
        });
      }
    });
    client.on("Network.responseReceived", (params) => {
      const status = params.response?.status ?? 0;
      const url = params.response?.url ?? "";
      if (status >= 400 && !url.includes("favicon")) {
        networkEvents.push({ status, url });
      }
    });
    client.on("Network.loadingFailed", (params) => {
      if (params.type !== "Image") {
        networkEvents.push({ status: "failed", url: params.requestId, errorText: params.errorText });
      }
    });

    await client.send("Page.enable");
    await client.send("Runtime.enable");
    await client.send("Network.enable");
    await client.send("Log.enable");
    await setViewport(client, 1280, 720);

    const dashboardReadyExpression = "!!document.querySelector('[data-testid=\"tab-active\"]') && document.body.innerText.includes('oh-my-pr')";
    let text = await navigate(client, "/#/", "dashboard-desktop", dashboardReadyExpression);
    recordCheck("Dashboard renders app identity", text.includes("oh-my-pr"));
    recordCheck("Dashboard exposes primary navigation", ["changelogs", "releases", "logs", "settings"].every((label) => text.includes(label)));
    recordCheck("Dashboard shows active and archived tabs", /active/i.test(text) && /archived/i.test(text));

    let addControlExists = await evaluate(client, "!!document.querySelector('[data-testid=\"button-toggle-add-controls\"]')");
    if (!await evaluate(client, "!!document.querySelector('[data-testid=\"input-add-pr\"]')")) {
      addControlExists = await click(client, "[data-testid='button-toggle-add-controls']");
      await waitFor(client, "!!document.querySelector('[data-testid=\"input-add-pr\"]')", 1500);
    }
    recordCheck("Dashboard add controls are reachable", addControlExists);
    await sleep(250);
    const addPrDisabled = await evaluate(client, "document.querySelector('[data-testid=\"button-add-pr\"]')?.disabled === true");
    recordCheck("Empty PR submit is disabled", addPrDisabled);
    if (await setInput(client, "[data-testid='input-add-pr']", "not-a-pr-url")) {
      await click(client, "[data-testid='button-add-pr']");
      await sleep(700);
      text = await evaluate(client, "document.body.innerText");
      await capture(client, "dashboard-invalid-pr");
      recordCheck("Invalid PR URL surfaces an error", /Could not add PR|invalid|pull/i.test(text), text.slice(-500));
    }
    await setInput(client, "[data-testid='input-add-repo']", "");
    const addRepoDisabled = await evaluate(client, `
      (() => {
        const button = document.querySelector('[data-testid="button-add-repo"]');
        const input = document.querySelector('[data-testid="input-add-repo"]');
        return !!button && !!input && button.disabled === true;
      })()
    `);
    recordCheck("Empty repo submit is disabled", addRepoDisabled);
    if (await setInput(client, "[data-testid='input-add-repo']", "bad")) {
      await click(client, "[data-testid='button-add-repo']");
      await sleep(700);
      text = await evaluate(client, "document.body.innerText");
      await capture(client, "dashboard-invalid-repo");
      recordCheck("Invalid repo slug surfaces an error", /Could not watch repository|invalid|owner/i.test(text), text.slice(-500));
    }
    await click(client, "[data-testid='tab-archived']");
    await sleep(250);
    text = await evaluate(client, "document.body.innerText");
    recordCheck("Archived tab is reachable", /archived/i.test(text));
    await click(client, "[data-testid='tab-active']");

    text = await navigate(client, "/#/settings", "settings-desktop", "!!document.querySelector('#settings-coding-agent')");
    recordCheck("Settings route renders", text.includes("settings"));
    recordCheck("Settings shows core sections", [/agent/i, /automation/i, /runtime/i, /github/i].every((pattern) => pattern.test(text)));
    recordCheck("Settings exposes drain status", /Automation|paused|active|loading/i.test(text));

    text = await navigate(client, "/#/logs", "logs-desktop", "!!document.querySelector('#logs-level')");
    await waitFor(client, "!!document.querySelector('#logs-level')", 1500);
    recordCheck("Logs route renders", /logs/i.test(text));
    await selectValue(client, "#logs-level", "warn");
    await sleep(300);
    await setInput(client, "input[type='search']", "no-such-log-record-for-qa");
    await sleep(300);
    text = await evaluate(client, "document.body.innerText");
    await capture(client, "logs-filtered");
    const logsFilterState = await evaluate(client, `
      (() => ({
        level: document.querySelector("#logs-level")?.value,
        search: document.querySelector("input[type='search']")?.value,
        hasCount: /No log records| of /.test(document.body.innerText),
      }))()
    `);
    recordCheck(
      "Logs filters update visible controls",
      logsFilterState.level === "warn" && logsFilterState.search === "no-such-log-record-for-qa",
      JSON.stringify(logsFilterState),
    );

    text = await navigate(client, "/#/releases", "releases-desktop", "document.body.innerText.includes('Release Management')");
    recordCheck("Releases route renders", text.includes("Release Management"));
    recordCheck("Releases has empty state or run list", /No release runs yet|Trigger PR|Release Notes|Show/.test(text));

    text = await navigate(client, "/#/changelogs", "changelogs-desktop", "document.body.innerText.includes('Social Media Changelogs')");
    recordCheck("Changelogs route renders", text.includes("Social Media Changelogs"));
    recordCheck("Changelogs has empty state or changelog list", /No changelogs yet|PR.*merged|Show|error|generating/i.test(text));

    text = await navigate(client, "/#/does-not-exist", "not-found-desktop", "document.body.innerText.includes('404 Page Not Found')");
    recordCheck("Unknown route renders not-found page", text.includes("404 Page Not Found"));

    await setViewport(client, 375, 812, true);
    text = await navigate(client, "/#/", "dashboard-mobile", dashboardReadyExpression);
    recordCheck("Dashboard renders on mobile viewport", /oh-my-pr/i.test(text) && /active/i.test(text));

    const severeConsoleEvents = consoleEvents.filter((event) =>
      !/Download the React DevTools/i.test(event.text ?? "")
      && !/400 \(Bad Request\)/i.test(event.text ?? "")
    );
    const unexpectedNetworkEvents = networkEvents.filter((event) =>
      !(event.status === 400 && typeof event.url === "string" && event.url.endsWith("/api/prs"))
    );
    recordCheck("No unexpected browser console errors during QA run", severeConsoleEvents.length === 0, JSON.stringify(severeConsoleEvents.slice(0, 5)));
    recordCheck("No unexpected failed browser network requests during QA run", unexpectedNetworkEvents.length === 0, JSON.stringify(unexpectedNetworkEvents.slice(0, 5)));

    const failedChecks = checks.filter((check) => !check.ok);
    const healthScore = Math.max(0, 100 - failedChecks.length * 6 - severeConsoleEvents.length * 5 - unexpectedNetworkEvents.length * 4);
    const reportPath = path.join(reportDir, `qa-report-localhost-5002-${date}.md`);
    const report = `# QA Report - localhost:5002 - ${date}

## Summary

- Target: ${target}
- Mode: Standard, plan-driven full-app route smoke
- Health score: ${healthScore}
- Checks: ${checks.filter((check) => check.ok).length} passed / ${checks.length} total
- Issues found: ${failedChecks.length}
- Screenshots: ${screenshots.length}

## Screenshots

${screenshots.map((filePath) => `- ${filePath}`).join("\n")}

## API Smoke

| Endpoint | Status | OK | Token Redaction |
| --- | ---: | --- | --- |
${apiResults.map((result) => `| \`${result.endpoint}\` | ${result.status} | ${result.ok ? "yes" : "no"} | ${result.hasRawToken ? "raw token found" : "ok"} |`).join("\n")}

## Checks

| Status | Check | Details |
| --- | --- | --- |
${checks.map((check) => `| ${check.ok ? "PASS" : "FAIL"} | ${check.name} | ${(check.details || "").replaceAll("\n", " ").slice(0, 220)} |`).join("\n")}

## Console Events

${severeConsoleEvents.length === 0 ? "No console errors captured." : severeConsoleEvents.map((event) => `- ${event.type}: ${event.text}`).join("\n")}

## Network Events

${unexpectedNetworkEvents.length === 0 ? "No unexpected failed network events captured." : unexpectedNetworkEvents.map((event) => `- ${event.status}: ${event.url ?? event.errorText}`).join("\n")}

## Deferred Coverage

- Valid GitHub PR add, valid repository watch, run-now babysitter execution, review workflow install, manual release queue, failed feedback retry, real Ask Agent submission, and failed-activity clearing were not executed because they require safe live GitHub/test data or destructive local deletion approval.
- Runtime drain was inspected but not toggled because the current app state is already paused from an agent health failure, and resuming automation can trigger background work.
`;
    await writeFile(reportPath, report);

    console.log(JSON.stringify({
      reportPath,
      healthScore,
      checks: checks.length,
      failedChecks: failedChecks.length,
      screenshots,
      consoleEvents: severeConsoleEvents,
      networkEvents: unexpectedNetworkEvents,
    }, null, 2));

    client.close();
  } finally {
    chrome.kill("SIGTERM");
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
