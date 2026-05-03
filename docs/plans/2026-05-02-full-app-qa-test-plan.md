# Full App QA Test Plan

> **For Claude:** REQUIRED SUB-SKILL: Use `qa` to execute this plan with browser evidence, defect triage, fixes, and re-verification.

**Goal:** Verify the full oh-my-pr web app as a real user before fixing defects, with evidence for every route, critical workflow, API-backed state, and responsive layout.

**Architecture:** Run a local dev build, exercise the hash-routed React app through the browser, and cross-check UI state against the Express API surface. Treat GitHub, shell commands, and coding-agent execution as external boundaries: use real credentials only when the operator provides them, otherwise verify validation, queued state, error surfacing, and local UI behavior.

**Tech Stack:** React, Wouter hash routing, TanStack Query, Express, TypeScript, Node test runner, SQLite or in-memory local storage depending on runtime config.

---

## Scope

### In Scope

- Browser QA for every reachable web route:
  - `/#/`
  - `/#/settings`
  - `/#/changelogs`
  - `/#/releases`
  - `/#/logs`
  - one unknown route such as `/#/does-not-exist`
- Dashboard workflows:
  - onboarding panel visibility, dismissal, and review workflow actions
  - add PR validation and success path when a test PR is available
  - watch repository validation, default `My PRs only` scope, and team-wide scope update
  - active and archived PR lists
  - PR selection, run-now, pause/resume watch
  - feedback item expand/collapse, accept/reject/flag, retry for failed or warning states
  - tracked repository settings, auto-release toggle, manual release queue
  - activity menu, warnings, and failed-activity clearing
  - CI healing panel states
  - Ask Agent and Activity side panel
- Settings workflows:
  - agent selector and fallback toggle
  - automation toggles
  - numeric tuning fields
  - CI healing limits
  - release automation toggle
  - runtime drain pause/resume
  - ordered GitHub token add, reorder, remove, masking, and redaction discipline
- Logs workflows:
  - initial log load
  - level, source, and search filters
  - URL persistence
  - follow tail connection and error state
  - copy and download actions
- Releases workflows:
  - empty, active, terminal, expanded, error, and retry states where fixture data exists
  - release notes copy and external links
- Changelogs workflows:
  - empty, loading, generating, error, done, expand, and copy states where fixture data exists
- API smoke checks for UI-backed endpoints.
- Desktop and mobile responsive checks.
- Accessibility smoke checks for keyboard focus, labels, disabled states, and obvious screen-reader regressions.
- Console and network error checks after every major interaction.

### Out Of Scope

- Changing production source before the initial QA baseline is documented.
- Publishing real GitHub releases unless the operator explicitly approves a test repository.
- Running coding agents against real PR branches without operator approval.
- Destructive cleanup of local app storage unless the operator asks for a fresh environment.
- Testing macOS/Tauri packaging beyond route startup unless this plan is explicitly extended.

## Assumptions

- Default target URL: `http://localhost:5001/#/`.
- Dev server command: `PORT=5001 npm run dev`.
- If port `5001` is busy, use `PORT=5002 npm run dev` and replace the target URL.
- No secrets should appear in screenshots, reports, logs, or copied output. GitHub tokens must be treated as redacted even if the UI shows masked values.
- The app may already contain local data. Do not delete or reset it for QA unless the operator asks.
- For live GitHub success paths, use a disposable repository or PR the operator confirms is safe.

## Required Test Data

Prepare these values before execution:

| Data | Example | Required For | Notes |
| --- | --- | --- | --- |
| Valid PR URL | `github.com/<owner>/<repo>/pull/<n>` | add PR, PR detail, feedback sync | Prefer a disposable repo or already-safe PR. |
| Valid repo slug | `<owner>/<repo>` | watch repo, sync, release queue | Must be accessible by the configured GitHub auth. |
| Invalid PR URL | `not-a-pr-url` | add PR validation | Must produce a visible error and no stale loading state. |
| Invalid repo slug | `missing-owner/missing-repo` | watch repo validation | Must produce a visible error and no stale loading state. |
| Optional failed feedback fixture | Existing failed or warning feedback item | retry flow | If absent, record as not covered by data. |
| Optional release run fixture | Existing release run | releases page expansion/retry | If absent, verify empty state and API shape. |

## Pre-Flight

### Step 1: Confirm Git And Workspace State

Run:

```bash
git branch --show-current
git status --porcelain
```

Expected:

- Branch is the intended QA branch.
- If the tree is dirty, record the dirty files before starting browser QA.
- Do not begin fix commits until the tree is clean or the operator has chosen commit/stash/abort.

### Step 2: Install And Verify Baseline Tooling

Run only if dependencies are missing:

```bash
npm install
```

Then run:

```bash
npm run test:all
npm run check
```

Expected:

- `npm run test:all` passes.
- `npm run check` passes.
- Any pre-existing failure is recorded as a baseline blocker before browser QA.

### Step 3: Start The App

Run:

```bash
PORT=5001 npm run dev
```

Expected:

- The dev server stays running.
- `http://localhost:5001/#/` loads the dashboard.
- No startup stack trace appears in the server logs.

### Step 4: Create QA Artifacts Directory

Run:

```bash
mkdir -p .gstack/qa-reports/screenshots
```

Expected:

- Screenshots and the final QA report are written under `.gstack/qa-reports/`.
- Suggested report name: `.gstack/qa-reports/qa-report-localhost-5001-2026-05-02.md`.

## Browser QA Matrix

### Route: Dashboard `/#/`

**Landing checks**

1. Open `http://localhost:5001/#/`.
2. Capture a desktop screenshot.
3. Verify the header shows app identity, PR/repo counts, agent selector, navigation to changelogs/releases/logs/settings, and activity menu.
4. Verify no console errors after load.
5. Verify update banner either does not show or links to a safe release URL and can be dismissed if applicable.

Expected:

- Dashboard renders without a blank state crash.
- Counts match visible data.
- Navigation controls are keyboard focusable.
- The app remains dark-first, dense, and developer-native.

**Onboarding panel**

1. If onboarding appears, expand and collapse it.
2. Verify GitHub, repo, and review workflow steps show accurate complete/pending state.
3. Dismiss the panel and reload.
4. If safe test repo data exists, trigger review workflow install for Claude or Codex only with operator approval.

Expected:

- Dismissal persists for the current unresolved onboarding state.
- Review provider links open externally.
- Install action shows pending and then success/error feedback.

**Add PR**

1. Open add controls.
2. Submit an empty PR field.
3. Submit `not-a-pr-url`.
4. Submit a valid PR URL when one is available.
5. After success, verify the PR is selected and appears in the active list.

Expected:

- Empty input keeps submit disabled.
- Invalid input shows a visible error and clears pending state.
- Valid input creates or updates the PR, refreshes activities, and does not duplicate rows.

**Watch repository**

1. Submit an empty repo field.
2. Submit an invalid repo slug.
3. Select `My PRs only` and submit a valid repo slug.
4. Add or update another repo with team-wide tracking.
5. Expand tracked repositories.
6. Toggle per-repo tracking scope.
7. Toggle per-repo auto-release.
8. Trigger manual release only on a test repo approved by the operator.

Expected:

- Empty input keeps submit disabled.
- Invalid repo shows a visible error and no stale pending state.
- New repos default to `My PRs only`.
- Team-wide scope persists as `ownPrsOnly: false`.
- Auto-release and manual release actions invalidate related data and show success/error feedback.

**PR list and detail**

1. Switch between Active and Archived tabs.
2. Select each available PR.
3. Verify title, repo link, status, tests/lint summary, feedback counts, watch state, and last checked display.
4. Click `Pause watch`, reload, then `Resume watch`.
5. Click `Run now` only on a safe test PR.

Expected:

- Active and archived counts match visible rows.
- Selecting a PR updates the detail pane and right panel.
- Watch pause/resume persists.
- Run-now pending state disables duplicate submissions and surfaces failures.

**Feedback rows**

For each available feedback status:

1. Expand and collapse details.
2. Verify markdown is rendered safely and plain text falls back correctly.
3. Click accept, reject, and flag on a safe fixture item.
4. Retry a failed or warning item if one exists.

Expected:

- Collapsed-by-default behavior matches status.
- Decision buttons reflect current state.
- Retry is visible only for failed or warning items.
- Read-only archived PRs do not expose mutation controls.

**CI healing panel**

1. Select a PR with no healing session.
2. Select a PR with a healing session if fixture data exists.
3. Toggle automatic CI healing in settings and return.

Expected:

- Disabled setting says automatic CI healing is disabled.
- No-session state explains when healing starts.
- Session state shows label, attempt summary, reason, fingerprint, and read-only operator controls.

**Right panel**

1. With no PR selected, verify Ask Agent empty prompt.
2. Select a PR and open Ask Agent.
3. Submit an empty question.
4. Submit a real question only on a safe PR.
5. Switch to Activity.
6. Verify log rows update and stay scrollable.

Expected:

- Empty input keeps submit disabled.
- Questions show pending, answered, or error states.
- Activity panel filters to the selected PR when a PR is selected.

### Route: Settings `/#/settings`

**Navigation and load**

1. Navigate from the dashboard.
2. Capture a screenshot.
3. Verify back link returns to dashboard.
4. Verify no console errors after load.

Expected:

- Settings renders even if config or runtime queries fail.
- Runtime errors are visible and not silent.

**Agent and automation controls**

1. Switch coding agent between `claude` and `codex`.
2. Toggle fallback to next coding agent.
3. Toggle auto-resolve conflicts and auto-update docs.

Expected:

- Each mutation shows saved feedback or a visible error.
- Dashboard agent selector reflects the saved agent after returning.

**Tuning controls**

1. Change each numeric tuning field by a small valid amount.
2. Try clearing a numeric input if the UI permits it.
3. Reload settings.

Expected:

- Valid values persist.
- Invalid or empty values are rejected or safely normalized.
- No `NaN` or blank numeric state is saved.

**CI healing and releases**

1. Toggle automatic CI healing.
2. Change each healing limit/cooldown field.
3. Toggle automatic release creation.
4. Return to dashboard and releases pages.

Expected:

- Saved settings affect visible dashboard/release state.
- No unrelated config fields are reset.

**Runtime drain**

1. Capture current drain status.
2. Click pause automation.
3. Reload settings and dashboard.
4. Click resume automation.

Expected:

- Drain mode status updates with reason and timestamp.
- New automation controls communicate blocked state.
- Resume clears the paused state.

**GitHub token list**

1. Open token input.
2. Try adding blank input.
3. Add a dummy token only if the operator confirms local config changes are safe.
4. Move token up and down if multiple safe dummy or masked tokens exist.
5. Remove the dummy token.

Expected:

- Blank add is disabled.
- Tokens are not exposed in final screenshots or report text.
- API responses and UI show masked values where appropriate.
- Reordering preserves list order.

### Route: Logs `/#/logs`

1. Open logs from the dashboard.
2. Capture a screenshot.
3. Change level filter to `warn`.
4. Change source filter when sources exist.
5. Search for a known term.
6. Enable follow tail.
7. Trigger a harmless app action that creates a log if possible.
8. Copy logs.
9. Download logs.
10. Reload and verify URL parameters are preserved.

Expected:

- Record count updates correctly.
- Follow tail appends newer server-sent events without duplicates.
- Stream errors are visible.
- Copy/download include only filtered records.
- No token-bearing fields appear unredacted.

### Route: Releases `/#/releases`

1. Open releases from the dashboard.
2. Capture a screenshot.
3. Verify empty state if no release runs exist.
4. Expand each available release run.
5. Copy release notes when present.
6. Open external release/PR links.
7. Retry an error release only for a test repo approved by the operator.

Expected:

- Active statuses poll and animate without layout shift.
- Terminal statuses are stable.
- Empty details say no details are available.
- Retry queues once and reports errors visibly.

### Route: Changelogs `/#/changelogs`

1. Open changelogs from the dashboard.
2. Capture a screenshot.
3. Verify empty state if no changelogs exist.
4. Expand done changelogs.
5. Copy Twitter/X and LinkedIn sections when present.
6. Verify generating and error rows if fixtures exist.

Expected:

- Done rows expand and collapse.
- Copy buttons provide feedback.
- Generating rows poll without blocking other page actions.
- Error rows expose the error without crashing.

### Route: Not Found

1. Open `http://localhost:5001/#/does-not-exist`.
2. Capture a screenshot.
3. Verify the not-found page renders.
4. Navigate back to dashboard.

Expected:

- Unknown route does not crash the app shell.
- User can recover through browser navigation or visible app links if present.

## API Smoke Checks

Run these from the browser console or a local HTTP client against the running dev server. Do not include secrets in output.

```bash
curl -s http://localhost:5001/api/runtime
curl -s http://localhost:5001/api/config
curl -s http://localhost:5001/api/prs
curl -s http://localhost:5001/api/prs/archived
curl -s http://localhost:5001/api/repos/settings
curl -s http://localhost:5001/api/activities
curl -s http://localhost:5001/api/onboarding/status
curl -s http://localhost:5001/api/healing-sessions
curl -s http://localhost:5001/api/releases
curl -s http://localhost:5001/api/changelogs
curl -s "http://localhost:5001/api/server-logs?limit=10"
```

Expected:

- Every endpoint returns JSON and a 2xx status unless the expected state is a documented auth/config error.
- `/api/config` does not reveal raw GitHub tokens.
- List endpoints return arrays or typed objects matching the UI expectation.
- No API response causes a matching page to crash on refresh.

## Responsive And Accessibility Checks

### Desktop

Viewport: `1280x720`

Expected:

- Dashboard uses three readable columns.
- Left list, center detail, and right panel scroll independently where intended.
- Header controls fit without overlap.

### Mobile

Viewport: `375x812`

Expected:

- Dashboard stacks into usable sections.
- Header wraps without text overlap.
- Add controls, tracked repositories, feedback actions, settings sections, and logs filters remain tappable.
- No horizontal scrolling except long code/log content where expected.

### Keyboard

1. Tab through each route.
2. Activate buttons and links with keyboard.
3. Confirm focus rings are visible.
4. Confirm disabled controls are skipped or announced appropriately.

Expected:

- All important actions are reachable.
- Inputs have labels or accessible names.
- Dialog-like or collapsible areas do not trap focus.

## Console And Network Checklist

After every route load and major interaction:

1. Check browser console errors.
2. Check failed network requests.
3. Check server logs route for new `error` or `fatal` records.
4. Capture screenshots for every issue before moving on.

Expected:

- No uncaught React errors.
- No hydration or routing errors.
- Failed mutations produce user-facing errors.
- Background polling failures are visible where they affect user decisions.

## Defect Severity

| Severity | Definition | Fix In Standard QA |
| --- | --- | --- |
| Critical | Data loss, secret exposure, app cannot load, unsafe external side effect | Yes |
| High | Core workflow broken, stuck loading state, wrong automation state, raw token visible | Yes |
| Medium | Important workflow confusing or partially broken, recoverable API/UI mismatch | Yes |
| Low | Cosmetic, copy, minor layout issue with no workflow impact | Defer unless exhaustive |

## Fix Loop After Baseline

For each fixable Critical, High, or Medium issue:

1. Record the issue in the QA report with screenshot evidence.
2. Locate only the source files directly responsible for the issue.
3. Write the smallest regression test that proves the behavior, unless the bug is pure CSS.
4. Make the minimal source change.
5. Run the focused test.
6. Re-run the browser repro.
7. Run `npm run check` for code changes.
8. Commit one issue at a time:

```bash
git add <intentional-files>
git commit -m "fix(qa): ISSUE-001 - short description"
```

Expected:

- Every fixed issue has before/after evidence.
- Every non-visual behavioral fix has regression coverage.
- No unrelated files are changed.

## Final Verification

Run after all in-scope fixes:

```bash
npm run test:all
npm run check
npm run build
```

Expected:

- All commands pass.
- If `npm run build` is skipped, the report explains why.
- Final browser pass covers every affected route and all fixed repros.

## Report Requirements

Write the final report to:

```text
.gstack/qa-reports/qa-report-localhost-5001-2026-05-02.md
```

Include:

- Date and target URL.
- Branch and commit SHA.
- Test data used, with secrets redacted.
- Routes visited.
- Screenshots captured.
- Console and network summary.
- Issues found, severity, repro steps, screenshots, and fix status.
- Commits made for each fix.
- Commands run and outputs summarized.
- Health score before and after fixes.
- Deferred issues and why they were deferred.

## Exit Criteria

QA is complete only when:

- Every route in this plan has a screenshot and console check.
- All Critical, High, and Medium issues found in Standard mode are fixed or explicitly deferred with a reason.
- Fixed issues are re-tested in the browser.
- Relevant automated tests pass.
- Typecheck passes for code changes.
- The final report exists under `.gstack/qa-reports/`.
- The final answer names the report path, fixed issue count, deferred issue count, health score delta, and verification commands.
