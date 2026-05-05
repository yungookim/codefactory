# Drain Mode Log Fix Baseline - 2026-05-05

## Scope

Reviewed local oh-my-pr runtime state and logs after the report that drain mode was blocking new agent runs too often.

Evidence sources:

- `/Users/dgyk/.oh-my-pr/state.sqlite`
- `/Users/dgyk/.oh-my-pr/log/server.log`
- `/Users/dgyk/.oh-my-pr/log/2026-05-02` through `/Users/dgyk/.oh-my-pr/log/2026-05-05`

Recorded at: `2026-05-05T11:58Z`

## Findings

Current persisted runtime state was not draining:

- `drain_mode = 0`
- `drain_requested_at = NULL`
- `drain_reason = NULL`

Recent real PR logs showed repeated automatic pauses from Codex health checks:

- `2026-05-02T19:51:13Z`: multiple PRs paused with `codex health check failed: Reading additional input from stdin...`
- `2026-05-03T17:32:41Z`: repeated Codex health pauses across redseal PRs.
- `2026-05-04T12:42:38Z`: two PRs paused with `codex health check failed: Command timed out after 30000ms`.

`server.log` also contained many drain enable/disable rows from test-fixture traffic, so future reviews should prefer persisted PR logs and SQLite rows over raw `server.log` counts when classifying live drain incidents.

## Fix Applied

The automatic agent-health path no longer enters global drain mode for transient health failures such as a Codex health-check timeout.

Expected behavior after this change:

- Deterministic agent unavailability still pauses automation with drain mode:
  - missing CLI,
  - authentication failures,
  - Codex session permission failures,
  - unknown configured agent.
- Transient health-check failures log `Automation skipped: Agent health check failed...` for affected PRs and skip/fail the current cycle or job through existing queue behavior.
- A single 30s health probe timeout should not persist `runtime_state.drain_mode = 1`.

## Verification

Commands run from `/Users/dgyk/Dev/oh-my-pr`:

```bash
node --test --import tsx server/babysitter.test.ts --test-name-pattern "transient agent health timeouts"
node --test --import tsx server/babysitter.test.ts --test-name-pattern "transient agent health timeouts|pauses automation when the selected agent is unhealthy"
node --test --import tsx server/agentRunner.test.ts server/babysitter.test.ts
npm run check
npm run test
```

Results:

- Regression first failed before the fix because `runtimeState.drainMode` became `true`.
- Focused and adjacent test suites passed after the fix.
- `npm run check` passed.
- `npm run test` passed: 452 passed, 0 failed.

## Future Log Review Boundary

For future local-log analysis, treat log rows before this branch lands as pre-fix evidence. Only count these as regressions if they appear after the merge commit for this fix:

- `runtime_state.drain_mode = 1` caused only by `Command timed out after 30000ms`.
- `Automation paused: Agent health check failed for codex: ... Command timed out after 30000ms`.
- New `Drain mode enabled` rows whose `drainReason` is only a transient Codex timeout.

Expected healthy signal:

- Timeout-shaped Codex health failures produce `Automation skipped` logs and do not leave durable drain mode enabled.
