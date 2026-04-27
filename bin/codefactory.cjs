#!/usr/bin/env node
"use strict";

const pkg = require("../package.json");
const { formatCliHelp, parseCliArgs } = require("../dist/cli.cjs");
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
  process.exit(0);
}

process.env.NODE_ENV = process.env.NODE_ENV || "production";
if (parsed.mode === "mcp") {
  require("../dist/mcp.cjs");
} else {
  require("../dist/index.cjs");
}
