#!/usr/bin/env node
"use strict";

const pkg = require("../package.json");
const { applyLogEnv, formatCliHelp, parseCliArgs } = require("../dist/cli.cjs");
const parsed = parseCliArgs(process.argv.slice(2));

if (parsed.mode === "version") {
  console.log(pkg.version);
  process.exit(0);
}

if (parsed.mode === "help") {
  if (parsed.error) {
    console.error(parsed.error);
  }
  console.log(formatCliHelp(pkg.version));
  process.exit(parsed.error ? 1 : 0);
}

process.env.NODE_ENV = process.env.NODE_ENV || "production";
applyLogEnv(parsed.log);
if (parsed.mode === "mcp") {
  require("../dist/mcp.cjs");
} else if (parsed.mode === "web") {
  require("../dist/index.cjs");
} else {
  console.error(`Unsupported mode: ${parsed.mode}`);
  process.exit(1);
}
