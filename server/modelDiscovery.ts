import { FALLBACK_AGENT_MODELS } from "@shared/schema";
import { runCommand, commandExists } from "./agentRunner";

export type AgentModels = Record<"codex" | "claude", string[]>;

const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000;

let cachedModels: AgentModels = { ...FALLBACK_AGENT_MODELS };
let discoveryTimer: NodeJS.Timeout | null = null;

/**
 * Return the currently known models for each agent.
 */
export function getAgentModels(): AgentModels {
  return cachedModels;
}

/**
 * Discover available models by asking each CLI, then cache the results.
 * Falls back to hardcoded lists when a CLI is missing or fails.
 */
export async function discoverModels(): Promise<AgentModels> {
  const [codexModels, claudeModels] = await Promise.all([
    discoverCodexModels(),
    discoverClaudeModels(),
  ]);

  cachedModels = { codex: codexModels, claude: claudeModels };
  return cachedModels;
}

async function discoverCodexModels(): Promise<string[]> {
  if (!(await commandExists("codex"))) {
    return FALLBACK_AGENT_MODELS.codex;
  }

  try {
    // `codex --help` lists supported model names
    const result = await runCommand("codex", ["--help"], { timeoutMs: 10000 });
    if (result.code !== 0) {
      return FALLBACK_AGENT_MODELS.codex;
    }

    const models = parseModelsFromHelp(result.stdout, "codex");
    return models.length > 0 ? models : FALLBACK_AGENT_MODELS.codex;
  } catch {
    return FALLBACK_AGENT_MODELS.codex;
  }
}

async function discoverClaudeModels(): Promise<string[]> {
  if (!(await commandExists("claude"))) {
    return FALLBACK_AGENT_MODELS.claude;
  }

  try {
    // Try `claude model list` first (added in newer versions)
    const listResult = await runCommand("claude", ["model", "list"], {
      timeoutMs: 15000,
    });
    if (listResult.code === 0 && listResult.stdout.trim()) {
      const models = parseModelListOutput(listResult.stdout);
      if (models.length > 0) {
        return models;
      }
    }

    // Fallback: parse `claude --help` for model references
    const helpResult = await runCommand("claude", ["--help"], {
      timeoutMs: 10000,
    });
    if (helpResult.code === 0) {
      const models = parseModelsFromHelp(helpResult.stdout, "claude");
      if (models.length > 0) {
        return models;
      }
    }

    return FALLBACK_AGENT_MODELS.claude;
  } catch {
    return FALLBACK_AGENT_MODELS.claude;
  }
}

/**
 * Parse a line-oriented model list (one model per line).
 */
function parseModelListOutput(output: string): string[] {
  return output
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#") && !line.startsWith("Available"));
}

/**
 * Parse model names from CLI --help output.
 * Looks for patterns like model identifiers in the text.
 */
function parseModelsFromHelp(output: string, agent: "codex" | "claude"): string[] {
  const pattern =
    agent === "codex"
      ? /\b(gpt-[\w.-]+|o[34][\w-]*|codex-[\w.-]+)\b/g
      : /\b(claude-[\w.-]+)\b/g;

  const matches = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(output)) !== null) {
    matches.add(m[1]);
  }
  return Array.from(matches);
}

/**
 * Start the periodic model discovery background job.
 * Runs immediately on start, then every 3 days.
 */
export function startModelDiscoveryJob(): void {
  if (discoveryTimer) {
    return;
  }

  // Run discovery immediately (non-blocking)
  void discoverModels().catch((err) => {
    console.error("Initial model discovery failed:", err);
  });

  discoveryTimer = setInterval(() => {
    void discoverModels().catch((err) => {
      console.error("Periodic model discovery failed:", err);
    });
  }, THREE_DAYS_MS);
}

/**
 * Stop the periodic model discovery job.
 */
export function stopModelDiscoveryJob(): void {
  if (discoveryTimer) {
    clearInterval(discoveryTimer);
    discoveryTimer = null;
  }
}
