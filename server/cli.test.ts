import assert from "node:assert/strict";
import test from "node:test";
import { formatCliHelp, parseCliArgs } from "./cli";

test("parseCliArgs defaults to tui mode when no subcommand is provided", () => {
  assert.deepEqual(parseCliArgs([]), { mode: "tui" });
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

test("formatCliHelp reflects the tui-first command surface", () => {
  const help = formatCliHelp("1.2.3");

  assert.match(help, /oh-my-pr v1\.2\.3/);
  assert.match(help, /oh-my-pr\s+Start the terminal UI/);
  assert.match(help, /oh-my-pr web\s+Start the dashboard server/);
  assert.match(help, /oh-my-pr mcp\s+Start the MCP server/);
});
