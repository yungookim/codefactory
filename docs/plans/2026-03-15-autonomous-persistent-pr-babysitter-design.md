# Autonomous Persistent PR Babysitter Design

**Date:** 2026-03-15
**Status:** Approved

## Goal

Turn the local PR babysitter into an autonomous background worker that persists all app state under `~/.codefactory`, shows verbose live progress for background agent runs, renders GitHub markdown comments as safe HTML, and removes manual fetch/triage/remove controls from the UI.

## Requirements

- Show progress while the coding agent works in the background.
- Provide verbose log output for watcher, GitHub sync, agent, git, and push phases.
- Push fixes to the PR branch automatically without waiting for user input.
- Remove the `Created with Perplexity Computer` footer.
- Persist full app state locally, not only ephemeral in-memory data.
- Persist structured state in SQLite under `~/.codefactory`.
- Mirror logs into `~/.codefactory/log/{date}/`.
- Enable babysit mode by default.
- Remove `Fetch`, `Triage`, and `Remove` from the UI.
- Render GitHub markdown comments as sanitized HTML.

## Architecture

The app will move from in-memory storage to a local filesystem-backed persistence layer rooted at `~/.codefactory/`, with an environment override for tests. SQLite becomes the source of truth for app state and UI queries. Daily log files become the durable append-only mirror for operator inspection.

The babysitter remains the orchestrator. It will keep polling tracked repos and PRs, sync GitHub feedback, evaluate actionable work, launch the coding agent when needed, then commit and push the branch automatically. The UI becomes an observation surface for tracked PRs, rendered feedback, and verbose background logs.

## Filesystem Layout

- `~/.codefactory/state.sqlite`
  Full app state: config, watched repos, tracked PRs, feedback items, and structured logs.
- `~/.codefactory/log/YYYY-MM-DD/<repo>__<pr>.log`
  Human-readable append-only per-PR daily log files.

For testability, runtime code should resolve the root directory from `CODEFACTORY_HOME` first and fall back to `path.join(os.homedir(), ".codefactory")`.

## Persistence Model

### Config

Persist scalar runtime settings such as:

- `codingAgent`
- `model`
- `maxTurns`
- `batchWindowMs`
- `pollIntervalMs`
- `maxChangesPerRun`

Store list-like settings either as JSON text in the singleton config row or as separate tables where queryability matters.

### Watched Repos

Use a dedicated `watched_repos` table so repository watch state survives restarts cleanly and does not need JSON list surgery.

### PRs

Use a `prs` table keyed by generated local `id`, with columns for:

- PR number
- repo slug
- title
- branch
- author
- URL
- status
- accepted/rejected/flagged counts
- tests/lint status flags
- last checked
- added at

### Feedback Items

Use a `feedback_items` table keyed by stable GitHub-derived IDs. Store:

- local `pr_id`
- GitHub-derived feedback `id`
- author
- raw markdown body
- rendered sanitized HTML body
- file
- line
- type
- created time
- decision metadata
- action metadata

### Logs

Use a `logs` table for every structured event shown in the UI. Each row should include:

- `id`
- `pr_id`
- optional `run_id`
- timestamp
- level
- phase
- message
- optional metadata JSON

SQLite is the source of truth for the dashboard log view. File logs mirror the same events.

## Background Execution

Babysit mode is the default behavior:

1. Adding a PR registers it and immediately triggers a babysitter run.
2. Adding a watched repo enrolls it into the periodic watcher.
3. The watcher continuously discovers open PRs, syncs feedback, and launches remediation runs when actionable work exists.
4. After a successful edit run, the babysitter commits and pushes the PR branch automatically without waiting for user confirmation.

The agent prompt should clearly communicate that the run is autonomous and should not stop for confirmation. The babysitter process remains responsible for the final commit/push sequence so networked branch updates stay deterministic and observable.

## Progress And Verbose Logging

Each remediation attempt gets a `run_id`. The babysitter must log:

- watcher start and completion
- PR sync start and completion
- GitHub feedback counts
- evaluation decisions
- worktree creation
- agent launch
- streamed agent stdout chunks
- streamed agent stderr chunks
- git add/commit/push steps
- cleanup
- terminal success/failure

These events are written to both SQLite and the daily file log tree. The dashboard log panel should tail them live so background work is visible while it happens.

## GitHub Comment Rendering

GitHub feedback arrives mostly as markdown. On ingest, the server should:

1. keep the raw markdown body,
2. render it to HTML,
3. sanitize the HTML,
4. store both forms on the feedback item.

The UI should render sanitized HTML rather than plain text. This should preserve paragraphs, inline code, fenced code blocks, lists, emphasis, and links.

## UI Changes

The dashboard shifts from manual step execution to observation and monitoring:

- keep PR add/watch entry points,
- keep the PR list and detail view,
- keep the log panel and make it the primary operational view,
- remove `Fetch`, `Triage`, and `Remove` actions from the UI,
- remove the Perplexity attribution footer,
- render feedback bodies as HTML.

Manual triage/fetch routes may remain server-side if they reduce churn, but they should no longer be surfaced in the dashboard.

## Testing Strategy

Add targeted tests for:

- SQLite persistence and reload of config/PR/log state
- daily log file mirroring
- markdown-to-HTML rendering and sanitization
- verbose babysitter logging
- bot filtering and GitHub feedback normalization
- process restart behavior using the same `CODEFACTORY_HOME`

Retain `npm run check` as the baseline typecheck gate and use `node --test --import tsx ...` for module-level tests.

## Risks And Constraints

- Verbose streaming can produce many log lines; log chunking should avoid giant single-row payloads.
- Native SQLite dependencies may require install/build steps in the local environment.
- Migration from in-memory state is not required; the app can start with a fresh SQLite file when none exists.
- This workspace is not currently a git repository, so the design doc cannot be committed from this environment even though the normal workflow expects that.
