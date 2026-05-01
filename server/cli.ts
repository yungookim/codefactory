export type CliMode = "web" | "mcp" | "help" | "version";

export type CliLogOptions = {
  level?: "trace" | "debug" | "info" | "warn" | "error" | "fatal";
  logFile?: string;
  noLogFile?: boolean;
};

export type ParsedCliArgs = {
  mode: CliMode;
  log?: CliLogOptions;
  error?: string;
};

const KNOWN_MODES: Record<string, CliMode> = {
  web: "web",
  mcp: "mcp",
};

export function parseCliArgs(argv: string[]): ParsedCliArgs {
  let mode: CliMode | null = null;
  const log: CliLogOptions = {};
  let i = 0;

  while (i < argv.length) {
    const tok = argv[i];

    if (tok === "--help" || tok === "-h") {
      return { mode: "help" };
    }
    if (tok === "--version" || tok === "-v") {
      return { mode: "version" };
    }

    if (tok === "--quiet" || tok === "-q") {
      log.level = "error";
      i += 1;
      continue;
    }
    if (tok === "--verbose") {
      log.level = "debug";
      i += 1;
      continue;
    }
    if (tok === "--debug") {
      log.level = "debug";
      i += 1;
      continue;
    }
    if (tok === "--trace") {
      log.level = "trace";
      i += 1;
      continue;
    }
    if (tok === "--no-log-file") {
      log.noLogFile = true;
      i += 1;
      continue;
    }
    if (tok === "--log-file") {
      const next = argv[i + 1];
      if (!next || next.startsWith("-")) {
        return { mode: "help", error: "--log-file requires a path" };
      }
      log.logFile = next;
      i += 2;
      continue;
    }
    if (tok.startsWith("--log-file=")) {
      log.logFile = tok.slice("--log-file=".length);
      i += 1;
      continue;
    }
    if (tok === "--log-level") {
      const next = argv[i + 1];
      const valid = ["trace", "debug", "info", "warn", "error", "fatal"];
      if (!next || !valid.includes(next)) {
        return { mode: "help", error: `--log-level must be one of ${valid.join(", ")}` };
      }
      log.level = next as CliLogOptions["level"];
      i += 2;
      continue;
    }

    if (mode === null && KNOWN_MODES[tok]) {
      mode = KNOWN_MODES[tok];
      i += 1;
      continue;
    }

    return { mode: "help", error: `Unknown command: ${tok}` };
  }

  const result: ParsedCliArgs = { mode: mode ?? "web" };
  if (log.level || log.logFile || log.noLogFile) {
    result.log = log;
  }
  return result;
}

export function applyLogEnv(log: CliLogOptions | undefined): void {
  if (!log) return;
  if (log.level) process.env.LOG_LEVEL = log.level;
  if (log.noLogFile) process.env.OH_MY_PR_NO_LOG_FILE = "1";
  if (log.logFile) process.env.OH_MY_PR_LOG_FILE = log.logFile;
}

export function formatCliHelp(version: string): string {
  return `
  oh-my-pr v${version}

  Autonomous GitHub PR babysitter — watches repos, triages review
  feedback, and dispatches AI agents to fix code locally.

  Usage:
    oh-my-pr              Start the dashboard server
    oh-my-pr web          Start the dashboard server
    oh-my-pr mcp          Start the MCP server
    oh-my-pr --help       Show this help message
    oh-my-pr --version    Print the version

  Logging options:
    -q, --quiet           Errors only
    --verbose, --debug    Verbose output (debug level)
    --trace               Maximum verbosity
    --log-level <level>   trace | debug | info | warn | error | fatal
    --log-file <path>     Override log file location
    --no-log-file         Disable file logging

  Environment variables:
    PORT                  Server port (default: 5001)
    GITHUB_TOKEN          GitHub personal access token
    OH_MY_PR_HOME         Override config/state directory (~/.oh-my-pr)
    LOG_LEVEL             Same as --log-level

  https://github.com/yungookim/oh-my-pr
`;
}
