import { constants } from "fs";
import { access, mkdtemp, readFile, readdir, rm } from "fs/promises";
import { homedir, tmpdir } from "os";
import path from "path";
import { spawn } from "child_process";

export type CodingAgent = "codex" | "claude";

export type EvaluationResult = {
  needsFix: boolean;
  reason: string;
};

export type CommandResult = {
  stdout: string;
  stderr: string;
  code: number;
  signal?: NodeJS.Signals | null;
  timedOut?: boolean;
};

export type AgentCommandPaths = Partial<Record<CodingAgent, string | null | undefined>>;

export function getAgentCommandPaths(config: {
  codexCommandPath?: string | null;
  claudeCommandPath?: string | null;
}): AgentCommandPaths {
  return {
    codex: config.codexCommandPath,
    claude: config.claudeCommandPath,
  };
}

export type AgentHealthResult =
  | { ok: true }
  | { ok: false; reason: string };

const AGENTS: CodingAgent[] = ["codex", "claude"];

export type AgentUnavailabilityKind = "auth" | "cli_missing";

const AGENT_AUTH_PATTERNS = [
  "failed to authenticate",
  "authentication_error",
  "invalid authentication credentials",
  "api error: 401",
];

const AGENT_CLI_MISSING_PATTERNS = [
  "cli is not installed",
  "enoent",
];

export function detectAgentUnavailability(message: string): AgentUnavailabilityKind | null {
  const lower = message.toLowerCase();
  if (AGENT_AUTH_PATTERNS.some((needle) => lower.includes(needle))) {
    return "auth";
  }
  if (AGENT_CLI_MISSING_PATTERNS.some((needle) => lower.includes(needle))) {
    return "cli_missing";
  }
  return null;
}

export function isAgentUnavailableError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return detectAgentUnavailability(message) !== null;
}

export async function commandExists(command: string): Promise<boolean> {
  return (await resolveCommandPath(command)) !== null;
}

export async function resolveCommandPath(command: string, commandPaths?: AgentCommandPaths): Promise<string | null> {
  if (!/^[A-Za-z0-9._-]+$/.test(command)) {
    return null;
  }

  if (command === "codex" || command === "claude") {
    const configuredPath = commandPaths?.[command]?.trim();
    if (configuredPath) {
      if (!path.isAbsolute(configuredPath)) {
        return null;
      }
      return await isExecutable(configuredPath) ? configuredPath : null;
    }
  }

  const result = await runCommand("which", [command], {
    timeoutMs: 4000,
  });

  const pathFromCurrentEnv = firstOutputLine(result.stdout);
  if (result.code === 0 && pathFromCurrentEnv) {
    return pathFromCurrentEnv;
  }

  const pathFromKnownInstall = await findKnownInstallPath(command);
  if (pathFromKnownInstall) {
    return pathFromKnownInstall;
  }

  const shell = process.env.SHELL || "/bin/zsh";
  const shellResult = await runCommand(shell, ["-lc", `command -v ${command}`], {
    timeoutMs: 4000,
  });
  const pathFromLoginShell = firstOutputLine(shellResult.stdout);
  if (shellResult.code === 0 && pathFromLoginShell) {
    return pathFromLoginShell;
  }

  return null;
}

export async function runAgentCommand(
  agent: CodingAgent,
  args: string[],
  options?: Parameters<typeof runCommand>[2],
  commandPaths?: AgentCommandPaths,
): Promise<CommandResult> {
  return runCommand((await resolveCommandPath(agent, commandPaths)) ?? agent, args, options);
}

export async function resolveAgent(
  preferred: CodingAgent,
  options?: { allowFallback?: boolean; commandPaths?: AgentCommandPaths },
): Promise<CodingAgent> {
  if (!AGENTS.includes(preferred)) {
    preferred = "codex";
  }

  if (await resolveCommandPath(preferred, options?.commandPaths)) {
    return preferred;
  }

  if (!options?.allowFallback) {
    throw new Error(`Configured coding agent ${preferred} CLI is not installed`);
  }

  const fallback = preferred === "codex" ? "claude" : "codex";
  if (await resolveCommandPath(fallback, options?.commandPaths)) {
    return fallback;
  }

  throw new Error("Neither codex nor claude CLI is installed");
}

export async function checkAgentHealth(
  agent: CodingAgent,
  options?: { commandPaths?: AgentCommandPaths },
): Promise<AgentHealthResult> {
  if (!AGENTS.includes(agent)) {
    return { ok: false, reason: `Unknown coding agent: ${agent}` };
  }

  if (!(await resolveCommandPath(agent, options?.commandPaths))) {
    return { ok: false, reason: `${agent} CLI is not installed` };
  }

  const prompt = "Respond with exactly: ok";
  const result = agent === "codex"
    ? await runAgentCommand(
        "codex",
        [
          "exec",
          "--skip-git-repo-check",
          "--sandbox",
          "read-only",
          prompt,
        ],
        { timeoutMs: 30000 },
        options?.commandPaths,
      )
    : await runAgentCommand(
        "claude",
        [
          "-p",
          "--output-format",
          "text",
          prompt,
        ],
        { timeoutMs: 30000 },
        options?.commandPaths,
      );

  if (result.code !== 0) {
    const detail = summarizeHealthFailure(result);
    return { ok: false, reason: `${agent} health check failed: ${detail}` };
  }

  return { ok: true };
}

export async function evaluateFixNecessityWithAgent(params: {
  agent: CodingAgent;
  cwd: string;
  prompt: string;
  commandPaths?: AgentCommandPaths;
}): Promise<EvaluationResult> {
  const { agent, cwd, prompt, commandPaths } = params;

  const extractionPrompt = [
    "Respond with ONLY valid JSON and nothing else.",
    "Schema: {\"needsFix\": boolean, \"reason\": string}",
    prompt,
  ].join("\n\n");

  if (agent === "codex") {
    const tempDir = await mkdtemp(path.join(tmpdir(), "codex-eval-"));
    const outputFile = path.join(tempDir, "output.txt");

    try {
      const result = await runAgentCommand(
        "codex",
        [
          "exec",
          "--skip-git-repo-check",
          "--sandbox",
          "read-only",
          "-o",
          outputFile,
          extractionPrompt,
        ],
        { cwd, timeoutMs: 180000 },
        commandPaths,
      );

      if (result.code !== 0) {
        throw new Error(`codex evaluation failed (${result.code}): ${result.stderr || result.stdout}`);
      }

      let raw: string;
      try {
        raw = await readFile(outputFile, "utf8");
      } catch (error) {
        if (isMissingFileError(error)) {
          const suffix = result.stderr ? `: ${result.stderr}` : "";
          throw new Error(
            `codex evaluation completed without writing expected output file ${outputFile}${suffix}`,
            { cause: error },
          );
        }
        throw error;
      }
      return parseEvaluationOutput(raw);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  }

  const claudeArgs = [
    "-p",
    "--output-format",
    "text",
    extractionPrompt,
  ];

  const result = await runAgentCommand(
    "claude",
    claudeArgs,
    { cwd, timeoutMs: 180000 },
    commandPaths,
  );

  if (result.code !== 0) {
    throw new Error(`claude evaluation failed (${result.code}): ${result.stderr || result.stdout}`);
  }

  return parseEvaluationOutput(result.stdout);
}

export async function applyFixesWithAgent(params: {
  agent: CodingAgent;
  cwd: string;
  prompt: string;
  env?: NodeJS.ProcessEnv;
  commandPaths?: AgentCommandPaths;
  onStdoutChunk?: (chunk: string) => void;
  onStderrChunk?: (chunk: string) => void;
}): Promise<CommandResult> {
  const { agent, cwd, prompt, env, commandPaths, onStdoutChunk, onStderrChunk } = params;

  if (agent === "codex") {
    const result = await runAgentCommand(
      "codex",
      [
        "exec",
        "--skip-git-repo-check",
        "--full-auto",
        "--sandbox",
        "workspace-write",
        prompt,
      ],
      { cwd, env, timeoutMs: 900000, onStdoutChunk, onStderrChunk },
      commandPaths,
    );

    return result;
  }

  return runAgentCommand(
    "claude",
    [
      "-p",
      "--dangerously-skip-permissions",
      prompt,
    ],
    { cwd, env, timeoutMs: 900000, onStdoutChunk, onStderrChunk },
    commandPaths,
  );
}

function parseEvaluationOutput(output: string): EvaluationResult {
  const trimmed = output.trim();
  if (!trimmed) {
    throw new Error("Agent returned empty output for evaluation");
  }

  const parsed = tryParseJsonFromText(trimmed);
  if (!parsed || typeof parsed !== "object") {
    throw new Error(`Could not parse evaluation JSON from output: ${trimmed.slice(0, 500)}`);
  }

  const candidate = parsed as { needsFix?: unknown; reason?: unknown };

  if (typeof candidate.needsFix !== "boolean") {
    throw new Error("Evaluation output missing boolean 'needsFix'");
  }

  return {
    needsFix: candidate.needsFix,
    reason: typeof candidate.reason === "string" ? candidate.reason : "No reason provided",
  };
}

function tryParseJsonFromText(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    // ignore and attempt extraction below
  }

  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    return null;
  }

  const candidate = text.slice(firstBrace, lastBrace + 1);

  try {
    return JSON.parse(candidate);
  } catch {
    return null;
  }
}

function isMissingFileError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function firstOutputLine(output: string): string | null {
  const line = output
    .split(/\r?\n/)
    .map((candidate) => candidate.trim())
    .find(Boolean);
  return line ?? null;
}

async function findKnownInstallPath(command: string): Promise<string | null> {
  const candidates = await buildKnownInstallCandidates(command);
  for (const candidate of candidates) {
    if (await isExecutable(candidate)) {
      return candidate;
    }
  }
  return null;
}

async function isExecutable(candidate: string): Promise<boolean> {
  try {
    await access(candidate, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

async function buildKnownInstallCandidates(command: string): Promise<string[]> {
  const home = process.env.HOME || process.env.USERPROFILE || homedir();
  const dirs = [
    path.join(home, ".local", "bin"),
    path.join(home, "bin"),
    "/opt/homebrew/bin",
    "/usr/local/bin",
    "/usr/bin",
    "/bin",
  ];

  dirs.push(...await listNvmBinDirs(home));

  const executable = process.platform === "win32" ? `${command}.exe` : command;
  return Array.from(new Set(dirs.map((dir) => path.join(dir, executable))));
}

async function listNvmBinDirs(home: string): Promise<string[]> {
  const nvmNodeRoot = path.join(home, ".nvm", "versions", "node");
  try {
    const entries = await readdir(nvmNodeRoot, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(nvmNodeRoot, entry.name, "bin"))
      .sort()
      .reverse();
  } catch {
    return [];
  }
}

function summarizeHealthFailure(result: CommandResult): string {
  const raw = (result.stderr.trim() || result.stdout.trim() || "no output")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0)
    ?? "no output";
  return raw.length > 220 ? `${raw.slice(0, 217).trimEnd()}...` : raw;
}

export async function runCommand(
  command: string,
  args: string[],
  options?: {
    cwd?: string;
    timeoutMs?: number;
    killTimeoutMs?: number;
    env?: NodeJS.ProcessEnv;
    onStdoutChunk?: (chunk: string) => void;
    onStderrChunk?: (chunk: string) => void;
  },
): Promise<CommandResult> {
  const timeoutMs = options?.timeoutMs ?? 120000;
  const killTimeoutMs = options?.killTimeoutMs ?? 5000;

  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: options?.cwd,
      env: options?.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let killTimer: NodeJS.Timeout | null = null;

    const clearTimers = () => {
      clearTimeout(timer);
      if (killTimer) {
        clearTimeout(killTimer);
        killTimer = null;
      }
    };

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      killTimer = setTimeout(() => {
        child.kill("SIGKILL");
      }, killTimeoutMs);
    }, timeoutMs);

    child.stdout.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      stdout += text;
      options?.onStdoutChunk?.(text);
    });

    child.stderr.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      stderr += text;
      options?.onStderrChunk?.(text);
    });

    child.on("close", (code, signal) => {
      clearTimers();
      const stderrParts = [stderr.trim()];
      if (timedOut) {
        stderrParts.push(`Command timed out after ${timeoutMs}ms`);
      } else if (signal) {
        stderrParts.push(`Command terminated by signal ${signal}`);
      }

      resolve({
        stdout,
        stderr: stderrParts.filter(Boolean).join("\n"),
        code: timedOut ? 124 : (code ?? 1),
        signal,
        timedOut,
      });
    });

    child.on("error", (err) => {
      clearTimers();
      resolve({
        stdout,
        stderr: `${stderr}\n${err.message}`.trim(),
        code: 1,
      });
    });
  });
}

export function summarizeCommandResult(result: CommandResult, fallback: string): string {
  const MAX_CHARS = 2_000;
  const details = (result.stderr || result.stdout).trim();
  const summary = details ? `${fallback}: ${details}` : fallback;

  if (summary.length <= MAX_CHARS) {
    return summary;
  }

  return `${summary.slice(0, MAX_CHARS - "... (truncated)".length)}... (truncated)`;
}
