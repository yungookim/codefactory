export type CliMode = "web" | "mcp" | "help" | "version";

export type ParsedCliArgs = {
  mode: CliMode;
  error?: string;
};

export function parseCliArgs(argv: string[]): ParsedCliArgs {
  const command = argv[0];

  if (!command) {
    return { mode: "web" };
  }

  if (command === "web") {
    return { mode: "web" };
  }

  if (command === "mcp") {
    return { mode: "mcp" };
  }

  if (command === "--help" || command === "-h") {
    return { mode: "help" };
  }

  if (command === "--version" || command === "-v") {
    return { mode: "version" };
  }

  return {
    mode: "help",
    error: `Unknown command: ${command}`,
  };
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

  Environment variables:
    PORT                  Server port (default: 5001)
    GITHUB_TOKEN          GitHub personal access token
    OH_MY_PR_HOME         Override config/state directory (~/.oh-my-pr)

  https://github.com/yungookim/oh-my-pr
`;
}
