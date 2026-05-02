# Recent Log Failure Fix Baseline - 2026-05-02

## Scope

This baseline records the fixes applied after reviewing local oh-my-pr logs on May 2, 2026.

Implementation branch:

- `fix/log-failure-fixes`
- Base: `origin/main@8eb4ec739dc0303325b2b83771f353dce1c2bd17`
- Recorded at: `2026-05-02T14:10:04Z`

## Latest-Code Check

Before implementation, `origin/main` was fetched and verified. The latest remote commits were PR #150 hash-router/frontend log-page changes only, so the backend automation failures from the local logs were not already addressed there.

Already-addressed items were left as verification-only:

- Missing replay context persistence.
- Illegal CI healing transition after escalation.
- Conflict prompt instructions telling agents not to stage, commit, or push.

## Fixes Applied

### Codex Health Diagnostics

Health checks now prefer actionable Codex session-permission errors over generic early stderr such as `Reading additional input from stdin...`.

Expected future signal:

- Codex session permission failures mention `Codex cannot access session files` or the equivalent actionable line.
- Dashboard activity warnings classify these failures as Codex availability warnings and include `~/.codex/sessions` permission guidance.

### Dependency Preflight Retry Loop

Dependency preflight failures are now recorded in the durable `agent_runs` journal with failure kind `dependency_preflight` and the PR head SHA.

Expected future signal:

- The watcher logs one skip for the same PR/head after a dependency preflight failure.
- It does not enqueue repeated `babysit_pr` jobs for the same failed head.
- A new PR head SHA is allowed to retry.

### Merge Conflict Repair Retry Loop

Repeated conflict repair failures are budgeted by PR, head SHA, base ref, and sorted unresolved path set.

Expected future signal:

- After the retry budget is exhausted for the same unresolved files, the run logs `conflict.retry`, marks the PR/run failed, and does not relaunch the conflict agent.
- App-owned conflict finalization remains unchanged: agents edit files only; the app stages, commits, pushes, and verifies.

### Self-Authored Status Comments

Footerless oh-my-pr status comments are now rejected at ingest when possible and ignored during runtime evaluation when they already exist as pending local feedback.

Expected future signal:

- No evaluator prompts for oh-my-pr status bodies such as `Accepted`, `Agent running`, `Agent failed`, `Agent completed`, or `Resolved`.

## Verification

Commands run from `.worktrees/log-failure-fixes`:

```bash
node --test --import tsx server/agentRunner.test.ts
node --test --import tsx server/github.test.ts
node --test --import tsx server/babysitter.test.ts --test-name-pattern "dependency preflight"
node --test --import tsx server/babysitter.test.ts --test-name-pattern "footerless status"
node --test --import tsx server/babysitter.test.ts --test-name-pattern "conflict repair"
node --test --import tsx server/routes.test.ts --test-name-pattern "Codex session permissions"
node --test --import tsx server/agentRunner.test.ts server/github.test.ts server/routes.test.ts server/babysitter.test.ts server/ciHealingManager.test.ts
npm run check
node --test --import tsx server/*.test.ts
npm run build
git diff --check
```

Results:

- Focused suites passed.
- `npm run check` passed.
- Full server suite passed: 428 passed, 1 skipped, 0 failed.
- Production build passed.
- `git diff --check` passed.

## Future Log Review Boundary

For future local-log analysis, treat log rows before this branch lands as pre-fix evidence. Only count these as regressions if they appear after the merge commit for `fix/log-failure-fixes`:

- Repeated dependency preflight failures for the same PR/head SHA after the first durable marker.
- Repeated conflict-agent launches for the same PR/head/base/unresolved path set after budget exhaustion.
- Codex health warnings that hide the session-permission root cause behind generic stderr.
- Agent evaluator prompts for oh-my-pr-authored status comments.
- Replay-context or escalated-healing transition errors after `origin/main@8eb4ec7`.
