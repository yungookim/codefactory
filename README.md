# Code Factory

Code Factory is a local GitHub PR babysitter. It watches repositories and pull requests, syncs review feedback into a dashboard, triages comments into actionable work, and can launch an autonomous coding agent to prepare fixes and push them back to the PR branch.

The app is built as a single local service: an Express API, a React dashboard, SQLite-backed state, mirrored run logs, and Git/GitHub orchestration for isolated PR work.

## What It Does

- Watches one or more GitHub repositories for open pull requests.
- Registers individual pull requests directly from a GitHub PR URL.
- Pulls review comments, reviews, and discussion into local persistent storage.
- Renders GitHub markdown feedback into safe HTML for the dashboard.
- Triage feedback into `accept`, `reject`, or `flag` buckets, with manual overrides.
- Runs `codex` or `claude` in an isolated worktree to apply approved changes.
- Commits and pushes fixes back to the PR branch after a successful agent run.
- Stores full app state locally and mirrors activity logs to daily log files.

## High-Level Flow

1. Add a repository to the watch list or register a PR directly.
2. The watcher polls GitHub on the configured interval.
3. Open PRs are synced into local storage.
4. Review feedback is fetched, normalized, and stored with triage metadata.
5. The babysitter decides what needs action and what can be ignored or flagged.
6. An agent run happens inside an isolated git worktree.
7. Verification, commit, push, and detailed logs are recorded for the dashboard.

## Stack

- Server: Node.js, TypeScript, Express
- Client: React, Vite, TanStack Query, Tailwind
- Storage: SQLite via `node:sqlite`
- GitHub integration: Octokit plus optional `gh auth token` fallback
- Agents: local `codex` or `claude` CLI

## Requirements

- Node.js 22+  
  Tested in this workspace with Node `v24.12.0`.
- `npm`
- `git`
- One of:
  - `GITHUB_TOKEN`
  - a GitHub token saved in the app config
  - `gh auth login` on the local machine
- One of:
  - `codex`
  - `claude`

## Local Development

Install dependencies:

```bash
npm install
```

Start the app in development mode:

```bash
npm run dev
```

The server listens on `PORT`, defaulting to `5001`, and serves both the API and the dashboard.

Build the production bundle:

```bash
npm run build
```

Start the production build:

```bash
npm run start
```

Run the baseline typecheck:

```bash
npm run check
```

Module-level tests in this repo use the Node test runner with `tsx`, for example:

```bash
node --test --import tsx server/storage.test.ts
```

## Authentication And Configuration

GitHub auth is resolved in this order:

1. `GITHUB_TOKEN`
2. token stored in app config
3. `gh auth token`

The persisted config includes:

- coding agent selection (`codex` or `claude`)
- model name
- max turns
- polling interval
- batch window
- max changes per run
- watched repositories
- trusted reviewers
- ignored bots

Default ignored bots are:

- `dependabot[bot]`
- `codecov[bot]`
- `github-actions[bot]`

## Local State And Filesystem Layout

By default, app-owned state lives under `~/.codefactory`. You can override that root with `CODEFACTORY_HOME`.

Important paths:

- `~/.codefactory/state.sqlite`: durable app state
- `~/.codefactory/log/`: daily mirrored log files

PR worktrees are created separately under:

- `/tmp/pr-babysitter` by default
- `PR_BABYSITTER_ROOT` if overridden

The babysitter uses cached clones and detached worktrees so agent runs can edit code outside your current working copy.

## Dashboard And API

The dashboard is the main operator surface. It exposes:

- watched repositories
- tracked PRs
- feedback items with triage state
- manual triage overrides
- activity logs
- runtime configuration

Key API routes:

- `GET /api/repos`
- `POST /api/repos`
- `GET /api/prs`
- `GET /api/prs/:id`
- `POST /api/prs`
- `DELETE /api/prs/:id`
- `POST /api/prs/:id/fetch`
- `POST /api/prs/:id/triage`
- `POST /api/prs/:id/apply`
- `POST /api/prs/:id/babysit`
- `PATCH /api/prs/:id/feedback/:feedbackId`
- `GET /api/logs`
- `GET /api/config`
- `PATCH /api/config`

## Repository Layout

```text
client/          React dashboard
server/          Express routes, babysitter logic, GitHub integration, storage
shared/          Shared schemas and types
script/          Build tooling
docs/plans/      Design and implementation planning docs
dogfood-output/  QA artifacts captured during exploratory testing
tasks/           Project lessons and working notes
```

## Development Notes

- Production state uses `SqliteStorage`; the in-memory storage implementation remains in the repo as a simple alternative/test fixture.
- The dashboard masks stored GitHub tokens when reading config back from the API.
- Feedback markdown is rendered and sanitized before display.
- The watcher runs continuously after server startup and reconfigures its polling interval when config changes.

## Caveats

- This is a local automation tool, not a hosted multi-user service.
- Agent-driven remediation depends on external CLIs being installed and available on `PATH`.
- GitHub API access and repo visibility depend on the token or `gh` session available on the machine.
- The repo also contains planning docs and dogfooding artifacts that document the feature direction and testing history.
