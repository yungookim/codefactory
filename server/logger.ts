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

function sanitizeDeep(value: unknown, seen = new WeakSet<object>()): unknown {
  if (typeof value === "string") return sanitizeString(value);
  if (value && typeof value === "object") {
    if (seen.has(value)) return "[Circular]";
    seen.add(value);
    try {
      if (Array.isArray(value)) return value.map((item) => sanitizeDeep(item, seen));
      if (value instanceof Error) {
        const out: Record<string, unknown> = {
          name: value.name,
          message: sanitizeString(value.message),
        };
        if (value.stack) out.stack = sanitizeString(value.stack);
        if ("cause" in value) out.cause = sanitizeDeep(value.cause, seen);
        for (const [k, v] of Object.entries(value)) {
          out[k] = sanitizeDeep(v, seen);
        }
        return out;
      }
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        out[k] = sanitizeDeep(v, seen);
      }
      return out;
    } finally {
      seen.delete(value);
    }
  }
  return value;
}

// ----- Ring buffer & structured records (powers /api/server-logs) -----

export type LogLevel = "trace" | "debug" | "info" | "warn" | "error" | "fatal";

export type LogRecord = {
  seq: number;
  time: number;
  level: LogLevel;
  source?: string;
  msg: string;
  fields: Record<string, unknown>;
};

const RING_SIZE = 5000;
const PINO_LEVEL_NAMES: Record<number, LogLevel> = {
  10: "trace",
  20: "debug",
  30: "info",
  40: "warn",
  50: "error",
  60: "fatal",
};
const LOG_LEVEL_RANK: Record<LogLevel, number> = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  fatal: 60,
};

const records: LogRecord[] = [];
let recordsHead = 0;
let recordsFilled = false;
let recordSeq = 0;
let ringStreamBuffer = "";
const subscribers = new Set<(record: LogRecord) => void>();

function pushRecord(record: LogRecord) {
  if (!recordsFilled) {
    records.push(record);
    if (records.length >= RING_SIZE) {
      recordsFilled = true;
      recordsHead = 0;
    }
    return;
  }
  records[recordsHead] = record;
  recordsHead = (recordsHead + 1) % RING_SIZE;
}

function readAllRecords(): LogRecord[] {
  if (!recordsFilled) return records.slice();
  return [...records.slice(recordsHead), ...records.slice(0, recordsHead)];
}

// Back-compat: serialized lines for tests / quick assertions.
export function readRingBuffer(): string[] {
  return readAllRecords().map((r) => JSON.stringify({
    level: LOG_LEVEL_RANK[r.level],
    time: r.time,
    source: r.source,
    msg: r.msg,
    ...r.fields,
  }));
}

export function _resetRingBufferForTests() {
  records.length = 0;
  recordsHead = 0;
  recordsFilled = false;
  recordSeq = 0;
  ringStreamBuffer = "";
  subscribers.clear();
}

function parseLine(line: string): Omit<LogRecord, "seq"> | null {
  if (!line.startsWith("{")) return null;
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(line) as Record<string, unknown>;
  } catch {
    return null;
  }
  const levelNum = typeof parsed.level === "number" ? parsed.level : 30;
  const level = PINO_LEVEL_NAMES[levelNum] ?? "info";
  const time = typeof parsed.time === "string"
    ? Date.parse(parsed.time)
    : typeof parsed.time === "number"
      ? parsed.time
      : Date.now();
  const msg = typeof parsed.msg === "string" ? parsed.msg : "";
  const source = typeof parsed.source === "string" ? parsed.source : undefined;
  const { level: _l, time: _t, msg: _m, source: _s, ...rest } = parsed;
  return { time, level, source, msg, fields: rest };
}

export type ReadLogsOptions = {
  level?: LogLevel;
  source?: string;
  since?: number;
  search?: string;
  limit?: number;
};

export function readLogRecords(opts: ReadLogsOptions = {}): LogRecord[] {
  let out = readAllRecords();

  if (opts.level) {
    const minRank = LOG_LEVEL_RANK[opts.level];
    out = out.filter((r) => LOG_LEVEL_RANK[r.level] >= minRank);
  }
  if (opts.source) {
    out = out.filter((r) => r.source === opts.source);
  }
  if (opts.since !== undefined) {
    const since = opts.since;
    out = out.filter((r) => r.seq > since);
  }
  if (opts.search) {
    const needle = opts.search.toLowerCase();
    out = out.filter((r) =>
      r.msg.toLowerCase().includes(needle)
      || JSON.stringify(r.fields).toLowerCase().includes(needle),
    );
  }
  if (opts.limit && opts.limit > 0) {
    out = out.slice(-opts.limit);
  }
  return out;
}

export function getKnownLogSources(): string[] {
  const seen = new Set<string>();
  for (const r of readAllRecords()) {
    if (r.source) seen.add(r.source);
  }
  return Array.from(seen).sort();
}

export function subscribeToLogs(cb: (record: LogRecord) => void): () => void {
  subscribers.add(cb);
  return () => {
    subscribers.delete(cb);
  };
}

const ringStream = new Writable({
  write(chunk, _enc, cb) {
    ringStreamBuffer += typeof chunk === "string" ? chunk : chunk.toString("utf8");
    const lines = ringStreamBuffer.split("\n");
    ringStreamBuffer = lines.pop() ?? "";
    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (line.length === 0) continue;
      const parsed = parseLine(line);
      if (!parsed) continue;
      recordSeq += 1;
      const record: LogRecord = { seq: recordSeq, ...parsed };
      pushRecord(record);
      if (subscribers.size > 0) {
        subscribers.forEach((sub) => {
          try {
            sub(record);
          } catch (err) {
            console.error("Error in log subscriber:", err);
          }
        });
      }
    }
    cb();
  },
});

export function _writeRingChunkForTests(chunk: string): Promise<void> {
  return new Promise((resolve, reject) => {
    ringStream.write(chunk, (err) => err ? reject(err) : resolve());
  });
}

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
      stream: pino.destination(logFile),
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
        for (let i = 0; i < args.length; i += 1) {
          if (typeof args[i] === "string") {
            args[i] = sanitizeString(args[i] as string);
          }
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
