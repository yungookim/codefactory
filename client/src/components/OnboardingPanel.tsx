import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";

type CodeReviewPresence = {
  claude: boolean;
  codex: boolean;
  gemini: boolean;
};

type RepoOnboardingStatus = {
  repo: string;
  accessible: boolean;
  error?: string;
  codeReviews: CodeReviewPresence;
};

type OnboardingStatus = {
  githubConnected: boolean;
  githubError?: string;
  githubUser?: string;
  repos: RepoOnboardingStatus[];
};

type InstallableTool = "claude" | "codex";
type ReviewTool = InstallableTool | "gemini";

const CLAUDE_WORKFLOW = `name: Claude Code Review

on:
  pull_request:
    types: [opened, synchronize, reopened]

jobs:
  code-review:
    if: github.actor != 'dependabot[bot]'
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pull-requests: write
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - uses: anthropics/claude-code-action@v1
        with:
          anthropic_api_key: \${{ secrets.ANTHROPIC_API_KEY }}
          prompt: "Review this pull request for code quality, correctness, and security. Post your findings as review comments."
`;

const CODEX_WORKFLOW = `name: Codex Code Review

on:
  pull_request:
    types: [opened, synchronize, reopened]

jobs:
  code-review:
    if: github.actor != 'dependabot[bot]'
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pull-requests: write
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - uses: openai/codex-action@v1
        with:
          openai-api-key: \${{ secrets.OPENAI_API_KEY }}
          prompt: |
            Review this pull request. Focus on:
            - Code correctness and potential bugs
            - Security issues
            - Performance concerns
            - Code style and readability
            Post your review as GitHub PR review comments.
`;

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <button
      onClick={handleCopy}
      className="shrink-0 border border-border px-2 py-0.5 text-[10px] uppercase tracking-wider transition-colors hover:bg-foreground hover:text-background"
    >
      {copied ? "copied" : "copy"}
    </button>
  );
}

function CodeBlock({ code }: { code: string }) {
  return (
    <div className="relative mt-1">
      <div className="flex items-center justify-between border border-border bg-muted/30 px-2 py-1">
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">yaml</span>
        <CopyButton text={code} />
      </div>
      <pre className="overflow-x-auto border border-t-0 border-border bg-muted/10 p-3 text-[11px] leading-relaxed">
        <code>{code}</code>
      </pre>
    </div>
  );
}

function InlineCode({ children }: { children: string }) {
  return (
    <code className="rounded border border-border bg-muted/30 px-1 py-0.5 text-[11px] font-mono">
      {children}
    </code>
  );
}

function Step({ number, children }: { number: number; children: React.ReactNode }) {
  return (
    <div className="flex gap-2.5">
      <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center border border-border text-[10px] text-muted-foreground">
        {number}
      </span>
      <div className="flex-1 text-[12px] leading-relaxed">{children}</div>
    </div>
  );
}

function GitHubSetupSection() {
  const [showPAT, setShowPAT] = useState(false);

  return (
    <div className="space-y-3">
      <p className="text-[12px] text-muted-foreground">
        Code Factory needs a GitHub token to read repositories and sync PR feedback. Choose one of these options:
      </p>

      <div className="space-y-2">
        <div className="border border-border p-3 space-y-2">
          <div className="text-[11px] font-medium uppercase tracking-wider">Option A — GitHub CLI (recommended)</div>
          <Step number={1}>
            Install the GitHub CLI from{" "}
            <a href="https://cli.github.com" target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">
              cli.github.com
            </a>
          </Step>
          <Step number={2}>
            Run <InlineCode>gh auth login</InlineCode> and follow the prompts to authenticate.
          </Step>
          <Step number={3}>
            Restart Code Factory — it will automatically detect your token via <InlineCode>gh auth token</InlineCode>.
          </Step>
        </div>

        <div className="border border-border p-3 space-y-2">
          <div className="text-[11px] font-medium uppercase tracking-wider">Option B — Environment variable</div>
          <Step number={1}>
            Create a Personal Access Token at{" "}
            <a href="https://github.com/settings/tokens" target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">
              github.com/settings/tokens
            </a>
            {" "}with <InlineCode>repo</InlineCode> and <InlineCode>read:user</InlineCode> scopes.
          </Step>
          <Step number={2}>
            Set it before starting the app: <InlineCode>export GITHUB_TOKEN=ghp_your_token</InlineCode>
          </Step>
        </div>

        <div className="border border-border p-3 space-y-2">
          <button
            onClick={() => setShowPAT(!showPAT)}
            className="flex w-full items-center justify-between text-[11px] font-medium uppercase tracking-wider"
          >
            <span>Option C — Enter token in settings</span>
            <span className="text-muted-foreground">{showPAT ? "▲" : "▼"}</span>
          </button>
          {showPAT && (
            <div className="space-y-2 pt-1">
              <Step number={1}>
                Create a{" "}
                <a href="https://github.com/settings/tokens" target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">
                  Personal Access Token
                </a>
                {" "}with <InlineCode>repo</InlineCode> and <InlineCode>read:user</InlineCode> scopes.
              </Step>
              <Step number={2}>
                Paste it via the API: <InlineCode>curl -X PATCH http://localhost:5001/api/config -H 'Content-Type: application/json' -d '{"{"}\"githubToken\":\"ghp_your_token\"{"}"}'</InlineCode>
              </Step>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function InstallButton({
  repo,
  tool,
  onInstalled,
}: {
  repo: string;
  tool: InstallableTool;
  onInstalled: (url: string) => void;
}) {
  const [installedUrl, setInstalledUrl] = useState<string | null>(null);

  const installMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/onboarding/install-review", { repo, tool });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { error?: string }).error ?? "Installation failed");
      }
      return res.json() as Promise<{ path: string; url: string }>;
    },
    onSuccess: (data) => {
      setInstalledUrl(data.url);
      onInstalled(data.url);
      // Refresh onboarding status so the tool shows as installed
      void queryClient.invalidateQueries({ queryKey: ["/api/onboarding/status"] });
    },
  });

  if (installedUrl) {
    return (
      <a
        href={installedUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="border border-green-600 bg-green-600/10 px-3 py-1 text-[11px] uppercase tracking-wider text-green-500 transition-colors hover:bg-green-600/20"
      >
        Installed — view on GitHub →
      </a>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={() => installMutation.mutate()}
        disabled={installMutation.isPending}
        className="border border-foreground bg-foreground px-3 py-1 text-[11px] uppercase tracking-wider text-background transition-colors hover:bg-foreground/80 disabled:opacity-50"
      >
        {installMutation.isPending ? "Installing…" : "Install workflow"}
      </button>
      {installMutation.isError && (
        <span className="text-[11px] text-destructive">
          {installMutation.error instanceof Error ? installMutation.error.message : "Failed"}
        </span>
      )}
    </div>
  );
}

function ReviewToolSetup({ tool, repo }: { tool: ReviewTool; repo: string }) {
  const [expanded, setExpanded] = useState(false);
  const [installedUrl, setInstalledUrl] = useState<string | null>(null);

  const labels: Record<ReviewTool, string> = {
    claude: "Claude Code Review",
    codex: "Codex Code Review",
    gemini: "Gemini Code Review",
  };

  const descriptions: Record<ReviewTool, string> = {
    claude: "Anthropic's Claude reviews PRs and posts inline comments via GitHub Actions.",
    codex: "OpenAI's Codex reviews PRs and posts inline comments via GitHub Actions.",
    gemini: "Google's Gemini reviews PRs automatically as a GitHub App — no workflow file needed.",
  };

  return (
    <div className="border border-border">
      <div className="flex items-center justify-between px-3 py-2">
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex flex-1 items-center gap-2 text-left transition-colors hover:opacity-70"
        >
          <span className="text-[11px] font-medium">{labels[tool]}</span>
          {installedUrl ? (
            <span className="border border-green-600 px-1 py-0 text-[10px] uppercase tracking-wider text-green-500">installed</span>
          ) : (
            <span className="border border-border px-1 py-0 text-[10px] uppercase tracking-wider text-muted-foreground">not installed</span>
          )}
          <span className="text-[10px] text-muted-foreground">{expanded ? "▲" : "▼"}</span>
        </button>

        {/* One-click install for Claude and Codex */}
        {(tool === "claude" || tool === "codex") && !installedUrl && (
          <InstallButton
            repo={repo}
            tool={tool}
            onInstalled={(url) => setInstalledUrl(url)}
          />
        )}
        {installedUrl && (
          <a
            href={installedUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[11px] text-green-500 underline underline-offset-2"
          >
            View →
          </a>
        )}
      </div>

      {expanded && (
        <div className="border-t border-border px-3 py-3 space-y-3">
          <p className="text-[12px] text-muted-foreground">{descriptions[tool]}</p>

          {tool === "claude" && (
            <div className="space-y-3">
              <div className="border border-amber-500/30 bg-amber-500/5 p-2 text-[11px] text-muted-foreground">
                The <strong>Install workflow</strong> button above creates the file in your repo automatically.
                You still need to complete steps 1–2 below for the action to authenticate.
              </div>
              <Step number={1}>
                Install the{" "}
                <a href="https://github.com/apps/claude" target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">
                  Claude GitHub App
                </a>
                {" "}to your repository. (Or run <InlineCode>/install-github-app</InlineCode> inside Claude Code.)
              </Step>
              <Step number={2}>
                Add your Anthropic API key as a repository secret named <InlineCode>ANTHROPIC_API_KEY</InlineCode> in{" "}
                <a
                  href={`https://github.com/${repo}/settings/secrets/actions`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline underline-offset-2"
                >
                  {repo} › Settings › Secrets
                </a>.
              </Step>
              <Step number={3}>
                The workflow file will be created automatically when you click <strong>Install workflow</strong>. Or add it manually:
                <CodeBlock code={CLAUDE_WORKFLOW} />
              </Step>
              <p className="text-[11px] text-muted-foreground">
                Docs:{" "}
                <a href="https://github.com/anthropics/claude-code-action" target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">
                  anthropics/claude-code-action
                </a>
                {" "}·{" "}
                <a href="https://github.com/marketplace/actions/claude-code-action-official" target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">
                  GitHub Marketplace
                </a>
              </p>
            </div>
          )}

          {tool === "codex" && (
            <div className="space-y-3">
              <div className="border border-amber-500/30 bg-amber-500/5 p-2 text-[11px] text-muted-foreground">
                The <strong>Install workflow</strong> button above creates the file in your repo automatically.
                You still need to add the secret in step 1 below.
              </div>
              <Step number={1}>
                Add your OpenAI API key as a repository secret named <InlineCode>OPENAI_API_KEY</InlineCode> in{" "}
                <a
                  href={`https://github.com/${repo}/settings/secrets/actions`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline underline-offset-2"
                >
                  {repo} › Settings › Secrets
                </a>.
              </Step>
              <Step number={2}>
                The workflow file will be created automatically when you click <strong>Install workflow</strong>. Or add it manually:
                <CodeBlock code={CODEX_WORKFLOW} />
              </Step>
              <Step number={3}>
                <strong>Optional:</strong> For automatic reviews on every PR without a workflow, enable{" "}
                <a href="https://developers.openai.com/codex/cloud/code-review" target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">
                  Codex Cloud Code Review
                </a>
                {" "}in your Codex settings and turn on Automatic reviews. Then tag <InlineCode>@codex review</InlineCode> in any PR comment.
              </Step>
              <p className="text-[11px] text-muted-foreground">
                Docs:{" "}
                <a href="https://github.com/openai/codex-action" target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">
                  openai/codex-action
                </a>
                {" "}·{" "}
                <a href="https://developers.openai.com/codex/github-action" target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">
                  OpenAI Docs
                </a>
              </p>
            </div>
          )}

          {tool === "gemini" && (
            <div className="space-y-3">
              <div className="border border-border p-2 text-[11px] text-muted-foreground">
                <strong>Note:</strong> Gemini Code Assist is a GitHub App installed via the marketplace — it cannot be installed by pushing a workflow file.
              </div>
              <Step number={1}>
                Go to the{" "}
                <a href="https://github.com/marketplace/gemini-code-assist" target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">
                  Gemini Code Assist GitHub Marketplace page
                </a>{" "}
                and click <strong>Install</strong>.
              </Step>
              <Step number={2}>
                Select your organization and the repositories you want to enable, including <InlineCode>{repo}</InlineCode>.
              </Step>
              <Step number={3}>
                Accept the Google Terms of Service and complete setup. Gemini will automatically review new PRs within minutes.
              </Step>
              <Step number={4}>
                <strong>Optional:</strong> Customize behavior by adding a <InlineCode>.gemini/config.yaml</InlineCode> or a code review style guide to your repo.
              </Step>
              <p className="text-[11px] text-muted-foreground">
                <strong>Alternative — Gemini CLI GitHub Action (beta, no-cost):</strong> Download{" "}
                <a href="https://github.com/google-github-actions/run-gemini-cli" target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">
                  Gemini CLI ≥0.1.18
                </a>
                , run <InlineCode>gemini /setup-github</InlineCode>, and copy the generated workflows into <InlineCode>.github/workflows/</InlineCode>.
              </p>
              <p className="text-[11px] text-muted-foreground">
                Docs:{" "}
                <a href="https://developers.google.com/gemini-code-assist/docs/set-up-code-assist-github" target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">
                  Set up Gemini Code Assist on GitHub
                </a>
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function RepoSetupSection({ repoStatus }: { repoStatus: RepoOnboardingStatus }) {
  const missing = (["claude", "codex", "gemini"] as ReviewTool[]).filter((t) => !repoStatus.codeReviews[t]);

  if (repoStatus.accessible && missing.length === 0) return null;

  return (
    <div className="space-y-2">
      <div className="text-[11px] font-medium">
        <a
          href={`https://github.com/${repoStatus.repo}`}
          target="_blank"
          rel="noopener noreferrer"
          className="underline underline-offset-2"
        >
          {repoStatus.repo}
        </a>
      </div>

      {!repoStatus.accessible ? (
        <p className="text-[12px] text-destructive">
          Cannot access this repository: {repoStatus.error ?? "unknown error"}
        </p>
      ) : (
        <div className="space-y-1">
          <p className="text-[11px] text-muted-foreground">
            No AI code review tools detected. Install one or more to get automated PR feedback:
          </p>
          <div className="space-y-1">
            {missing.map((tool) => (
              <ReviewToolSetup key={tool} tool={tool} repo={repoStatus.repo} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function OnboardingPanel() {
  const [dismissed, setDismissed] = useState(false);
  const [expanded, setExpanded] = useState(true);

  const { data: status, isLoading } = useQuery<OnboardingStatus>({
    queryKey: ["/api/onboarding/status"],
    refetchInterval: 30000,
  });

  if (isLoading || !status) return null;

  const reposNeedingSetup = status.repos.filter(
    (r) => !r.accessible || (!r.codeReviews.claude && !r.codeReviews.codex && !r.codeReviews.gemini),
  );

  const hasIssues = !status.githubConnected || reposNeedingSetup.length > 0;

  if (!hasIssues || dismissed) return null;

  return (
    <div className="shrink-0 border-b border-amber-500/30 bg-amber-500/5">
      <div className="flex items-center justify-between px-4 py-2">
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-2 text-left"
        >
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400" />
          <span className="text-[11px] font-medium uppercase tracking-wider text-amber-400">
            Setup needed
          </span>
          <span className="text-[11px] text-muted-foreground">
            {!status.githubConnected
              ? "GitHub not connected"
              : `${reposNeedingSetup.length} repo${reposNeedingSetup.length !== 1 ? "s" : ""} missing AI code review`}
          </span>
          <span className="text-[10px] text-muted-foreground">{expanded ? "▲" : "▼"}</span>
        </button>
        <button
          onClick={() => setDismissed(true)}
          className="text-[10px] uppercase tracking-wider text-muted-foreground transition-colors hover:text-foreground"
        >
          dismiss
        </button>
      </div>

      {expanded && (
        <div className="border-t border-amber-500/20 px-4 py-4 space-y-6">
          {!status.githubConnected && (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-medium uppercase tracking-wider text-destructive">
                  GitHub not connected
                </span>
                {status.githubError && (
                  <span className="text-[11px] text-muted-foreground">— {status.githubError}</span>
                )}
              </div>
              <GitHubSetupSection />
            </div>
          )}

          {status.githubConnected && reposNeedingSetup.length > 0 && (
            <div className="space-y-4">
              <div className="text-[11px] font-medium uppercase tracking-wider">
                AI code review not detected
              </div>
              <div className="space-y-4">
                {reposNeedingSetup.map((r) => (
                  <RepoSetupSection key={r.repo} repoStatus={r} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
