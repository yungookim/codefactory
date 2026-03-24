import { randomUUID } from "crypto";
import {
  agentRunSchema,
  configSchema,
  feedbackItemSchema,
  logEntrySchema,
  prQuestionSchema,
  prSchema,
  socialChangelogSchema,
} from "./schema";
import type {
  AgentRun,
  Config,
  FeedbackItem,
  LogEntry,
  PR,
  PRQuestion,
  SocialChangelog,
} from "./schema";

// ── PR ───────────────────────────────────────────────────────────────────────

export function createPR(data: Omit<PR, "id" | "addedAt">): PR {
  return prSchema.parse({
    ...data,
    id: randomUUID(),
    addedAt: new Date().toISOString(),
  });
}

export function applyPRUpdate(existing: PR, updates: Partial<PR>): PR {
  return prSchema.parse({
    ...existing,
    ...updates,
    // Immutable fields
    id: existing.id,
    addedAt: existing.addedAt,
  });
}

// ── Feedback item ─────────────────────────────────────────────────────────────
// FeedbackItems are always created externally (from GitHub), so no factory is
// needed, but we expose a validator to ensure consistency at ingestion time.

export function parseFeedbackItem(raw: unknown): FeedbackItem {
  return feedbackItemSchema.parse(raw);
}

// ── Log entry ────────────────────────────────────────────────────────────────

export function createLogEntry(
  prId: string,
  level: LogEntry["level"],
  message: string,
  details?: {
    runId?: string | null;
    phase?: string | null;
    metadata?: Record<string, unknown> | null;
  },
): LogEntry {
  return logEntrySchema.parse({
    id: randomUUID(),
    prId,
    runId: details?.runId ?? null,
    timestamp: new Date().toISOString(),
    level,
    phase: details?.phase ?? null,
    message,
    metadata: details?.metadata ?? null,
  });
}

// ── PR question ───────────────────────────────────────────────────────────────

export function createPRQuestion(prId: string, question: string): PRQuestion {
  return prQuestionSchema.parse({
    id: randomUUID(),
    prId,
    question,
    answer: null,
    status: "pending",
    error: null,
    createdAt: new Date().toISOString(),
    answeredAt: null,
  });
}

export function applyPRQuestionUpdate(
  existing: PRQuestion,
  updates: Partial<PRQuestion>,
): PRQuestion {
  return prQuestionSchema.parse({
    ...existing,
    ...updates,
    // Immutable fields
    id: existing.id,
    prId: existing.prId,
    createdAt: existing.createdAt,
  });
}

// ── Agent run ─────────────────────────────────────────────────────────────────

export function createAgentRun(
  data: Omit<AgentRun, "createdAt" | "updatedAt">,
): AgentRun {
  const now = new Date().toISOString();
  return agentRunSchema.parse({
    ...data,
    createdAt: now,
    updatedAt: now,
  });
}

export function touchAgentRun(run: AgentRun, updates: Partial<AgentRun>): AgentRun {
  return agentRunSchema.parse({
    ...run,
    ...updates,
    // Immutable fields
    id: run.id,
    prId: run.prId,
    createdAt: run.createdAt,
    updatedAt: new Date().toISOString(),
  });
}

// ── Social changelog ──────────────────────────────────────────────────────────

export function createSocialChangelog(
  data: Omit<SocialChangelog, "id" | "createdAt">,
): SocialChangelog {
  return socialChangelogSchema.parse({
    ...data,
    id: randomUUID(),
    createdAt: new Date().toISOString(),
  });
}

export function applySocialChangelogUpdate(
  existing: SocialChangelog,
  updates: Partial<SocialChangelog>,
): SocialChangelog {
  return socialChangelogSchema.parse({
    ...existing,
    ...updates,
    // Immutable fields
    id: existing.id,
    createdAt: existing.createdAt,
  });
}

// ── Config ────────────────────────────────────────────────────────────────────

export function applyConfigUpdate(existing: Config, updates: Partial<Config>): Config {
  return configSchema.parse({
    ...existing,
    ...updates,
    watchedRepos: updates.watchedRepos ?? existing.watchedRepos,
    trustedReviewers: updates.trustedReviewers ?? existing.trustedReviewers,
    ignoredBots: updates.ignoredBots ?? existing.ignoredBots,
  });
}
