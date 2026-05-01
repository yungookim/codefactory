import assert from "node:assert/strict";
import test from "node:test";
import { applyLogEnv, formatCliHelp, parseCliArgs } from "./cli";

test("parseCliArgs defaults to web mode when no subcommand is provided", () => {
  assert.deepEqual(parseCliArgs([]), { mode: "web" });
});

test("parseCliArgs supports web and mcp subcommands", () => {
  assert.deepEqual(parseCliArgs(["web"]), { mode: "web" });
  assert.deepEqual(parseCliArgs(["mcp"]), { mode: "mcp" });
});

test("parseCliArgs recognizes help and version flags", () => {
  assert.deepEqual(parseCliArgs(["--help"]), { mode: "help" });
  assert.deepEqual(parseCliArgs(["-h"]), { mode: "help" });
  assert.deepEqual(parseCliArgs(["--version"]), { mode: "version" });
  assert.deepEqual(parseCliArgs(["-v"]), { mode: "version" });
});

test("parseCliArgs returns help mode with an error for unknown commands", () => {
  assert.deepEqual(parseCliArgs(["wat"]), {
    mode: "help",
    error: "Unknown command: wat",
  });
});

test("parseCliArgs accepts logging flags before the subcommand", () => {
  assert.deepEqual(parseCliArgs(["--quiet", "web"]), {
    mode: "web",
    log: { level: "error" },
  });
  assert.deepEqual(parseCliArgs(["-q"]), {
    mode: "web",
    log: { level: "error" },
  });
});

test("parseCliArgs accepts logging flags after the subcommand", () => {
  assert.deepEqual(parseCliArgs(["web", "--verbose"]), {
    mode: "web",
    log: { level: "debug" },
  });
  assert.deepEqual(parseCliArgs(["mcp", "--debug"]), {
    mode: "mcp",
    log: { level: "debug" },
  });
});

test("parseCliArgs --log-file requires a path", () => {
  assert.deepEqual(parseCliArgs(["--log-file"]), {
    mode: "help",
    error: "--log-file requires a path",
  });
  assert.deepEqual(parseCliArgs(["--log-file", "/tmp/x.log"]), {
    mode: "web",
    log: { logFile: "/tmp/x.log" },
  });
  assert.deepEqual(parseCliArgs(["--log-file=/tmp/y.log"]), {
    mode: "web",
    log: { logFile: "/tmp/y.log" },
  });
});

test("parseCliArgs --no-log-file flag", () => {
  assert.deepEqual(parseCliArgs(["--no-log-file"]), {
    mode: "web",
    log: { noLogFile: true },
  });
});

test("parseCliArgs --log-level validates the value", () => {
  assert.equal(parseCliArgs(["--log-level", "bogus"]).mode, "help");
  assert.deepEqual(parseCliArgs(["--log-level", "warn"]), {
    mode: "web",
    log: { level: "warn" },
  });
  assert.deepEqual(parseCliArgs(["--log-level=error"]), {
    mode: "web",
    log: { level: "error" },
  });
  assert.equal(parseCliArgs(["--log-level=bogus"]).mode, "help");
  assert.deepEqual(parseCliArgs(["--log-level ", "trace"]), {
    mode: "web",
    log: { level: "trace" },
  });
});

test("applyLogEnv writes the expected environment variables", () => {
  const prev = {
    LOG_LEVEL: process.env.LOG_LEVEL,
    OH_MY_PR_LOG_FILE: process.env.OH_MY_PR_LOG_FILE,
    OH_MY_PR_NO_LOG_FILE: process.env.OH_MY_PR_NO_LOG_FILE,
  };
  delete process.env.LOG_LEVEL;
  delete process.env.OH_MY_PR_LOG_FILE;
  delete process.env.OH_MY_PR_NO_LOG_FILE;

  try {
    applyLogEnv({ level: "warn", logFile: "/tmp/foo.log" });
    assert.equal(process.env.LOG_LEVEL, "warn");
    assert.equal(process.env.OH_MY_PR_LOG_FILE, "/tmp/foo.log");
    assert.equal(process.env.OH_MY_PR_NO_LOG_FILE, undefined);

    applyLogEnv({ noLogFile: true });
    assert.equal(process.env.OH_MY_PR_NO_LOG_FILE, "1");

    applyLogEnv(undefined);
  } finally {
    if (prev.LOG_LEVEL === undefined) delete process.env.LOG_LEVEL; else process.env.LOG_LEVEL = prev.LOG_LEVEL;
    if (prev.OH_MY_PR_LOG_FILE === undefined) delete process.env.OH_MY_PR_LOG_FILE; else process.env.OH_MY_PR_LOG_FILE = prev.OH_MY_PR_LOG_FILE;
    if (prev.OH_MY_PR_NO_LOG_FILE === undefined) delete process.env.OH_MY_PR_NO_LOG_FILE; else process.env.OH_MY_PR_NO_LOG_FILE = prev.OH_MY_PR_NO_LOG_FILE;
  }
});

test("formatCliHelp reflects the web-first command surface", () => {
  const help = formatCliHelp("1.2.3");

  assert.match(help, /oh-my-pr v1\.2\.3/);
  assert.match(help, /oh-my-pr\s+Start the dashboard server/);
  assert.match(help, /oh-my-pr web\s+Start the dashboard server/);
  assert.match(help, /oh-my-pr mcp\s+Start the MCP server/);
  assert.match(help, /--quiet/);
  assert.match(help, /--log-file/);
});
