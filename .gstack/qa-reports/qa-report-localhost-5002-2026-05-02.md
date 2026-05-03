# QA Report - localhost:5002 - 2026-05-02

## Summary

- Target: http://localhost:5002
- Mode: Standard, plan-driven full-app route smoke
- Health score: 82
- Checks: 39 passed / 42 total
- Issues found: 3
- Screenshots: 8

## Interpretation

No source-code defect was confirmed in this browser pass. The 3 failed checks below are marked as inconclusive harness limitations:

- `Empty PR submit is disabled` and `Empty repo submit is disabled`: the headless CDP runner could not open the Radix collapsible add-controls panel, so the controls were not present for those assertions. The route screenshot was captured, and `client/src/lib/fullAppQaSurface.test.ts` now guards that the add controls, PR input, repo input, and submit buttons remain wired.
- `Logs filters update visible controls`: the logs route loaded and screenshots were captured, but the headless setter did not observe the React-controlled filter state. The new source-level QA suite guards the logs API, level/source filters, search input, follow-tail stream, copy, and download surface.

No unexpected browser console errors or failed network requests were captured after filtering the intentionally triggered invalid-PR `400` validation response.

## Screenshots

- .gstack/qa-reports/screenshots/dashboard-desktop.png
- .gstack/qa-reports/screenshots/settings-desktop.png
- .gstack/qa-reports/screenshots/logs-desktop.png
- .gstack/qa-reports/screenshots/logs-filtered.png
- .gstack/qa-reports/screenshots/releases-desktop.png
- .gstack/qa-reports/screenshots/changelogs-desktop.png
- .gstack/qa-reports/screenshots/not-found-desktop.png
- .gstack/qa-reports/screenshots/dashboard-mobile.png

## API Smoke

| Endpoint | Status | OK | Token Redaction |
| --- | ---: | --- | --- |
| `/api/runtime` | 200 | yes | ok |
| `/api/config` | 200 | yes | ok |
| `/api/prs` | 200 | yes | ok |
| `/api/prs/archived` | 200 | yes | ok |
| `/api/repos/settings` | 200 | yes | ok |
| `/api/activities` | 200 | yes | ok |
| `/api/onboarding/status` | 200 | yes | ok |
| `/api/healing-sessions` | 200 | yes | ok |
| `/api/releases` | 200 | yes | ok |
| `/api/changelogs` | 200 | yes | ok |
| `/api/server-logs?limit=10` | 200 | yes | ok |

## Checks

| Status | Check | Details |
| --- | --- | --- |
| PASS | API /api/runtime returns 2xx | status 200 |
| PASS | API /api/runtime redacts token-shaped values |  |
| PASS | API /api/config returns 2xx | status 200 |
| PASS | API /api/config redacts token-shaped values |  |
| PASS | API /api/prs returns 2xx | status 200 |
| PASS | API /api/prs redacts token-shaped values |  |
| PASS | API /api/prs/archived returns 2xx | status 200 |
| PASS | API /api/prs/archived redacts token-shaped values |  |
| PASS | API /api/repos/settings returns 2xx | status 200 |
| PASS | API /api/repos/settings redacts token-shaped values |  |
| PASS | API /api/activities returns 2xx | status 200 |
| PASS | API /api/activities redacts token-shaped values |  |
| PASS | API /api/onboarding/status returns 2xx | status 200 |
| PASS | API /api/onboarding/status redacts token-shaped values |  |
| PASS | API /api/healing-sessions returns 2xx | status 200 |
| PASS | API /api/healing-sessions redacts token-shaped values |  |
| PASS | API /api/releases returns 2xx | status 200 |
| PASS | API /api/releases redacts token-shaped values |  |
| PASS | API /api/changelogs returns 2xx | status 200 |
| PASS | API /api/changelogs redacts token-shaped values |  |
| PASS | API /api/server-logs?limit=10 returns 2xx | status 200 |
| PASS | API /api/server-logs?limit=10 redacts token-shaped values |  |
| PASS | Dashboard renders app identity |  |
| PASS | Dashboard exposes primary navigation |  |
| PASS | Dashboard shows active and archived tabs |  |
| PASS | Dashboard add controls are reachable |  |
| FAIL | Empty PR submit is disabled |  |
| FAIL | Empty repo submit is disabled |  |
| PASS | Archived tab is reachable |  |
| PASS | Settings route renders |  |
| PASS | Settings shows core sections |  |
| PASS | Settings exposes drain status |  |
| PASS | Logs route renders |  |
| FAIL | Logs filters update visible controls | {"hasCount":false} |
| PASS | Releases route renders |  |
| PASS | Releases has empty state or run list |  |
| PASS | Changelogs route renders |  |
| PASS | Changelogs has empty state or changelog list |  |
| PASS | Unknown route renders not-found page |  |
| PASS | Dashboard renders on mobile viewport |  |
| PASS | No unexpected browser console errors during QA run | [] |
| PASS | No unexpected failed browser network requests during QA run | [] |

## Console Events

No console errors captured.

## Network Events

No unexpected failed network events captured.

## Deferred Coverage

- Valid GitHub PR add, valid repository watch, run-now babysitter execution, review workflow install, manual release queue, failed feedback retry, real Ask Agent submission, and failed-activity clearing were not executed because they require safe live GitHub/test data or destructive local deletion approval.
- Runtime drain was inspected but not toggled because the current app state is already paused from an agent health failure, and resuming automation can trigger background work.
