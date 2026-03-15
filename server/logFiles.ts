import { appendFileSync, mkdirSync } from "fs";
import path from "path";
import type { LogEntry, PR } from "@shared/schema";

function sanitizeFileSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9_.-]+/g, "__");
}

function formatLogLine(entry: LogEntry): string {
  const parts = [
    entry.timestamp,
    entry.level.toUpperCase(),
  ];

  if (entry.phase) {
    parts.push(`[${entry.phase}]`);
  }

  if (entry.runId) {
    parts.push(`run=${entry.runId}`);
  }

  parts.push(entry.message);

  if (entry.metadata && Object.keys(entry.metadata).length > 0) {
    parts.push(JSON.stringify(entry.metadata));
  }

  return `${parts.join(" ")}\n`;
}

export function appendLogFile(logRootDir: string, pr: Pick<PR, "repo" | "number">, entry: LogEntry): void {
  const day = entry.timestamp.slice(0, 10);
  const directory = path.join(logRootDir, day);
  mkdirSync(directory, { recursive: true });

  const safeRepo = sanitizeFileSegment(pr.repo);
  const filename = `${safeRepo}__${pr.number}.log`;
  const filepath = path.join(directory, filename);
  appendFileSync(filepath, formatLogLine(entry), "utf8");
}
