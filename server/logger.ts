import fs from "fs";
import path from "path";
import { Writable } from "stream";
import pino, { type Level, type Logger, type StreamEntry } from "pino";
import pretty from "pino-pretty";
import { getCodeFactoryPaths } from "./paths";

// ----- Token sanitization -----

const TOKEN_PATTERNS: Array<{ re: RegExp; replace: string }> = [
  // x-access-token:<token>@github.com URLs
  { re: /(x-access-token:)[^@\s"']+/gi, replace: "$1[REDACTED]" },
  // GitHub token prefixes
  { re: /\b(ghp_|gho_|ghs_|ghu_|ghr_)[A-Za-z0-9]{20,}/g, replace: "$1[REDACTED]" },
  { re: /\bgithub_pat_[A-Za-z0-9_]{20,}/g, replace: "github_pat_[REDACTED]" },
  // Bearer / Token authorization headers in free text
  { re: /\b(Bearer\s+)[A-Za-z0-9._-]{16,}/gi, replace: "$1[REDACTED]" },
  { re: /\b(token\s+)[A-Za-z0-9._-]{16,}/gi, replace: "$1[REDACTED]" },
];

export function sanitizeString(s: string): string {
  let out = s;
  for (const { re, replace } of TOKEN_PATTERNS) {
    out = out.replace(re, replace);
  }
  return out;
}

function sanitizeDeep(value: unknown): unknown {
  if (typeof value === "string") return sanitizeString(value);
  if (Array.isArray(value)) return value.map(sanitizeDeep);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = sanitizeDeep(v);
    }
    return out;
  }
  return value;
}

// ----- Ring buffer (for in-app log viewer in PR 2) -----

const RING_SIZE = 5000;
const ring: string[] = new Array<string>();
let ringHead = 0;
let ringFilled = false;

function ringPush(line: string) {
  if (!ringFilled) {
    ring.push(line);
    if (ring.length >= RING_SIZE) {
      ringFilled = true;
      ringHead = 0;
    }
    return;
  }
  ring[ringHead] = line;
  ringHead = (ringHead + 1) % RING_SIZE;
}

export function readRingBuffer(): string[] {
  if (!ringFilled) return ring.slice();
  return [...ring.slice(ringHead), ...ring.slice(0, ringHead)];
}

export function _resetRingBufferForTests() {
  ring.length = 0;
  ringHead = 0;
  ringFilled = false;
}

const ringStream = new Writable({
  write(chunk, _enc, cb) {
    const text = typeof chunk === "string" ? chunk : chunk.toString("utf8");
    for (const line of text.split("\n")) {
      if (line.length > 0) ringPush(line);
    }
    cb();
  },
});

// ----- Level / destination resolution -----

const VALID_LEVELS: Level[] = ["trace", "debug", "info", "warn", "error", "fatal"];

function resolveLevel(): Level {
  const env = (process.env.LOG_LEVEL || "").toLowerCase();
  if ((VALID_LEVELS as string[]).includes(env)) return env as Level;
  return process.env.NODE_ENV === "production" ? "info" : "debug";
}

function resolveLogFilePath(): string | null {
  if (process.env.OH_MY_PR_NO_LOG_FILE === "1") return null;
  const override = process.env.OH_MY_PR_LOG_FILE;
  if (override) return override;
  const dir = getCodeFactoryPaths().logRootDir;
  try {
    fs.mkdirSync(dir, { recursive: true });
    return path.join(dir, "server.log");
  } catch (err) {
    process.stderr.write(
      `logger: could not create log dir ${dir}: ${(err as Error).message}\n`,
    );
    return null;
  }
}

// ----- Pino setup -----

const REDACT_PATHS = [
  "authorization",
  "headers.authorization",
  "*.authorization",
  "config.githubToken",
  "config.GITHUB_TOKEN",
  "GITHUB_TOKEN",
  "token",
  "auth",
];

function buildStreams(): StreamEntry[] {
  const streams: StreamEntry[] = [];

  const isDev = process.env.NODE_ENV !== "production";
  if (isDev && process.stdout.isTTY) {
    const prettyStream = pretty({
      colorize: true,
      translateTime: "SYS:HH:MM:ss",
      ignore: "pid,hostname",
      messageFormat: "{msg}",
    });
    prettyStream.pipe(process.stdout);
    streams.push({ stream: prettyStream });
  } else {
    streams.push({ stream: process.stdout });
  }

  const logFile = resolveLogFilePath();
  if (logFile) {
    streams.push({
      stream: fs.createWriteStream(logFile, { flags: "a" }),
    });
  }

  streams.push({ stream: ringStream });

  return streams;
}

export const logger: Logger = pino(
  {
    level: resolveLevel(),
    base: undefined,
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: { paths: REDACT_PATHS, censor: "[REDACTED]" },
    formatters: {
      log(record) {
        return sanitizeDeep(record) as Record<string, unknown>;
      },
    },
    hooks: {
      logMethod(args, method) {
        // pino call shapes: (msg), (mergeObj, msg), (mergeObj, msg, ...interp)
        if (typeof args[0] === "string") {
          args[0] = sanitizeString(args[0]);
        } else if (args.length >= 2 && typeof args[1] === "string") {
          args[1] = sanitizeString(args[1] as string);
        }
        return method.apply(this, args as Parameters<typeof method>);
      },
    },
  },
  pino.multistream(buildStreams()),
);

export function childLogger(source: string): Logger {
  return logger.child({ source });
}
